"""Photo -> skyline, end to end, and edited trace -> skyline.

process(): trace the sky line, weigh each column, convert to angles, draw the debug image.
convert(): the same conversion for a trace the user edited in the app (points in photo pixels).

Photos wider than PROCESS_WIDTH are traced on a smaller copy; the line is mapped back to the photo's
own pixels before converting, so the camera model always describes the photo as sent.
"""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np

from .angles import DEFAULT_STEP_DEG, camera_summary, find_sun, paint_over, points_to_angles, resample
from .debug import debug_jpeg
from .metadata import CameraSetup
from .sky import _resize, to_rgb_float, trace_skyline
from .trust import column_trust

FORMAT = 'skyline/draft-1'  # until backend/CONTRACTS.md fixes the format
PROCESS_WIDTH = 2048


@dataclass
class Output:
    skyline: dict  # what the engine gets
    trace: dict  # the line in photo pixels, for drawing and editing in the app
    debug_jpeg: bytes


def _skyline_json(setup: CameraSetup, az: np.ndarray, el: np.ndarray, w: np.ndarray, step: float,
                  sun: tuple[float, float] | None) -> dict:
    return {
        'format': FORMAT,
        'camera': {**camera_summary(setup.camera, setup.level), 'source': setup.camera_source},
        'level_source': setup.level.source,
        'eye_height_m': round(setup.eye_height_m, 3),
        'time_utc': setup.time_utc,
        'sun': None if sun is None else {'az_offset_deg': round(sun[0], 3), 'elev_deg': round(sun[1], 3)},
        'az_step_deg': step,
        'samples': resample(az, el, w, step),
    }


def process(image: np.ndarray, setup: CameraSetup, step: float = DEFAULT_STEP_DEG) -> Output:
    img = np.asarray(image)
    H, W = img.shape[:2]
    if (W, H) != (setup.camera.width, setup.camera.height):
        raise ValueError(f'camera is for {setup.camera.width}x{setup.camera.height}, photo is {W}x{H}')

    work = img
    f = 1.0
    if W > PROCESS_WIDTH:
        f = float(int(np.ceil(W / PROCESS_WIDTH)))
        work = _resize(to_rgb_float(img), W // int(f))
    # The sun first: a bright disc in the sky would otherwise bend the line around itself.
    work_f = to_rgb_float(work)
    sun_found = find_sun(work_f)
    if sun_found is not None:
        work_f = paint_over(work_f, sun_found[2])
    trace = trace_skyline(work_f)
    trust = column_trust(trace)

    cols = np.arange(trace.width)
    u = (cols + 0.5) * f - 0.5  # back to the photo's own pixel centres
    v = (trace.edge_y + 0.5) * f - 0.5
    az, el = points_to_angles(setup.camera, setup.level, u, v)

    sun = None
    sun_px = None
    if sun_found is not None:
        su, sv, _ = sun_found
        if sv < trace.edge_y[min(trace.width - 1, int(round(su)))] - 2:  # only a sun that is in the sky
            sun_px = ((su + 0.5) * f - 0.5, (sv + 0.5) * f - 0.5)
    if sun_px is not None:
        s_az, s_el = points_to_angles(setup.camera, setup.level, np.array([sun_px[0]]), np.array([sun_px[1]]))
        sun = (float(s_az[0]), float(s_el[0]))

    skyline = _skyline_json(setup, az, el, trust.weight, step, sun)
    trace_json = {
        'width': W,
        'height': H,
        'x': [round(float(x), 2) for x in u],
        'y': [round(float(y), 2) for y in v],
        'weight': [round(float(x), 3) for x in trust.weight],
        'reason': trust.reason,
        'sun_px': None if sun_px is None else [round(sun_px[0], 1), round(sun_px[1], 1)],
    }
    return Output(skyline, trace_json, debug_jpeg(img, u, v, trust.weight, sun_px))


def convert(setup: CameraSetup, x: list[float], y: list[float], weight: list[float],
            sun_px: list[float] | None = None, step: float = DEFAULT_STEP_DEG) -> dict:
    """Skyline JSON for an edited trace. x, y in the photo's pixels, left to right; weight 0-1."""
    if not (len(x) == len(y) == len(weight)) or len(x) < 2:
        raise ValueError('x, y and weight must have the same length, at least 2')
    xs, ys, ws = (np.asarray(a, float) for a in (x, y, weight))
    if not (np.all(np.isfinite(xs)) and np.all(np.isfinite(ys)) and np.all(np.isfinite(ws))):
        raise ValueError('x, y and weight must be finite numbers')
    az, el = points_to_angles(setup.camera, setup.level, xs, ys)
    sun = None
    if sun_px is not None:
        s_az, s_el = points_to_angles(setup.camera, setup.level, np.array([float(sun_px[0])]), np.array([float(sun_px[1])]))
        sun = (float(s_az[0]), float(s_el[0]))
    return _skyline_json(setup, az, el, np.clip(ws, 0, 1), step, sun)
