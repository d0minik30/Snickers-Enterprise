"""Geometry on the Mars 2000 sphere.

Conventions (CONTRACTS.md, section 0):
- latitude and longitude in degrees, east-positive longitude;
- azimuth, bearing and heading in degrees clockwise from north (east = 90);
- elevation angle in degrees above the camera's local horizontal;
- east_m / north_m: metres from an origin (the landing site unless told otherwise). With
  d = great-circle distance and b = initial bearing from the origin to the point,
  east = d * sin(b) and north = d * cos(b). This matches distanceM / bearingDeg /
  destination in frontend/lib/nav/geo.ts.

Every function takes scalars or numpy arrays and broadcasts.
"""
import numpy as np

from .constants import LANDING_SITE_LAT, LANDING_SITE_LON, MARS_RADIUS_M

LANDING_SITE = (LANDING_SITE_LAT, LANDING_SITE_LON)


def wrap360(angle_deg):
    """Angle in degrees brought into 0 <= angle < 360."""
    wrapped = np.mod(angle_deg, 360.0)
    return np.where(wrapped >= 360.0, 0.0, wrapped) if np.ndim(wrapped) else float(wrapped) % 360.0


def angle_diff(a_deg, b_deg):
    """a - b in degrees, brought into -180 <= difference < 180."""
    return np.mod(np.asarray(a_deg, dtype=float) - b_deg + 180.0, 360.0) - 180.0


def distance_m(lat1, lon1, lat2, lon2):
    """Great-circle distance in metres (haversine)."""
    p1, p2 = np.radians(lat1), np.radians(lat2)
    d_lat = p2 - p1
    d_lon = np.radians(lon2) - np.radians(lon1)
    h = np.sin(d_lat / 2) ** 2 + np.cos(p1) * np.cos(p2) * np.sin(d_lon / 2) ** 2
    return 2 * MARS_RADIUS_M * np.arcsin(np.minimum(1.0, np.sqrt(h)))


def bearing_deg(lat1, lon1, lat2, lon2):
    """Initial bearing from point 1 to point 2: 0..360, 0 = north, clockwise."""
    p1, p2 = np.radians(lat1), np.radians(lat2)
    d_lon = np.radians(lon2) - np.radians(lon1)
    y = np.sin(d_lon) * np.cos(p2)
    x = np.cos(p1) * np.sin(p2) - np.sin(p1) * np.cos(p2) * np.cos(d_lon)
    return np.mod(np.degrees(np.arctan2(y, x)), 360.0)


def destination(lat, lon, bearing, dist_m):
    """Point reached from (lat, lon) after dist_m metres along the great circle that
    starts at the given bearing. Returns (lat, lon) in degrees."""
    d = np.asarray(dist_m, dtype=float) / MARS_RADIUS_M
    b = np.radians(bearing)
    p1 = np.radians(lat)
    sin_p2 = np.sin(p1) * np.cos(d) + np.cos(p1) * np.sin(d) * np.cos(b)
    p2 = np.arcsin(np.clip(sin_p2, -1.0, 1.0))
    l2 = np.radians(lon) + np.arctan2(np.sin(b) * np.sin(d) * np.cos(p1),
                                      np.cos(d) - np.sin(p1) * sin_p2)
    return np.degrees(p2), np.mod(np.degrees(l2) + 540.0, 360.0) - 180.0


def latlon_to_local(lat, lon, origin=LANDING_SITE):
    """(east_m, north_m) of a point, measured from the origin (lat, lon)."""
    d = distance_m(origin[0], origin[1], lat, lon)
    b = np.radians(bearing_deg(origin[0], origin[1], lat, lon))
    return d * np.sin(b), d * np.cos(b)


def local_to_latlon(east_m, north_m, origin=LANDING_SITE):
    """(lat, lon) of the point east_m, north_m metres from the origin."""
    east_m = np.asarray(east_m, dtype=float)
    north_m = np.asarray(north_m, dtype=float)
    d = np.hypot(east_m, north_m)
    b = np.degrees(np.arctan2(east_m, north_m))
    return destination(origin[0], origin[1], b, d)


def tan_elevation(cam_height_m, height_m, dist_m):
    """Tangent of the elevation angle of a terrain point seen from a camera.

    cam_height_m: camera height (ground + eye height); height_m: height of the terrain
    point; both in metres above the datum. dist_m: ground distance between them, measured
    on the sphere. Mars's curvature is exact here: the point at angle dist/R around the
    planet is compared with the camera's own horizontal plane.
    """
    theta = np.asarray(dist_m, dtype=float) / MARS_RADIUS_M
    r_point = MARS_RADIUS_M + np.asarray(height_m, dtype=float)
    r_cam = MARS_RADIUS_M + np.asarray(cam_height_m, dtype=float)
    return (r_point * np.cos(theta) - r_cam) / (r_point * np.sin(theta))


def elevation_angle_deg(cam_height_m, height_m, dist_m):
    """Elevation angle in degrees of a terrain point seen from a camera; see tan_elevation.

    About (height - cam_height - dist^2 / 2R) / dist for small angles: terrain 20 km away
    sits 59 m lower than on a flat planet.
    """
    return np.degrees(np.arctan(tan_elevation(cam_height_m, height_m, dist_m)))


def curvature_drop_m(dist_m):
    """How far the ground falls below a flat tangent plane at ground distance dist_m."""
    theta = np.asarray(dist_m, dtype=float) / MARS_RADIUS_M
    return MARS_RADIUS_M * (1.0 / np.cos(theta) - 1.0)
