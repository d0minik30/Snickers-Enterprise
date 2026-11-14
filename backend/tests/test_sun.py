import datetime

import pytest

from marsloc.constants import LANDING_SITE_LAT, LANDING_SITE_LON
from marsloc.match import sun


def test_matches_the_published_mars24_worked_example():
    # NASA GISS, Mars24 "Algorithm and Worked Examples": 2000-01-06 00:00:00 UTC
    state = sun.mars_solar_state("2000-01-06T00:00:00Z")
    assert state["ls_deg"] == pytest.approx(277.18758, abs=2e-4)
    assert state["eot_deg"] == pytest.approx(-5.18774, abs=2e-4)
    assert state["mtc_hours"] == pytest.approx(23.99425, abs=2e-5)          # 23:59:39
    assert state["declination_deg"] == pytest.approx(-25.22838, abs=2e-4)
    assert (360.0 - state["subsolar_lon_east_deg"]) == pytest.approx(174.72600, abs=5e-4)  # west


def test_perseverance_landed_in_the_local_afternoon_in_early_spring():
    # Touchdown on Mars was about 20:44 UTC on 2021-02-18 (the news reached Earth at 20:55, after
    # 11 minutes of signal delay): about 15:53 local mean solar time at Jezero, Ls about 5 deg.
    landing = "2021-02-18T20:43:49Z"
    lmst = sun.local_mean_solar_time_hours(landing, LANDING_SITE_LON)
    assert lmst == pytest.approx(15.0 + 53.0 / 60.0, abs=0.03)
    assert sun.mars_solar_state(landing)["ls_deg"] == pytest.approx(5.2, abs=0.6)
    azimuth, elevation = sun.sun_position(landing, LANDING_SITE_LAT, LANDING_SITE_LON)
    assert 180.0 < azimuth < 300.0          # afternoon sun stands in the west
    assert 20.0 < elevation < 45.0


def test_sun_is_overhead_at_the_subsolar_point_and_moves_east_to_west():
    moment = "2026-11-15T10:20:00Z"
    state = sun.mars_solar_state(moment)
    _, elevation = sun.sun_position(moment, state["declination_deg"], state["subsolar_lon_east_deg"])
    assert elevation == pytest.approx(90.0, abs=1e-3)
    # 30 deg of longitude further east it is 2 hours later: the sun has moved to the west
    az_east, el_east = sun.sun_position(moment, 0.0, state["subsolar_lon_east_deg"] + 30.0)
    az_west, el_west = sun.sun_position(moment, 0.0, state["subsolar_lon_east_deg"] - 30.0)
    assert 180.0 < az_east < 360.0 and 0.0 < az_west < 180.0
    assert el_east == pytest.approx(el_west, abs=1e-6) and 55.0 < el_east < 61.0


def test_heading_is_sun_azimuth_minus_its_offset_in_the_image():
    moment = "2021-02-18T20:55:00Z"
    azimuth, elevation = sun.sun_position(moment, LANDING_SITE_LAT, LANDING_SITE_LON)
    # The sun 12.4 deg to the LEFT of the image centre: the camera faces 12.4 deg right of the sun
    heading, sun_elev = sun.heading_from_sun(moment, -12.4, LANDING_SITE_LAT, LANDING_SITE_LON)
    assert heading == pytest.approx((azimuth + 12.4) % 360.0) and sun_elev == elevation
    heading, _ = sun.heading_from_sun(moment, azimuth - 1.0, LANDING_SITE_LAT, LANDING_SITE_LON)
    assert heading == pytest.approx(1.0)


def test_time_parsing_accepts_z_offsets_and_datetimes():
    a = sun.parse_time_utc("2026-11-15T10:20:00Z")
    b = sun.parse_time_utc("2026-11-15T11:20:00+01:00")
    c = sun.parse_time_utc(datetime.datetime(2026, 11, 15, 10, 20, tzinfo=datetime.timezone.utc))
    assert a == b == c and sun.parse_time_utc("2026-11-15T10:20:00") == a
