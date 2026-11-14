"""HTTP API for the skyline step: a FastAPI router that the main server includes.

    from skyline.api import router as skyline_router   # or backend.skyline.api, per the server's layout
    app.include_router(skyline_router)

POST /skyline           multipart form:
    photo   the image file (JPEG, PNG; EXIF orientation is applied)
    camera  optional JSON string, see metadata.py (preset, hfov_deg, pitch_deg, roll_deg, ...)
    label   optional file: a Perseverance raw-image record (JSON). Only the camera model and the
            direction of gravity are read from it; the rover heading and position never are.
    -> {"contract_version": "0.1", "photo": {...}, "diagnostics": {...}, "trace": {...},
        "debug_image": "data:image/jpeg;base64,..."}
       photo is one entry of the engine's POST /locate body (CONTRACTS.md section 2) without its id;
       diagnostics say how the camera was set up (for the app, not the engine).

POST /skyline/convert   JSON: {"camera": {...}, "label": {...} | null, "width": W, "height": H,
                               "trace": {"x": [...], "y": [...], "weight": [...], "sun_px": [x, y] | null}}
    -> {"contract_version": "0.1", "photo": {...}, "diagnostics": {...}}   (a trace edited in the app)

Errors: HTTP 400/413 with {"detail": {"code": "...", "message": "..."}}.
"""

from __future__ import annotations

import base64
import json

from fastapi import APIRouter, File, Form, HTTPException, UploadFile
from pydantic import BaseModel, Field

from .metadata import SpecError, camera_setup, load_image, parse_spec
from .pipeline import CONTRACT_VERSION, convert, process

MAX_PHOTO_BYTES = 30 * 1024 * 1024
MAX_LABEL_BYTES = 1024 * 1024
MAX_PIXELS = 50_000_000

router = APIRouter(tags=['skyline'])


def _fail(code: str, message: str, status: int = 400) -> HTTPException:
    return HTTPException(status_code=status, detail={'code': code, 'message': message})


async def _read_limited(upload: UploadFile, limit: int, what: str) -> bytes:
    data = await upload.read(limit + 1)
    if len(data) > limit:
        raise _fail('too_large', f'{what} is larger than {limit // (1024 * 1024)} MB', 413)
    if not data:
        raise _fail('empty', f'{what} is empty')
    return data


def _parse_label(data: bytes | None) -> dict | None:
    if data is None:
        return None
    try:
        label = json.loads(data)
    except (json.JSONDecodeError, UnicodeDecodeError) as e:
        raise _fail('bad_label', 'label must be a Perseverance raw-image record (JSON)') from e
    if isinstance(label, dict) and isinstance(label.get('image'), list) and label['image']:
        label = label['image'][0]  # the feed's by-id reply wraps the record
    if not isinstance(label, dict):
        raise _fail('bad_label', 'label must be a JSON object')
    return label


@router.post('/skyline')
async def post_skyline(
    photo: UploadFile = File(...),
    camera: str | None = Form(None),
    label: UploadFile | None = File(None),
) -> dict:
    data = await _read_limited(photo, MAX_PHOTO_BYTES, 'photo')
    label_json = _parse_label(await _read_limited(label, MAX_LABEL_BYTES, 'label')) if label is not None else None
    try:
        spec = parse_spec(camera)
        image, exif = load_image(data)
        h, w = image.shape[:2]
        if w * h > MAX_PIXELS:
            raise SpecError(f'photo has more than {MAX_PIXELS // 1_000_000} megapixels')
        setup = camera_setup(w, h, spec, exif, label_json)
        out = process(image, setup)
    except (SpecError, ValueError) as e:
        raise _fail('bad_input', str(e)) from e
    jpeg = base64.b64encode(out.debug_jpeg).decode('ascii')
    return {'contract_version': CONTRACT_VERSION, 'photo': out.photo, 'diagnostics': out.diagnostics,
            'trace': out.trace, 'debug_image': f'data:image/jpeg;base64,{jpeg}'}


class TraceIn(BaseModel):
    x: list[float] = Field(..., min_length=2, max_length=20000)
    y: list[float] = Field(..., min_length=2, max_length=20000)
    weight: list[float] = Field(..., min_length=2, max_length=20000)
    sun_px: list[float] | None = Field(None, min_length=2, max_length=2)


class ConvertIn(BaseModel):
    camera: dict = Field(default_factory=dict)
    label: dict | None = None
    width: int = Field(..., gt=0, le=20000)
    height: int = Field(..., gt=0, le=20000)
    trace: TraceIn


@router.post('/skyline/convert')
def post_convert(body: ConvertIn) -> dict:
    label = _parse_label(json.dumps(body.label).encode()) if body.label is not None else None
    try:
        setup = camera_setup(body.width, body.height, body.camera, None, label)
        photo, diagnostics = convert(setup, body.trace.x, body.trace.y, body.trace.weight, body.trace.sun_px)
    except (SpecError, ValueError) as e:
        raise _fail('bad_input', str(e)) from e
    return {'contract_version': CONTRACT_VERSION, 'photo': photo, 'diagnostics': diagnostics}
