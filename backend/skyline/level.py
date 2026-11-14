"""Levelling: from camera-model directions to (az_offset, elevation).

Everything here is built from ONE input: the direction of gravity in the camera model's frame.
That fixes "up" (so pitch and roll come out) but says nothing about which way the camera faces.
Azimuths are measured from the optical axis, so the camera's heading never enters the result.
For Perseverance photos this is what keeps the label's answer (rover heading) out of the skyline.

Level frame: Z = gravity (down), X = the optical axis flattened onto the horizontal plane,
Y = Z x X (to the right when facing X). az_offset = atan2(Y, X), positive to the right;
elevation = angle above the horizontal plane, positive up.
"""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np

# Beyond this, "which way the camera faces" has no horizontal meaning and az_offset breaks down.
MAX_AXIS_ELEVATION_DEG = 75.0


@dataclass(frozen=True)
class Level:
    """Rotation from the camera model's frame to the level frame (yaw-free by construction)."""

    rotation: np.ndarray  # rows X, Y, Z of the level frame, in camera-model coordinates
    source: str  # 'label' | 'sensor' | 'manual' | 'assumed'

    def angles(self, rays: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
        """(az_offset_deg, elev_deg) of unit rays given in the camera model's frame."""
        w = np.asarray(rays, float) @ self.rotation.T
        az = np.degrees(np.arctan2(w[..., 1], w[..., 0]))
        el = np.degrees(np.arcsin(np.clip(-w[..., 2], -1.0, 1.0)))
        return az, el

    def rays(self, az_deg: np.ndarray, el_deg: np.ndarray) -> np.ndarray:
        """Inverse of angles(): unit rays in the camera model's frame."""
        az, el = np.radians(az_deg), np.radians(el_deg)
        w = np.stack([np.cos(el) * np.cos(az), np.cos(el) * np.sin(az), -np.sin(el)], axis=-1)
        return w @ self.rotation


def level_from_gravity(gravity: np.ndarray, forward: np.ndarray, source: str) -> Level:
    """gravity: direction of 'down' in the camera model's frame. forward: the optical axis there."""
    z = np.asarray(gravity, float)
    z = z / np.linalg.norm(z)
    f = np.asarray(forward, float)
    f = f / np.linalg.norm(f)
    x = f - (f @ z) * z
    if np.linalg.norm(x) < np.sin(np.radians(90 - MAX_AXIS_ELEVATION_DEG)):
        raise ValueError(f'camera points within {90 - MAX_AXIS_ELEVATION_DEG:.0f} deg of straight up or down')
    x = x / np.linalg.norm(x)
    y = np.cross(z, x)
    return Level(np.stack([x, y, z]), source)


def gravity_from_pitch_roll(pitch_deg: float, roll_deg: float) -> np.ndarray:
    """Gravity in the pinhole camera frame (x right, y down, z forward).

    pitch: optical axis above the horizon, positive up.
    roll: rotation about the optical axis, positive when the camera's right side dips
    (clockwise as seen from behind the camera; the horizon then tilts the other way in the photo).
    """
    p, r = np.radians(pitch_deg), np.radians(roll_deg)
    return np.array([np.sin(r) * np.cos(p), np.cos(r) * np.cos(p), -np.sin(p)])


def gravity_from_rover_attitude(q_wxyz: tuple[float, float, float, float]) -> np.ndarray:
    """Gravity in the rover navigation frame, from the rover's attitude quaternion.

    The quaternion (w, x, y, z) rotates rover-frame vectors into the local-level site frame
    (north, east, down). Only the third row of that rotation is used (where 'down' sits in the rover
    frame), so the rover's heading, which the quaternion also carries, is discarded here.
    """
    w, x, y, z = (float(c) for c in q_wxyz)
    n = np.sqrt(w * w + x * x + y * y + z * z)
    w, x, y, z = w / n, x / n, y / n, z / n
    down_row = np.array([2 * (x * z - w * y), 2 * (y * z + w * x), 1 - 2 * (x * x + y * y)])
    return down_row / np.linalg.norm(down_row)
