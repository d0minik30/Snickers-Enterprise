"""Horizon renderer: the skyline the terrain produces from a camera position.

For each azimuth a ray is marched outward from the camera. The horizon in that direction is
the highest elevation angle of any terrain along the ray, with Mars's curvature included
(geo.tan_elevation). The terrain point that made it is kept too: its distance tells near
terrain from far, and its location names the feature.

How the march works:
- Distances start one step from the camera. The step is step_min_m near the camera and grows
  with distance (step_growth * distance), so far terrain costs few samples.
- Far away the terrain is read from averaged, coarser levels that match the step
  (Terrain.height's min_cell_m).
- A ridge crest can fall between two samples. So the few highest samples of each ray are
  refined: the stretch around each is sampled again at finer spacing.

A horizon value belongs to the ray at the bin's centre azimuth; it is not the maximum over
the bin's width.
"""
import functools
import math
from dataclasses import dataclass

import numpy as np

from .. import geo
from ..constants import DEFAULT_EYE_HEIGHT_M, MARS_RADIUS_M


@dataclass(frozen=True)
class RenderConfig:
    az_step_deg: float = 0.25          # azimuth bin width; 360 / az_step_deg must be whole
    max_range_m: float = 40000.0       # how far the rays go
    step_min_m: float | None = None    # step near the camera; None = half the terrain cell there
    step_growth: float = 0.004         # step = max(step_min_m, step_growth * distance)
    refine_top: int = 3                # how many of a ray's highest samples to refine
    refine_sub: int = 8                # extra samples around each of them

    def azimuths(self):
        """Bin centres in degrees clockwise from north: 0, az_step, 2 * az_step, ..."""
        n = round(360.0 / self.az_step_deg)
        if n < 1 or abs(n * self.az_step_deg - 360.0) > 1e-9:
            raise ValueError("az_step_deg must divide 360 evenly, got %r" % self.az_step_deg)
        return np.arange(n) * self.az_step_deg

    def to_json(self):
        return {"az_step_deg": self.az_step_deg, "max_range_m": self.max_range_m,
                "step_min_m": self.step_min_m, "step_growth": self.step_growth,
                "refine_top": self.refine_top, "refine_sub": self.refine_sub}


@dataclass
class Horizon:
    """A rendered horizon. Arrays have one entry per azimuth, NaN where the ray met no terrain."""
    lat: float                  # camera position, degrees
    lon: float
    ground_m: float             # terrain height under the camera
    eye_height_m: float         # camera height above that ground
    az_deg: np.ndarray          # azimuth of each ray, degrees clockwise from north
    elev_deg: np.ndarray        # elevation angle of the horizon, degrees above horizontal
    dist_m: np.ndarray          # ground distance to the terrain point that forms it
    src_lat: np.ndarray         # that point's position ...
    src_lon: np.ndarray
    src_height_m: np.ndarray    # ... and height
    reach_m: np.ndarray         # how far along the ray the terrain data goes

    def near_fraction(self, threshold_m):
        """Share of the rays whose horizon is formed by terrain closer than threshold_m."""
        seen = np.isfinite(self.dist_m)
        return float((self.dist_m[seen] < threshold_m).mean()) if seen.any() else float("nan")


@functools.lru_cache(maxsize=32)
def range_schedule(step_min_m, step_growth, max_range_m):
    """Sample distances along a ray and the step size at each: (distances, steps)."""
    if step_min_m <= 0 or max_range_m < step_min_m or step_growth < 0:
        raise ValueError("need 0 < step_min_m <= max_range_m and step_growth >= 0")
    distances = [step_min_m]
    while True:
        nxt = distances[-1] + max(step_min_m, step_growth * distances[-1])
        if nxt > max_range_m:
            break
        distances.append(nxt)
    distances = np.array(distances)
    steps = np.maximum(step_min_m, step_growth * distances)
    distances.setflags(write=False)
    steps.setflags(write=False)
    return distances, steps


def _detail(step_m):
    """The terrain detail worth reading for a sampling step: the step rounded down to a power
    of two, so only a handful of different levels are asked for."""
    return 2.0 ** np.floor(np.log2(step_m))


