"""Camera and levelling from what the client sends: a camera spec, EXIF, or a Perseverance label.

The camera spec (JSON, every field optional):
    preset         name from PRESETS (phones, Perseverance cameras)
    hfov_deg, vfov_deg, k [k1, k2, k3], p [p1, p2]    explicit pinhole camera
    pitch_deg, roll_deg, level_source ('sensor' | 'manual')   tilt; level.py has the sign conventions
    eye_height_m, time_utc

Priority: a Perseverance label > explicit fields of view > preset > EXIF > error.
Without pitch/roll a phone photo is assumed level (level_source 'assumed').

Perseverance labels: the raw-image feed record (JSON, as saved by scripts/fetch_samples.py). From it we
read the CAHVORE camera model and the direction of gravity ONLY. Its rover attitude also carries the
heading, and the record has the rover position: both are the answer for test photos and are never read.
"""

from __future__ import annotations

import io
import json
from dataclasses import dataclass

import numpy as np
from PIL import ExifTags, Image, ImageOps

from .camera import Cahvore, CameraModel, Pinhole
from .level import Level, gravity_from_pitch_roll, gravity_from_rover_attitude, level_from_gravity

DEFAULT_EYE_HEIGHT_M = 1.7
FULL_FRAME_DIAGONAL_MM = 43.27  # 35 mm-equivalent focal lengths are defined against this diagonal

# Horizontal/vertical field of view in degrees for landscape images, or a 35 mm-equivalent focal
# length (the field of view then follows from the photo's aspect ratio).
PRESETS: dict[str, dict] = {
    'iphone-main': {'label': 'iPhone main camera (13-16)', 'focal_35mm': 26},
    'iphone-ultrawide': {'label': 'iPhone ultra-wide', 'focal_35mm': 13},
    'pixel-main': {'label': 'Google Pixel main camera (7-9)', 'focal_35mm': 25},
    'galaxy-main': {'label': 'Samsung Galaxy S main camera (22-24)', 'focal_35mm': 23},
    'generic-phone': {'label': 'Phone, typical main camera', 'focal_35mm': 26},
    # Perseverance: a label (CAHVORE model) is far better; these are nominal pinhole stand-ins.
    'm2020-navcam': {'label': 'Perseverance Navcam (nominal, no label)', 'hfov_deg': 96.0, 'vfov_deg': 73.0},
    'm2020-mastcamz-26mm': {'label': 'Perseverance Mastcam-Z at 26 mm', 'hfov_deg': 25.6, 'vfov_deg': 19.2},
    'm2020-mastcamz-110mm': {'label': 'Perseverance Mastcam-Z at 110 mm', 'hfov_deg': 6.2, 'vfov_deg': 4.6},
}


class SpecError(ValueError):
    """The camera information is missing or inconsistent; the message says what to send."""


@dataclass
class CameraSetup:
    camera: CameraModel
    level: Level
    eye_height_m: float
    time_utc: str | None
    camera_source: str  # 'label' | 'manual' | 'preset' | 'exif'


# ------------------------------------------------------------------ images and EXIF


def load_image(data: bytes) -> tuple[np.ndarray, dict]:
    """Decode a photo, apply its EXIF orientation, and return (H x W x 3 uint8, exif summary)."""
    try:
        im = Image.open(io.BytesIO(data))
        exif = read_exif(im)
        im = ImageOps.exif_transpose(im).convert('RGB')
    except Exception as e:  # Pillow raises many kinds; the client only needs to know it is unreadable
        raise SpecError(f'cannot read the photo: {e}') from e
    return np.asarray(im), exif


def read_exif(im: Image.Image) -> dict:
    out: dict = {}
    try:
        exif = im.getexif()
    except Exception:
        return out
    base = {ExifTags.TAGS.get(k, k): v for k, v in exif.items()}
    sub = {ExifTags.TAGS.get(k, k): v for k, v in exif.get_ifd(0x8769).items()}
    tags = {**base, **sub}
    for key, name in [('make', 'Make'), ('model', 'Model'), ('datetime', 'DateTimeOriginal'),
                      ('offset', 'OffsetTimeOriginal')]:
        if tags.get(name):
            out[key] = str(tags[name]).strip('\x00 ')
    for key, name in [('focal_mm', 'FocalLength'), ('focal_35mm', 'FocalLengthIn35mmFilm')]:
        try:
            val = float(tags[name])
            if val > 0:
                out[key] = val
        except (KeyError, TypeError, ValueError, ZeroDivisionError):
            pass
    return out


def pinhole_from_35mm(width: int, height: int, focal_35mm: float) -> Pinhole:
    diag_px = np.hypot(width, height)
    width_mm = FULL_FRAME_DIAGONAL_MM * width / diag_px
    hfov = 2 * np.degrees(np.arctan(width_mm / (2 * focal_35mm)))
    return Pinhole.from_fov(width, height, float(hfov))


# ------------------------------------------------------------------ Perseverance raw-image record


def scaled_cahvore(model: Cahvore, width: int, height: int) -> Cahvore:
    """The same camera for a resized image (pixel centres map as (x + 0.5) * s - 0.5)."""
    sx, sy = width / model.width, height / model.height
    if abs(sx - sy) > 0.01:
        raise SpecError(f'photo is {width}x{height} but the label is for {model.width}x{model.height}')
    s = sx
    H = s * model.H + (0.5 * s - 0.5) * model.A
    V = s * model.V + (0.5 * s - 0.5) * model.A
    return Cahvore(width, height, model.A, H, V, model.O, model.R, model.linearity, model.C)


