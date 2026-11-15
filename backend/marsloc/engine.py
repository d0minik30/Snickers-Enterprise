"""The engine's one entry point: a POST /locate body in, the result of CONTRACTS.md out.

Engine.locate() validates the request (contracts.py), turns each photo into what the matcher
takes, runs the matcher, finds the dominant feature and writes the result in the contract's
format. The HTTP server (api.py) and anything else that wants an answer call this.
"""
import math
import threading

import numpy as np

from . import __version__
from .constants import CONTRACT_VERSION, LANDING_SITE_LAT, LANDING_SITE_LON
from .contracts import LocateRequest
from .feature import dominant_feature, load_named_places
from .horizon.store import HorizonStore
from .match import Matcher, MatcherConfig, PhotoObservation
from .match.sun import heading_from_sun
from .terrain import Terrain

ANGLE_SIGMA_DEG = 0.1          # error of a traced skyline angle, unless a pixel is coarser than that
SUN_HEADING_SIGMA_DEG = 3.0    # how far a heading hint from the sun is trusted
LIKELIHOOD_SCALE = 255


class Engine:
    """Terrain, precomputed horizons and matcher, loaded once."""

    def __init__(self, terrain_dir=None, store_dir=None, config=MatcherConfig()):
        self.terrain = Terrain.open(terrain_dir)
        self.store = HorizonStore.load(store_dir)
        self.matcher = Matcher(self.terrain, self.store, config)
        self.places = load_named_places()
        self._lock = threading.Lock()      # one request at a time: the matcher uses every core anyway

    def observations(self, request):
        """The request's photos as the matcher's PhotoObservation list."""
        prior = request.options.prior
        where = (prior.lat, prior.lon) if prior else (LANDING_SITE_LAT, LANDING_SITE_LON)
        out = []
        for photo in request.photos:
            hint = None
            if photo.sun is not None and photo.time_utc:
                hint, _ = heading_from_sun(photo.time_utc, photo.sun.az_offset_deg, *where)
            pixel = photo.camera.hfov_deg / photo.camera.width_px
            out.append(PhotoObservation(
                az_offset_deg=[s.az_offset_deg for s in photo.samples],
                elev_deg=[s.elev_deg for s in photo.samples],
                weight=[s.weight for s in photo.samples],
                id=photo.id, eye_height_m=photo.eye_height_m,
                angle_sigma_deg=max(ANGLE_SIGMA_DEG, pixel),
                horizon_uncertainty_deg=photo.horizon_uncertainty_deg,
                roll_uncertainty_deg=photo.roll_uncertainty_deg,
                relative_heading_deg=photo.relative_heading_deg,
                heading_prior_deg=hint, heading_prior_sigma_deg=SUN_HEADING_SIGMA_DEG))
        return out

    def locate(self, body):
        """body: the POST /locate body as a dict (or a LocateRequest). Returns the result dict.
        Raises pydantic.ValidationError if the body breaks the contract."""
        request = body if isinstance(body, LocateRequest) else LocateRequest.model_validate(body)
        observations = self.observations(request)
        prior = request.options.prior
        with self._lock:
            result = self.matcher.locate(observations,
                                         prior=(prior.lat, prior.lon, prior.radius_m) if prior else None,
                                         top_k=request.options.top_k)
        return self.to_contract(request, result)

    def to_contract(self, request, result):
        """A MatchResult in the format of CONTRACTS.md, section 3."""
        best = result.best
        eye = float(np.mean([p.eye_height_m for p in request.photos]))
        feature = dominant_feature(self.terrain, best.lat, best.lon, eye, best.photos, self.places)
        out = {
            "contract_version": request.contract_version,
            "status": result.status,
            "warnings": list(result.warnings),
            "best": {**_place(best), "ground_elevation_m": _num(best.ground_m, 1),
                     "uncertainty_m": _num(result.uncertainty_m, 0),
                     "uncertainty_95_m": _num(result.uncertainty_95_m, 0)},
            "candidates": [{"rank": c.rank, **_place(c)} for c in result.candidates],
            "likelihood_grid": _grid(result) if request.options.include_likelihood_grid else None,
            "dominant_feature": None if feature is None else {
                key: (value if isinstance(value, (str, type(None))) else _num(value, 6 if key in ("lat", "lon") else 2))
                for key, value in feature.items()},
            "photos": [_photo(fit, request.options.include_residuals) for fit in best.photos],
            "engine": {"version": __version__, "contract_version": CONTRACT_VERSION,
                       "terrain_sources": list(self.terrain.source_ids),
                       "candidate_spacing_m": round(float(self.store.meta["spacing_m"])),
                       "timing_ms": result.timing_ms},
        }
        if feature is None:
            out["warnings"].append("the matched skyline has no distant feature that stands out")
        return out


def _num(value, digits):
    """A number for JSON: rounded, or None if it isn't finite."""
    if value is None or not math.isfinite(value):
        return None
    return round(float(value), digits)


def _place(candidate):
    return {"lat": _num(candidate.lat, 6), "lon": _num(candidate.lon, 6),
            "east_m": _num(candidate.east_m, 1), "north_m": _num(candidate.north_m, 1),
            "heading_deg": _num(candidate.heading_deg % 360.0, 2), "score": _num(candidate.score, 3),
            "probability": _num(candidate.probability, 3)}


def _grid(result):
    """The likelihood map as integers 0..255, cropped to the box that holds everything above 0."""
    grid = result.grid
    values = np.rint(np.nan_to_num(result.likelihood) * LIKELIHOOD_SCALE).astype(int)
    rows, cols = np.nonzero(values > 0)
    r0, r1, c0, c1 = (rows.min(), rows.max() + 1, cols.min(), cols.max() + 1) if rows.size \
        else (0, grid.rows, 0, grid.cols)
    lat_top = grid.lat_max - r0 * grid.dlat
    lon_left = grid.lon_min + c0 * grid.dlon
    return {"bounds": [[round(lat_top - (r1 - r0) * grid.dlat, 7), round(lon_left, 7)],
                       [round(lat_top, 7), round(lon_left + (c1 - c0) * grid.dlon, 7)]],
            "rows": int(r1 - r0), "cols": int(c1 - c0),
            "cell_size_m": {key: round(value, 1) for key, value in grid.cell_size_m.items()},
            "scale": LIKELIHOOD_SCALE, "values": values[r0:r1, c0:c1].tolist()}


def _photo(fit, with_residuals):
    out = {"id": fit.id, "heading_deg": _num(fit.heading_deg % 360.0, 2),
           "horizon_shift_deg": _num(fit.horizon_shift_deg, 3),
           "horizon_tilt_deg": _num(fit.horizon_tilt_deg, 3),
           "rms_residual_deg": _num(fit.rms_residual_deg, 3),
           "median_abs_residual_deg": _num(fit.median_abs_residual_deg, 3),
           "inlier_fraction": _num(fit.inlier_fraction, 3)}
    if with_residuals:
        out["residuals"] = [
            {"az_offset_deg": _num(fit.az_offset_deg[i], 2), "observed_elev_deg": _num(fit.observed_elev_deg[i], 3),
             "model_elev_deg": _num(fit.model_elev_deg[i], 3), "residual_deg": _num(fit.residual_deg[i], 3),
             "distance_m": _num(fit.distance_m[i], 0), "used": bool(fit.used[i])}
            for i in np.flatnonzero(np.isfinite(fit.observed_elev_deg))]
    return out
