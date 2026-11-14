"""Synthetic photos of known geometry, for testing the whole chain.

A skyline is a function elev_deg(az_offset_deg) in the level frame. Every pixel is sky when its viewing
direction lies above the skyline, ground otherwise. The sky is a smooth gradient that brightens towards
the horizon (like Mars). The ground is textured, faintly near the skyline (far away, hazy) and more
strongly lower down (nearer), as in a real photo. Pixels are 2 x 2 supersampled, so edges fall at
sub-pixel positions.
"""

from __future__ import annotations

from typing import Callable

import numpy as np

from skyline.camera import CameraModel
from skyline.level import Level

SKY = np.array([0.80, 0.68, 0.52])
GROUND = np.array([0.42, 0.31, 0.22])


def skyline_wave(az: np.ndarray) -> np.ndarray:
    """A far skyline: gentle hills between about 0.5 and 4 degrees."""
    return 2.2 + 1.2 * np.sin(np.radians(az) * 6) + 0.6 * np.sin(np.radians(az) * 17 + 1)


def render(camera: CameraModel, level: Level, skyline: Callable[[np.ndarray], np.ndarray] = skyline_wave,
           rock: tuple[float, float, float] | None = None, haze: tuple[float, float] | None = None,
           seed: int = 0) -> np.ndarray:
    """rock: (az_from, az_to, top_elev_deg) a near, sharp object rising into the sky.
    haze: (az_from, az_to) where the far terrain fades almost into the sky."""
    W, H = camera.width, camera.height
    rng = np.random.default_rng(seed)
    acc = np.zeros((H, W, 3))
    ground_tex = rng.normal(0, 0.05, (H, W, 1)) + 0.04 * np.sin(np.arange(W) / 3.0)[None, :, None]
    rock_tex = rng.normal(0, 0.12, (H, W, 1))
    for du, dv in [(-0.25, -0.25), (0.25, -0.25), (-0.25, 0.25), (0.25, 0.25)]:
        vv, uu = np.mgrid[0:H, 0:W].astype(float)
        rays = camera.pixel_to_ray((uu + du).ravel(), (vv + dv).ravel())
        az, el = level.angles(rays)
        az, el = az.reshape(H, W), el.reshape(H, W)
        sky_col = SKY[None, None, :] + 0.12 * np.exp(-np.clip(el, 0, None) / 8.0)[..., None] - 0.003 * el[..., None]
        depth = np.clip((skyline(az) - el) / 6.0, 0, 1)[..., None]  # 0 at the skyline, 1 six degrees below
        ground_col = GROUND[None, None, :] + ground_tex * (0.25 + 0.75 * depth)
        if haze is not None:
            hz = (az >= haze[0]) & (az <= haze[1])
            # Far terrain near the skyline in that stretch is nearly sky-coloured.
            ground_col = np.where(hz[..., None], 0.93 * sky_col + 0.07 * GROUND, ground_col)
        sky = el > skyline(az)
        img = np.where(sky[..., None], sky_col, ground_col)
        if rock is not None:
            r = (az >= rock[0]) & (az <= rock[1]) & (el <= rock[2])
            img = np.where(r[..., None], 0.25 + rock_tex, img)
        acc += img
    return (np.clip(acc / 4, 0, 1) * 255).round().astype(np.uint8)