def render_horizon(terrain, lat, lon, eye_height_m=DEFAULT_EYE_HEIGHT_M, config=RenderConfig(),
                   azimuths_deg=None):
    """Horizon seen from (lat, lon) at eye_height_m above the ground.

    azimuths_deg: the ray directions; default all of config.azimuths() (the full circle).
    Raises ValueError if the terrain has no data under the camera.
    """
    lat, lon = float(lat), float(lon)
    ground = terrain.height(lat, lon)
    if not math.isfinite(ground):
        raise ValueError("No terrain data under the camera at lat %.6f, lon %.6f" % (lat, lon))
    cam = ground + eye_height_m
    step_min = config.step_min_m
    if step_min is None:
        step_min = max(0.5, 0.5 * terrain.finest_cell_m(lat, lon))
    dist, step = range_schedule(float(step_min), float(config.step_growth), float(config.max_range_m))
    az = config.azimuths() if azimuths_deg is None else np.atleast_1d(np.asarray(azimuths_deg, float))
    n_az, n_d = az.size, dist.size

    # Sample points: great-circle destination from the camera, as outer products of the
    # per-azimuth and per-distance parts (same formula as geo.destination).
    sin_lat, cos_lat = math.sin(math.radians(lat)), math.cos(math.radians(lat))
    theta = dist / MARS_RADIUS_M
    sin_d, cos_d = np.sin(theta), np.cos(theta)
    sin_b, cos_b = np.sin(np.radians(az)), np.cos(np.radians(az))
    sin_lat2 = sin_lat * cos_d[None, :] + (cos_lat * sin_d)[None, :] * cos_b[:, None]
    lat2 = np.degrees(np.arcsin(sin_lat2))
    lon2 = lon + np.degrees(np.arctan2(sin_b[:, None] * (sin_d * cos_lat)[None, :],
                                       cos_d[None, :] - sin_lat * sin_lat2))

    # Heights, read at a level of detail that matches the step at each distance.
    detail = _detail(step)
    height = np.empty((n_az, n_d))
    starts = np.flatnonzero(np.diff(detail, prepend=-1.0))
    for j0, j1 in zip(starts, np.append(starts[1:], n_d)):
        height[:, j0:j1] = terrain.height(lat2[:, j0:j1], lon2[:, j0:j1], min_cell_m=float(detail[j0]))

    r_point = MARS_RADIUS_M + height
    tan = (r_point * cos_d[None, :] - (MARS_RADIUS_M + cam)) / (r_point * sin_d[None, :])
    seen = np.isfinite(height)
    tan[~seen] = -np.inf

    rows = np.arange(n_az)
    j_best = np.argmax(tan, axis=1)
    best_tan = tan[rows, j_best]
    best_dist = dist[j_best]
    best_height = height[rows, j_best]

    # Refine around each ray's highest samples: a crest between two samples is found here.
    k = min(config.refine_top, n_d)
    if k > 0 and config.refine_sub > 0:
        top = np.argpartition(tan, n_d - k, axis=1)[:, n_d - k:]
        lo = dist[np.maximum(top - 1, 0)]
        hi = dist[np.minimum(top + 1, n_d - 1)]
        t = (np.arange(config.refine_sub) + 1.0) / (config.refine_sub + 1.0)
        d_sub = lo[:, :, None] + (hi - lo)[:, :, None] * t[None, None, :]
        sub_detail = _detail(np.maximum((hi - lo) / (config.refine_sub + 1.0), 1e-3))
        lat_s, lon_s = geo.destination(lat, lon, az[:, None, None], d_sub)
        h_sub = terrain.height(lat_s, lon_s,
                               min_cell_m=np.broadcast_to(sub_detail[:, :, None], d_sub.shape))
        tan_sub = geo.tan_elevation(cam, h_sub, d_sub)
        tan_sub[~np.isfinite(h_sub)] = -np.inf
        tan_sub = tan_sub.reshape(n_az, -1)
        j_sub = np.argmax(tan_sub, axis=1)
        better = tan_sub[rows, j_sub] > best_tan
        best_tan = np.where(better, tan_sub[rows, j_sub], best_tan)
        best_dist = np.where(better, d_sub.reshape(n_az, -1)[rows, j_sub], best_dist)
        best_height = np.where(better, h_sub.reshape(n_az, -1)[rows, j_sub], best_height)

    found = np.isfinite(best_tan)
    elev = np.where(found, np.degrees(np.arctan(np.where(found, best_tan, 0.0))), np.nan)
    best_dist = np.where(found, best_dist, np.nan)
    best_height = np.where(found, best_height, np.nan)
    src_lat, src_lon = geo.destination(lat, lon, az, np.where(found, best_dist, 0.0))
    last = n_d - 1 - np.argmax(seen[:, ::-1], axis=1)
    reach = np.where(seen.any(axis=1), dist[last], 0.0)

    return Horizon(lat=lat, lon=lon, ground_m=float(ground), eye_height_m=float(eye_height_m),
                   az_deg=az, elev_deg=elev, dist_m=best_dist,
                   src_lat=np.where(found, src_lat, np.nan), src_lon=np.where(found, src_lon, np.nan),
                   src_height_m=best_height, reach_m=reach)
