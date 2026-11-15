"""The dominant distant feature of a matched skyline: which mountain, butte or rim section
stands out, where it is and how far away.

The matched horizon knows, for every azimuth bin, which terrain point forms it. The feature is
the most prominent peak of that horizon among the bins formed by distant terrain. Its distance
is checked a second way: from the height difference and the elevation angle, with Mars's
curvature (CONTRACTS.md, section 3, dominant_feature).
"""
import json
import math
from pathlib import Path

import numpy as np

from . import geo
from .constants import MARS_RADIUS_M

MIN_DISTANCE_M = 1000.0      # closer terrain is not a "distant feature"
MIN_PROMINENCE_DEG = 0.1     # below this the skyline has no feature worth naming
NAME_WITHIN_M = 2500.0       # a named place this close to the feature lends it its name


def prominence(values):
    """Prominence of every point of a 1-D profile: how far it rises above the lowest point that
    separates it from higher ground. Where higher ground lies on both sides, the higher of the
    two separating low points counts; where the profile ends (or has a gap) before any higher
    ground, that side doesn't count; the highest point is measured from the lowest point
    reached on either side. NaN entries are gaps and get NaN."""
    values = np.asarray(values, dtype=np.float64)
    out = np.full(values.shape, np.nan)
    for i in np.flatnonzero(np.isfinite(values)):
        closed, lows = [], []
        for step in (-1, 1):
            low = values[i]
            j = i + step
            while 0 <= j < values.size and np.isfinite(values[j]) and values[j] <= values[i]:
                low = min(low, values[j])
                j += step
            lows.append(low)
            if 0 <= j < values.size and np.isfinite(values[j]):     # stopped by higher ground
                closed.append(low)
        out[i] = values[i] - (max(closed) if closed else min(lows))
    return out


def distance_from_angle(cam_height_m, feature_height_m, elev_deg):
    """Ground distance at which a point of feature_height_m appears at elev_deg from a camera
    at cam_height_m, with curvature: solves (dh - d^2 / 2R) / d = tan(elev). NaN if the
    feature can't be seen at that angle."""
    rise = feature_height_m - cam_height_m
    t = math.tan(math.radians(elev_deg))
    inside = t * t + 2.0 * rise / MARS_RADIUS_M
    if inside < 0:
        return float("nan")
    d = MARS_RADIUS_M * (-t + math.sqrt(inside))
    return d if d > 0 else float("nan")


def load_named_places(path=None):
    """[(name, lat, lon)] from data/output/places.geojson (read-only; [] if it isn't there)."""
    path = Path(path) if path else Path(__file__).resolve().parents[2] / "data" / "output" / "places.geojson"
    try:
        features = json.loads(path.read_text(encoding="utf-8"))["features"]
    except (OSError, ValueError, KeyError):
        return []
    places = []
    for feature in features:
        try:
            lon, lat = feature["geometry"]["coordinates"][:2]
            places.append((str(feature["properties"]["name"]), float(lat), float(lon)))
        except (KeyError, TypeError, ValueError):
            continue
    return places


def dominant_feature(terrain, lat, lon, eye_height_m, photo_fits, places=()):
    """The dominant feature of the matched skyline, as the dict of CONTRACTS.md section 3,
    or None if no photo shows a distant feature.

    lat, lon: the matched position. photo_fits: match.fine.PhotoFit per photo (their
    model_elev_deg, distance_m, az_offset_deg, heading_deg).
    """
    best = None
    for fit in photo_fits:
        elev = np.where(np.isfinite(fit.model_elev_deg) & (fit.distance_m < 1e8), fit.model_elev_deg, np.nan)
        distant = np.isfinite(elev) & (fit.distance_m >= MIN_DISTANCE_M)
        if not distant.any():
            continue
        rise = np.where(distant, prominence(elev), -np.inf)
        k = int(np.argmax(rise))
        if rise[k] >= MIN_PROMINENCE_DEG and (best is None or rise[k] > best[0]):
            best = (float(rise[k]), fit, k)
    if best is None:
        return None
    rise, fit, k = best
    azimuth = float((fit.heading_deg + fit.az_offset_deg[k]) % 360.0)
    distance = float(fit.distance_m[k])
    f_lat, f_lon = (float(v) for v in geo.destination(lat, lon, azimuth, distance))
    height = float(terrain.height(f_lat, f_lon))
    cam = float(terrain.height(lat, lon)) + eye_height_m
    elev = float(fit.model_elev_deg[k])
    east, north = geo.latlon_to_local(f_lat, f_lon)
    name = None
    if places:
        away = [float(geo.distance_m(f_lat, f_lon, p_lat, p_lon)) for _, p_lat, p_lon in places]
        nearest = int(np.argmin(away))
        if away[nearest] <= NAME_WITHIN_M:
            name = places[nearest][0]
    check = distance_from_angle(cam, height, elev) if math.isfinite(height) else float("nan")
    return {"name": name, "lat": f_lat, "lon": f_lon, "east_m": float(east), "north_m": float(north),
            "elevation_m": height, "distance_m": distance, "distance_check_m": check,
            "azimuth_deg": azimuth, "elev_angle_deg": elev, "prominence_deg": rise,
            "photo_id": fit.id, "az_offset_deg": float(fit.az_offset_deg[k])}
