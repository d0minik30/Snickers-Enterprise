"""From skyline pixels to angles: the samples the engine matches.

Each traced point (u, v) in image pixels becomes a viewing direction through the camera model, then
(az_offset_deg, elev_deg) through the yaw-free level frame (see level.py). The points are resampled at
an even azimuth step; a sample's weight is the interpolated weight, and 0 if either neighbouring point
is untrusted (weight 0), so a distrusted stretch never leaks into its neighbours.
"""

from __future__ import annotations

import numpy as np

from .camera import CameraModel, Pinhole
from .level import Level

DEFAULT_STEP_DEG = 0.1


def points_to_angles(camera: CameraModel, level: Level, u: np.ndarray, v: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    rays = camera.pixel_to_ray(np.asarray(u, float), np.asarray(v, float))
    return level.angles(rays)


def resample(az: np.ndarray, el: np.ndarray, w: np.ndarray, step_deg: float = DEFAULT_STEP_DEG) -> list[dict]:
    """Even azimuth grid over the traced span. Points must run left to right (az increasing)."""
    order = np.argsort(az, kind='stable')
    az, el, w = az[order], el[order], np.clip(w[order], 0, 1)
    if len(az) < 2:
        return []
    start = np.ceil(az[0] / step_deg) * step_deg
    grid = np.arange(start, az[-1] + 1e-9, step_deg)
    el_g = np.interp(grid, az, el)
    w_g = np.interp(grid, az, w)
    # A grid point between two traced points is untrusted if either of them is.
    right = np.clip(np.searchsorted(az, grid, side='left'), 1, len(az) - 1)
    w_g = np.where(np.minimum(w[right - 1], w[right]) <= 0, 0.0, w_g)
    return [
        {'az_offset_deg': round(float(a), 4), 'elev_deg': round(float(e), 4), 'weight': round(float(x), 3)}
        for a, e, x in zip(grid, el_g, w_g)
    ]


def camera_summary(camera: CameraModel, level: Level) -> dict:
    """Field of view (through the image centre), and the camera's pitch and roll from gravity alone."""
    W, H = camera.width, camera.height
    cy, cx = (H - 1) / 2, (W - 1) / 2
    lr = camera.pixel_to_ray(np.array([0.0, W - 1.0]), np.array([cy, cy]))
    tb = camera.pixel_to_ray(np.array([cx, cx]), np.array([0.0, H - 1.0]))
    angle = lambda a, b: float(np.degrees(np.arccos(np.clip(a @ b, -1, 1))))  # noqa: E731
    fwd = camera.forward
    if isinstance(camera, Pinhole):
        right, down = np.array([1.0, 0.0, 0.0]), np.array([0.0, 1.0, 0.0])
    else:
        right = camera.H - (camera.H @ camera.A) * camera.A
        down = camera.V - (camera.V @ camera.A) * camera.A
        right, down = right / np.linalg.norm(right), down / np.linalg.norm(down)
    z = level.rotation[2]  # gravity
    # Same conventions as level.gravity_from_pitch_roll: pitch up positive, roll positive when the
    # camera's right side dips.
    pitch = float(np.degrees(np.arcsin(np.clip(-(fwd @ z), -1, 1))))
    roll = float(np.degrees(np.arctan2(right @ z, down @ z)))
    return {
        'model': camera.kind,
        'width': W,
        'height': H,
        'hfov_deg': round(angle(lr[0], lr[1]), 3),
        'vfov_deg': round(angle(tb[0], tb[1]), 3),
        'pitch_deg': round(pitch, 3),
        'roll_deg': round(roll, 3),
    }


SUN_MAX_FRACTION = 0.002  # a sun disc covers less than this fraction of the photo
SUN_HOT = 0.98  # every channel above this (0-1) counts as blown out


def _components(mask: np.ndarray, limit: int) -> list[np.ndarray]:
    """Connected (4-neighbour) groups of True pixels as (N, 2) row/col arrays; [] if there are too many."""
    pts = np.argwhere(mask)
    if len(pts) == 0 or len(pts) > limit:
        return []
    todo = {(int(r), int(c)) for r, c in pts}
    groups = []
    while todo:
        stack = [todo.pop()]
        group = []
        while stack:
            r, c = stack.pop()
            group.append((r, c))
            for nb in ((r + 1, c), (r - 1, c), (r, c + 1), (r, c - 1)):
                if nb in todo:
                    todo.remove(nb)
                    stack.append(nb)
        groups.append(np.array(group))
    return groups


def find_sun(img: np.ndarray) -> tuple[float, float, tuple[int, int, int, int]] | None:
    """A small, round, blown-out blob surrounded by smooth sky: the sun. Returns (u, v, box) or None.

    White rover hardware also blows out, but sits against darker, textured parts, so the smooth bright
    ring around the blob tells them apart. A large saturated area is a clipped sky, not a sun disc.
    """
    H, W, _ = img.shape
    hot = img.min(axis=2) > SUN_HOT
    best = None
    for g in _components(hot, int(0.02 * H * W)):
        n = len(g)
        if n < 4 or n > SUN_MAX_FRACTION * H * W:
            continue
        r0, c0 = g.min(axis=0)
        r1, c1 = g.max(axis=0)
        if (r1 - r0 + 1) * (c1 - c0 + 1) > 2.2 * n:  # a disc fills ~79 % of its box
            continue
        pad = max(3, int(0.5 * (r1 - r0 + 1)))
        R0, R1, C0, C1 = max(0, r0 - pad), min(H, r1 + pad + 1), max(0, c0 - pad), min(W, c1 + pad + 1)
        ring = np.ones((R1 - R0, C1 - C0), dtype=bool)
        ring[r0 - R0: r1 - R0 + 1, c0 - C0: c1 - C0 + 1] = False
        ring_px = img[R0:R1, C0:C1][ring & ~hot[R0:R1, C0:C1]]
        if len(ring_px) < 8 or ring_px.mean() < 0.3 or ring_px.std(axis=0).max() > 0.08:
            continue
        if best is None or n > best[0]:
            best = (n, float(g[:, 1].mean()), float(g[:, 0].mean()), (R0, R1, C0, C1))
    if best is None:
        return None
    return best[1], best[2], best[3]


def paint_over(img: np.ndarray, box: tuple[int, int, int, int]) -> np.ndarray:
    """Fill a box with the sky around it (row by row, linear between its left and right edges)."""
    R0, R1, C0, C1 = box
    out = img.copy()
    W = img.shape[1]
    left, right = max(0, C0 - 1), min(W - 1, C1)
    t = (np.arange(C0, C1) - left) / max(right - left, 1)
    for r in range(R0, R1):
        out[r, C0:C1] = (1 - t)[:, None] * img[r, left] + t[:, None] * img[r, right]
    return out
