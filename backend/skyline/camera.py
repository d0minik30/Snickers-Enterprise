"""Camera models: pixel <-> viewing direction.

Pixel coordinates are (u, v) = (column, row), 0-based, with (0, 0) the centre of the top-left pixel.
Directions are 3-vectors in the model's own frame:

- Pinhole: x right, y down, z forward (the usual computer-vision camera frame).
- Cahvore: whatever frame the CAHVORE vectors are given in (for Perseverance raw images, the rover
  navigation frame: x forward, y right, z down).

Skyline points are kilometres away, so only directions matter. That lets the CAHVORE model drop its
entrance-pupil terms (C and E), which shift the ray by centimetres but do not turn it.
"""

from __future__ import annotations

from dataclasses import dataclass, field

import numpy as np

_NEWTON_STEPS = 30


def _unit(v: np.ndarray) -> np.ndarray:
    return v / np.linalg.norm(v, axis=-1, keepdims=True)


@dataclass(frozen=True)
class Pinhole:
    """Pinhole camera with Brown-Conrady distortion (k1, k2, k3 radial; p1, p2 tangential)."""

    width: int
    height: int
    fx: float
    fy: float
    cx: float
    cy: float
    k: tuple[float, float, float] = (0.0, 0.0, 0.0)
    p: tuple[float, float] = (0.0, 0.0)
    kind: str = field(default='pinhole', init=False)

    @staticmethod
    def from_fov(width: int, height: int, hfov_deg: float, vfov_deg: float | None = None,
                 k: tuple[float, float, float] = (0.0, 0.0, 0.0), p: tuple[float, float] = (0.0, 0.0)) -> 'Pinhole':
        """Square pixels unless both fields of view are given. Principal point at the image centre."""
        fx = (width / 2) / np.tan(np.radians(hfov_deg) / 2)
        fy = fx if vfov_deg is None else (height / 2) / np.tan(np.radians(vfov_deg) / 2)
        return Pinhole(width, height, float(fx), float(fy), (width - 1) / 2, (height - 1) / 2, k, p)

    @property
    def forward(self) -> np.ndarray:
        return np.array([0.0, 0.0, 1.0])

    def _distort(self, x: np.ndarray, y: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
        k1, k2, k3 = self.k
        p1, p2 = self.p
        r2 = x * x + y * y
        radial = 1 + k1 * r2 + k2 * r2 ** 2 + k3 * r2 ** 3
        xd = x * radial + 2 * p1 * x * y + p2 * (r2 + 2 * x * x)
        yd = y * radial + p1 * (r2 + 2 * y * y) + 2 * p2 * x * y
        return xd, yd

    def ray_to_pixel(self, d: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
        d = np.atleast_2d(np.asarray(d, float))
        x, y = d[:, 0] / d[:, 2], d[:, 1] / d[:, 2]
        xd, yd = self._distort(x, y)
        return self.fx * xd + self.cx, self.fy * yd + self.cy

    def pixel_to_ray(self, u: np.ndarray, v: np.ndarray) -> np.ndarray:
        xd = (np.asarray(u, float) - self.cx) / self.fx
        yd = (np.asarray(v, float) - self.cy) / self.fy
        x, y = xd.copy(), yd.copy()
        if any(self.k) or any(self.p):
            for _ in range(_NEWTON_STEPS):  # fixed-point undistortion; converges for real lenses
                ex, ey = self._distort(x, y)
                x, y = x - (ex - xd), y - (ey - yd)
        return _unit(np.stack([x, y, np.ones_like(x)], axis=-1))


@dataclass(frozen=True)
class Cahvore:
    """JPL CAHVOR / CAHVORE camera model, direction-only (see module docstring).

    linearity: 1 = perspective (CAHVOR), 0 = fish-eye, anything else = general (mtype 3).
    """

    width: int
    height: int
    A: np.ndarray
    H: np.ndarray
    V: np.ndarray
    O: np.ndarray
    R: tuple[float, float, float]
    linearity: float = 1.0
    C: np.ndarray | None = None  # kept for the eye height; not used for directions
    kind: str = field(default='cahvore', init=False)

    @staticmethod
    def from_components(text: str, width: int, height: int) -> 'Cahvore':
        """Parse the raw-image feed's camera_model_component_list: "(C);(A);(H);(V);(O);(R);(E);mtype;mparm"."""
        parts = [p.strip() for p in text.split(';')]
        vecs = [np.array([float(x) for x in p.strip('()').split(',')]) for p in parts if p.startswith('(')]
        scalars = [float(p) for p in parts if not p.startswith('(')]
        if len(vecs) < 4:
            raise ValueError('camera model needs at least C, A, H, V')
        C, A, H, V = vecs[:4]
        O = vecs[4] if len(vecs) > 4 else A
        R = tuple(vecs[5]) if len(vecs) > 5 else (0.0, 0.0, 0.0)
        mtype, mparm = (scalars + [1.0, 0.0])[:2] if len(vecs) > 6 else (1.0, 0.0)
        linearity = {1.0: 1.0, 2.0: 0.0}.get(mtype, mparm)
        return Cahvore(width, height, _unit(A), H, V, _unit(O), R, linearity, C)  # type: ignore[arg-type]

    @property
    def forward(self) -> np.ndarray:
        return self.A

    def _chi_of_theta(self, theta: np.ndarray) -> np.ndarray:
        L = self.linearity
        if L > 0:
            return np.tan(L * theta) / L
        if L < 0:
            return np.sin(L * theta) / L
        return theta

    def _theta_of_chi(self, chi: np.ndarray) -> np.ndarray:
        L = self.linearity
        if L > 0:
            return np.arctan(L * chi) / L
        if L < 0:
            return np.arcsin(np.clip(L * chi, -1, 1)) / L
        return chi

    def _mu(self, chi: np.ndarray) -> np.ndarray:
        r0, r1, r2 = self.R
        chi2 = chi * chi
        return r0 + r1 * chi2 + r2 * chi2 * chi2

    def ray_to_pixel(self, d: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
        d = _unit(np.atleast_2d(np.asarray(d, float)))
        zeta = d @ self.O
        lam = d - zeta[:, None] * self.O
        lam_len = np.linalg.norm(lam, axis=1)
        theta = np.arctan2(lam_len, zeta)
        chi = self._chi_of_theta(theta)
        lam_hat = np.divide(lam, lam_len[:, None], out=np.zeros_like(lam), where=lam_len[:, None] > 1e-12)
        p = self.O + ((1 + self._mu(chi)) * chi)[:, None] * lam_hat
        alpha = p @ self.A
        return (p @ self.H) / alpha, (p @ self.V) / alpha

    def pixel_to_ray(self, u: np.ndarray, v: np.ndarray) -> np.ndarray:
        u = np.asarray(u, float)
        v = np.asarray(v, float)
        # The pinhole (CAHV) ray through the pixel: the distorted direction p''.
        f = self.V[None, :] - v.reshape(-1, 1) * self.A[None, :]
        g = self.H[None, :] - u.reshape(-1, 1) * self.A[None, :]
        r = np.cross(f, g)
        r = np.where((r @ self.A)[:, None] < 0, -r, r)
        r = _unit(r)
        zeta = r @ self.O
        lam = r - zeta[:, None] * self.O
        lam_len = np.linalg.norm(lam, axis=1)
        rho = lam_len / zeta  # = (1 + mu(chi)) * chi
        chi = rho.copy()
        r0, r1, r2 = self.R
        for _ in range(_NEWTON_STEPS):
            c2 = chi * chi
            g_val = chi * (1 + r0 + r1 * c2 + r2 * c2 * c2) - rho
            g_der = 1 + r0 + 3 * r1 * c2 + 5 * r2 * c2 * c2
            step = g_val / g_der
            chi = chi - step
            if np.all(np.abs(step) < 1e-12):
                break
        theta = self._theta_of_chi(chi)
        lam_hat = np.divide(lam, lam_len[:, None], out=np.zeros_like(lam), where=lam_len[:, None] > 1e-12)
        d = np.cos(theta)[:, None] * self.O + np.sin(theta)[:, None] * lam_hat
        return _unit(d).reshape(u.shape + (3,))


CameraModel = Pinhole | Cahvore