def setup_from_m2020_record(record: dict, width: int, height: int, spec: dict) -> CameraSetup:
    cam = record.get('camera') or {}
    text = cam.get('camera_model_component_list')
    if not text:
        raise SpecError('label has no camera model (camera.camera_model_component_list)')
    ext = record.get('extended') or {}
    sub = str(ext.get('subframeRect', '')).strip('()').split(',')
    dim = str(ext.get('dimension', '')).strip('()').split(',')
    try:
        model_w, model_h = int(dim[0]), int(dim[1])
    except (ValueError, IndexError) as e:
        raise SpecError('label has no image dimension (extended.dimension)') from e
    # A crop that does not start at the sensor's top-left corner would need the model shifted.
    if len(sub) == 4 and (sub[0].strip(), sub[1].strip()) != ('1', '1'):
        raise SpecError('cropped (subframe) Perseverance images are not supported yet; use a full frame')
    model = Cahvore.from_components(text, model_w, model_h)
    if (width, height) != (model_w, model_h):
        model = scaled_cahvore(model, width, height)
    attitude = record.get('attitude')
    try:
        q = tuple(float(x) for x in str(attitude).strip('()').split(','))
        if len(q) != 4:
            raise ValueError
    except ValueError as e:
        raise SpecError('label has no rover attitude (attitude)') from e
    gravity = gravity_from_rover_attitude(q)  # only "down" is kept; the heading is discarded here
    level = level_from_gravity(gravity, model.forward, 'label')
    # Camera height: the rover frame's origin is near the ground, z down, so height is -C_z.
    eye = spec.get('eye_height_m')
    if eye is None:
        eye = float(-model.C[2]) if model.C is not None and model.C[2] < 0 else DEFAULT_EYE_HEIGHT_M
    time_utc = spec.get('time_utc') or record.get('date_taken_utc')
    if time_utc and not str(time_utc).endswith('Z'):
        time_utc = f'{time_utc}Z'
    return CameraSetup(model, level, float(eye), time_utc, 'label')


# ------------------------------------------------------------------ the general entry point


def parse_spec(text: str | None) -> dict:
    if not text:
        return {}
    try:
        spec = json.loads(text)
    except json.JSONDecodeError as e:
        raise SpecError(f'camera spec is not valid JSON: {e.msg}') from e
    if not isinstance(spec, dict):
        raise SpecError('camera spec must be a JSON object')
    return spec


def _num(spec: dict, key: str) -> float | None:
    if spec.get(key) is None:
        return None
    try:
        val = float(spec[key])
    except (TypeError, ValueError) as e:
        raise SpecError(f'{key} must be a number') from e
    if not np.isfinite(val):
        raise SpecError(f'{key} must be finite')
    return val


def camera_setup(width: int, height: int, spec: dict, exif: dict | None = None,
                 label: dict | None = None) -> CameraSetup:
    if label is not None:
        return setup_from_m2020_record(label, width, height, spec)

    hfov, vfov = _num(spec, 'hfov_deg'), _num(spec, 'vfov_deg')
    k = tuple(float(x) for x in (spec.get('k') or [0, 0, 0]))[:3]
    p = tuple(float(x) for x in (spec.get('p') or [0, 0]))[:2]
    if len(k) != 3 or len(p) != 2:
        raise SpecError('k needs 3 values [k1, k2, k3] and p needs 2 [p1, p2]')
    camera: Pinhole
    if hfov is not None:
        if not 1 <= hfov <= 170:
            raise SpecError('hfov_deg must be between 1 and 170')
        camera = Pinhole.from_fov(width, height, hfov, vfov, k, p)  # type: ignore[arg-type]
        source = 'manual'
    elif spec.get('preset'):
        preset = PRESETS.get(str(spec['preset']))
        if preset is None:
            raise SpecError(f"unknown preset {spec['preset']!r}; known: {', '.join(PRESETS)}")
        landscape = width >= height
        if 'focal_35mm' in preset:
            camera = pinhole_from_35mm(width, height, preset['focal_35mm'])
        else:
            h_deg, v_deg = (preset['hfov_deg'], preset['vfov_deg']) if landscape else (preset['vfov_deg'], preset['hfov_deg'])
            camera = Pinhole.from_fov(width, height, h_deg, v_deg)
        source = 'preset'
    elif exif and exif.get('focal_35mm'):
        camera = pinhole_from_35mm(width, height, exif['focal_35mm'])
        source = 'exif'
    else:
        raise SpecError('no field of view: send hfov_deg, a preset, or a photo with EXIF focal length')

    pitch, roll = _num(spec, 'pitch_deg'), _num(spec, 'roll_deg')
    if pitch is None and roll is None:
        level_source = 'assumed'
    else:
        level_source = str(spec.get('level_source') or 'manual')
        if level_source not in ('sensor', 'manual'):
            raise SpecError("level_source must be 'sensor' or 'manual'")
    gravity = gravity_from_pitch_roll(pitch or 0.0, roll or 0.0)
    level = level_from_gravity(gravity, camera.forward, level_source)

    eye = _num(spec, 'eye_height_m')
    time_utc = spec.get('time_utc')
    if time_utc is None and exif and exif.get('datetime'):
        # EXIF time is local camera time; only usable with its offset.
        if exif.get('offset'):
            time_utc = _exif_to_utc(exif['datetime'], exif['offset'])
    return CameraSetup(camera, level, eye if eye is not None else DEFAULT_EYE_HEIGHT_M, time_utc, source)


def _exif_to_utc(dt: str, offset: str) -> str | None:
    from datetime import datetime, timezone

    try:
        local = datetime.strptime(f'{dt}{offset.replace(":", "")}', '%Y:%m:%d %H:%M:%S%z')
    except ValueError:
        return None
    return local.astimezone(timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ')
