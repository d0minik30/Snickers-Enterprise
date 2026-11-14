import math

import numpy as np
import pytest

from marsloc import geo
from marsloc.constants import LANDING_SITE_LAT, LANDING_SITE_LON, MARS_RADIUS_M

R = MARS_RADIUS_M


def test_radius_matches_the_frontend_and_data_scripts():
    assert MARS_RADIUS_M == 3396190.0


def test_distance_along_a_meridian_is_radius_times_angle():
    assert geo.distance_m(18.0, 77.0, 19.0, 77.0) == pytest.approx(R * math.radians(1.0), abs=1e-6)


def test_distance_along_the_equator():
    assert geo.distance_m(0.0, 10.0, 0.0, 12.0) == pytest.approx(R * math.radians(2.0), abs=1e-6)


def test_bearings_follow_the_compass_clockwise_from_north():
    lat, lon = LANDING_SITE_LAT, LANDING_SITE_LON
    assert geo.bearing_deg(lat, lon, lat + 0.1, lon) == pytest.approx(0.0, abs=1e-9)
    assert geo.bearing_deg(lat, lon, lat - 0.1, lon) == pytest.approx(180.0, abs=1e-9)
    # A point at the same latitude a little to the east lies just north of due east
    # (the great circle bends toward the equator), a point to the west just south of due west.
    assert geo.bearing_deg(lat, lon, lat, lon + 0.1) == pytest.approx(90.0, abs=0.05)
    assert geo.bearing_deg(lat, lon, lat, lon - 0.1) == pytest.approx(270.0, abs=0.05)


def test_same_numbers_as_the_frontend_formulas():
    # Hand evaluation of distanceM / bearingDeg from frontend/lib/nav/geo.ts for the
    # landing site -> Western Delta Deposit (data/output/places.geojson).
    a = (18.4447, 77.4508)
    b = (18.505, 77.3643)
    d_lat, d_lon = math.radians(b[0] - a[0]), math.radians(b[1] - a[1])
    h = (math.sin(d_lat / 2) ** 2
         + math.cos(math.radians(a[0])) * math.cos(math.radians(b[0])) * math.sin(d_lon / 2) ** 2)
    expected_d = 2 * R * math.asin(math.sqrt(h))
    y = math.sin(d_lon) * math.cos(math.radians(b[0]))
    x = (math.cos(math.radians(a[0])) * math.sin(math.radians(b[0]))
         - math.sin(math.radians(a[0])) * math.cos(math.radians(b[0])) * math.cos(d_lon))
    expected_b = (math.degrees(math.atan2(y, x)) + 360) % 360
    assert geo.distance_m(*a, *b) == pytest.approx(expected_d, abs=1e-6)
    assert geo.bearing_deg(*a, *b) == pytest.approx(expected_b, abs=1e-9)
    assert 6000 < expected_d < 6100 and 300 < expected_b < 310  # north-west, about 6 km


def test_destination_inverts_distance_and_bearing():
    rng = np.random.default_rng(1)
    lat = LANDING_SITE_LAT + rng.uniform(-0.5, 0.5, 200)
    lon = LANDING_SITE_LON + rng.uniform(-0.5, 0.5, 200)
    d = geo.distance_m(LANDING_SITE_LAT, LANDING_SITE_LON, lat, lon)
    b = geo.bearing_deg(LANDING_SITE_LAT, LANDING_SITE_LON, lat, lon)
    lat2, lon2 = geo.destination(LANDING_SITE_LAT, LANDING_SITE_LON, b, d)
    assert geo.distance_m(lat, lon, lat2, lon2).max() < 1e-3  # under 1 mm


def test_local_frame_round_trip_is_under_a_millimetre():
    rng = np.random.default_rng(2)
    east = rng.uniform(-45000, 45000, 500)
    north = rng.uniform(-45000, 45000, 500)
    lat, lon = geo.local_to_latlon(east, north)
    east2, north2 = geo.latlon_to_local(lat, lon)
    assert np.abs(east2 - east).max() < 1e-3
    assert np.abs(north2 - north).max() < 1e-3


def test_local_frame_signs_and_origin():
    east, north = geo.latlon_to_local(LANDING_SITE_LAT, LANDING_SITE_LON)
    assert abs(east) < 1e-6 and abs(north) < 1e-6
    east, north = geo.latlon_to_local(LANDING_SITE_LAT, LANDING_SITE_LON + 0.01)
    along_parallel = R * math.radians(0.01) * math.cos(math.radians(LANDING_SITE_LAT))  # 562.3 m
    assert east > 0 and abs(north) < 0.1 and east == pytest.approx(along_parallel, abs=0.01)
    east, north = geo.latlon_to_local(LANDING_SITE_LAT + 0.01, LANDING_SITE_LON)
    assert north == pytest.approx(R * math.radians(0.01), abs=1e-4) and abs(east) < 1e-4
    lat, lon = geo.local_to_latlon(1000.0, 0.0)
    assert lon > LANDING_SITE_LON and lat == pytest.approx(LANDING_SITE_LAT, abs=1e-5)


def test_wrap360_and_angle_diff():
    assert geo.wrap360(-10.0) == pytest.approx(350.0)
    assert geo.wrap360(725.0) == pytest.approx(5.0)
    assert np.allclose(geo.wrap360(np.array([360.0, -0.5, 90.0])), [0.0, 359.5, 90.0])
    assert geo.angle_diff(10.0, 350.0) == pytest.approx(20.0)
    assert geo.angle_diff(350.0, 10.0) == pytest.approx(-20.0)
    assert geo.angle_diff(180.0, 0.0) == pytest.approx(-180.0)


def test_curvature_drop_is_59_m_at_20_km():
    assert geo.curvature_drop_m(20000.0) == pytest.approx(20000.0 ** 2 / (2 * R), rel=1e-4)
    assert geo.curvature_drop_m(20000.0) == pytest.approx(58.89, abs=0.01)


def test_elevation_angle_matches_the_small_angle_formula():
    cam, top, d = -2565.5, -2000.0, 10000.0
    approx = math.degrees(math.atan((top - cam - d * d / (2 * R)) / d))
    assert geo.elevation_angle_deg(cam, top, d) == pytest.approx(approx, abs=2e-3)
    assert geo.elevation_angle_deg(cam, top, d) == pytest.approx(3.152, abs=0.005)


def test_same_height_far_away_is_below_horizontal():
    # Ground at the camera's own height sits below 0 because the planet curves away.
    assert geo.elevation_angle_deg(0.0, 0.0, 20000.0) == pytest.approx(
        -math.degrees(20000.0 / (2 * R)), abs=1e-6)
    assert geo.elevation_angle_deg(0.0, 0.0, 20000.0) < -0.16


def test_horizon_dip_for_a_standing_astronaut():
    # On a smooth sphere the horizon is where the ray grazes the ground: dip = acos(Rg / Rc).
    ground, eye = -2567.0, 1.7
    d = np.linspace(100.0, 8000.0, 20001)
    dip = geo.elevation_angle_deg(ground + eye, ground, d).max()
    expected = -math.degrees(math.acos((R + ground) / (R + ground + eye)))
    assert dip == pytest.approx(expected, abs=1e-5)
    assert dip == pytest.approx(-0.0573, abs=0.0005)
