import math
from dataclasses import replace

import numpy as np
import pytest

from conftest import SOC_008_BOUNDS, cell_deg, grid_around, one_source
from marsloc import geo
from marsloc.constants import LANDING_SITE_LAT, LANDING_SITE_LON, MARS_RADIUS_M
from marsloc.horizon import RenderConfig, render_horizon
from marsloc.horizon.render import range_schedule

LAT0, LON0 = LANDING_SITE_LAT, LANDING_SITE_LON
FLOOR = -2567.0          # ground level of the made-up shapes, metres
EYE = 1.7
R = MARS_RADIUS_M
FINE = RenderConfig(step_min_m=0.5, step_growth=0.0, refine_top=0)   # brute force: every 0.5 m


# ---------------------------------------------------------------- the sampling plan

def test_range_schedule_grows_with_distance():
    dist, step = range_schedule(10.0, 0.008, 40000.0)
    assert dist[0] == 10.0 and dist[-1] == 40000.0          # the far end is always sampled
    gaps = np.diff(dist)
    assert np.allclose(gaps[:-1], np.maximum(10.0, 0.008 * dist[:-2]))
    assert gaps[0] == pytest.approx(10.0) and 0 < gaps[-1] <= 0.008 * dist[-2] + 1e-9
    assert np.allclose(step, np.maximum(10.0, 0.008 * dist))
    assert dist.size < 700      # far fewer than the 4000 samples of a fixed 10 m step


def test_azimuth_bins_start_at_north_and_go_clockwise():
    az = RenderConfig(az_step_deg=0.25).azimuths()
    assert az.size == 1440 and az[0] == 0.0 and az[360] == 90.0 and az[-1] == 359.75
    with pytest.raises(ValueError):
        RenderConfig(az_step_deg=0.7).azimuths()


# ---------------------------------------------------------------- curvature

def flat_terrain(half=250):
    bounds, lat2d, _ = grid_around(LAT0, LON0, half, half, 20.0)
    return one_source(bounds, np.full(lat2d.shape, FLOOR, dtype=np.float32))


def test_flat_ground_on_a_sphere_gives_the_horizon_dip():
    horizon = render_horizon(flat_terrain(), LAT0, LON0, EYE, RenderConfig(az_step_deg=5.0, max_range_m=4500.0))
    expected = -math.degrees(math.acos((R + FLOOR) / (R + FLOOR + EYE)))
    assert expected == pytest.approx(-0.0573, abs=0.0005)
    assert np.abs(horizon.elev_deg - expected).max() < 2e-4
    # The horizon is where the line of sight grazes the ground, 3.4 km away
    assert np.abs(horizon.dist_m - math.sqrt(2 * (R + FLOOR) * EYE)).max() < 150.0
    assert horizon.ground_m == pytest.approx(FLOOR) and horizon.eye_height_m == EYE


def test_a_higher_eye_sees_a_lower_horizon():
    horizon = render_horizon(flat_terrain(), LAT0, LON0, 10.0,
                             RenderConfig(max_range_m=4700.0), azimuths_deg=[0.0, 135.0])
    # From 10 m up the horizon would be 8.2 km away; the grid ends at 4.7 km, so the horizon
    # here is the grid's far edge. Its angle still follows the exact formula.
    expected = geo.elevation_angle_deg(FLOOR + 10.0, FLOOR, horizon.dist_m)
    assert np.allclose(horizon.elev_deg, expected, atol=1e-9)
    assert (horizon.elev_deg < -0.1).all() and (horizon.dist_m > 4600.0).all()


def test_a_59_m_wall_at_20_km_is_hidden_down_to_the_horizontal_by_curvature():
    # Flat ground out to 20 km, then a 59 m step up. On a flat planet its top would stand
    # 0.164 deg above horizontal. On Mars the ground has dropped 58.9 m by then, so the top
    # sits just below horizontal: by the 1.7 m eye height and a hair more.
    wall, wall_dist = 59.0, 20000.0
    bounds, lat2d, lon2d = grid_around(LAT0, LON0, 40, 1150, 20.0)
    dist = geo.distance_m(LAT0, LON0, lat2d, lon2d)
    terrain = one_source(bounds, np.where(dist >= wall_dist, FLOOR + wall, FLOOR))
    horizon = render_horizon(terrain, LAT0, LON0, EYE, RenderConfig(max_range_m=21000.0),
                             azimuths_deg=[90.0])
    expected = float(geo.elevation_angle_deg(FLOOR + EYE, FLOOR + wall, wall_dist))
    assert -0.006 < expected < -0.004                       # about -0.005 deg, not 0
    assert horizon.elev_deg[0] == pytest.approx(expected, abs=1.5e-3)
    assert horizon.elev_deg[0] < 0.0
    assert wall_dist - 20.0 <= horizon.dist_m[0] <= wall_dist + 60.0
    assert horizon.src_height_m[0] == pytest.approx(FLOOR + wall, abs=0.5)
    flat_planet = math.degrees(math.atan((wall - EYE) / wall_dist))
    assert flat_planet == pytest.approx(0.164, abs=0.001) and horizon.elev_deg[0] < flat_planet - 0.16


# ---------------------------------------------------------------- a cone: angle, source point, direction

def cone_terrain(d_row, d_col, peak_m=300.0, base_radius_m=1000.0, half=300):
    """Flat ground with a cone whose apex is the centre of the pixel d_row rows south and
    d_col columns east of the camera's pixel. Returns (terrain, apex_lat, apex_lon)."""
    bounds, lat2d, lon2d = grid_around(LAT0, LON0, half, half, 20.0)
    apex_lat, apex_lon = lat2d[half + d_row, half + d_col], lon2d[half + d_row, half + d_col]
    from_apex = geo.distance_m(apex_lat, apex_lon, lat2d, lon2d)
    data = FLOOR + np.maximum(0.0, peak_m * (1.0 - from_apex / base_radius_m))
    return one_source(bounds, data), float(apex_lat), float(apex_lon)


def test_cone_peak_has_the_analytic_angle_and_is_its_own_source_point():
    terrain, apex_lat, apex_lon = cone_terrain(d_row=-130, d_col=220)
    apex_dist = float(geo.distance_m(LAT0, LON0, apex_lat, apex_lon))
    bearing = float(geo.bearing_deg(LAT0, LON0, apex_lat, apex_lon))
    assert 4800 < apex_dist < 5000 and 55 < bearing < 62
    expected = float(geo.elevation_angle_deg(FLOOR + EYE, FLOOR + 300.0, apex_dist))
    assert expected == pytest.approx(3.44, abs=0.01)

    exact = render_horizon(terrain, LAT0, LON0, EYE, replace(FINE, max_range_m=5600.0),
                           azimuths_deg=[bearing])
    assert exact.elev_deg[0] == pytest.approx(expected, abs=0.002)

    fast = render_horizon(terrain, LAT0, LON0, EYE, RenderConfig(max_range_m=5600.0), azimuths_deg=[bearing])
    assert fast.elev_deg[0] == pytest.approx(expected, abs=0.02)
    assert fast.dist_m[0] == pytest.approx(apex_dist, abs=15.0)
    assert float(geo.distance_m(apex_lat, apex_lon, fast.src_lat[0], fast.src_lon[0])) < 15.0
    assert fast.src_height_m[0] == pytest.approx(FLOOR + 300.0, abs=3.0)


@pytest.mark.parametrize("d_row, d_col, expected_az", [
    (-200, 0, 0.0),      # cone due north
    (0, 200, 90.0),      # due east
    (200, 0, 180.0),     # due south
    (0, -200, 270.0),    # due west
])
def test_a_peak_shows_up_at_its_compass_azimuth(d_row, d_col, expected_az):
    terrain, _, _ = cone_terrain(d_row, d_col)
    horizon = render_horizon(terrain, LAT0, LON0, EYE,
                             RenderConfig(az_step_deg=1.0, max_range_m=5000.0, step_growth=0.016))
    assert horizon.az_deg[np.argmax(horizon.elev_deg)] == expected_az
    opposite = int((expected_az + 180.0) % 360.0)
    assert horizon.elev_deg[opposite] < 0.0 < horizon.elev_deg[int(expected_az)] - 3.0


def test_asking_for_some_azimuths_gives_the_same_rays_as_the_full_circle():
    terrain, _, _ = cone_terrain(0, 200)
    config = RenderConfig(az_step_deg=1.0, max_range_m=5000.0)
    full = render_horizon(terrain, LAT0, LON0, EYE, config)
    part = render_horizon(terrain, LAT0, LON0, EYE, config, azimuths_deg=[80.0, 90.0, 271.0])
    assert np.array_equal(part.elev_deg, full.elev_deg[[80, 90, 271]])
    assert np.array_equal(part.dist_m, full.dist_m[[80, 90, 271]])
    assert part.near_fraction(1000.0) == 0.0 and full.elev_deg.shape == (360,)


# ---------------------------------------------------------------- occlusion

def ridge_and_mountain(mountain_m):
    """Rings around the camera: a 30 m ridge 500 m away and a mountain 10 km away."""
    bounds, lat2d, lon2d = grid_around(LAT0, LON0, 40, 620, 20.0)
    dist = geo.distance_m(LAT0, LON0, lat2d, lon2d)
    ridge = 30.0 * np.maximum(0.0, 1.0 - np.abs(dist - 500.0) / 200.0)
    mountain = mountain_m * np.maximum(0.0, 1.0 - np.abs(dist - 10000.0) / 1500.0)
    return one_source(bounds, FLOOR + ridge + mountain)


def test_a_near_ridge_hides_a_far_mountain_that_stands_lower_in_the_view():
    horizon = render_horizon(ridge_and_mountain(400.0), LAT0, LON0, EYE,
                             RenderConfig(max_range_m=11500.0), azimuths_deg=[90.0])
    ridge_angle = float(geo.elevation_angle_deg(FLOOR + EYE, FLOOR + 30.0, 500.0))     # 3.24 deg
    mountain_angle = float(geo.elevation_angle_deg(FLOOR + EYE, FLOOR + 400.0, 10000.0))  # 2.20 deg
    assert mountain_angle < ridge_angle
    # The crest falls between pixels, so the gridded ridge is up to 1.4 m lower than 30 m
    assert horizon.dist_m[0] == pytest.approx(500.0, abs=25.0)
    assert ridge_angle - 0.2 < horizon.elev_deg[0] <= ridge_angle
    assert horizon.elev_deg[0] > mountain_angle + 0.5
    assert horizon.reach_m[0] > 11000.0          # the ray went on past the mountain


def test_a_far_mountain_that_stands_higher_in_the_view_is_the_horizon():
    horizon = render_horizon(ridge_and_mountain(800.0), LAT0, LON0, EYE,
                             RenderConfig(max_range_m=11500.0), azimuths_deg=[90.0])
    mountain_angle = float(geo.elevation_angle_deg(FLOOR + EYE, FLOOR + 800.0, 10000.0))  # 4.48 deg
    assert horizon.dist_m[0] == pytest.approx(10000.0, abs=40.0)
    assert horizon.elev_deg[0] == pytest.approx(mountain_angle, abs=0.02)


# ---------------------------------------------------------------- the edge of the data

def test_rays_stop_where_the_data_ends():
    bounds, lat2d, _ = grid_around(LAT0, LON0, 50, 50, 20.0)
    terrain = one_source(bounds, np.full(lat2d.shape, FLOOR, dtype=np.float32))
    east_edge = bounds[1][1] - 0.25 * cell_deg(20.0)     # 5 m inside the eastern edge
    horizon = render_horizon(terrain, LAT0, east_edge, EYE, RenderConfig(max_range_m=3000.0),
                             azimuths_deg=[90.0, 270.0])
    assert math.isnan(horizon.elev_deg[0]) and math.isnan(horizon.dist_m[0]) and horizon.reach_m[0] == 0.0
    assert math.isnan(horizon.src_lat[0])
    assert math.isfinite(horizon.elev_deg[1]) and 1800.0 < horizon.reach_m[1] < 2000.0
    assert horizon.near_fraction(5000.0) == 1.0


def test_no_terrain_under_the_camera_is_an_error():
    with pytest.raises(ValueError, match="No terrain data under the camera"):
        render_horizon(flat_terrain(half=20), 0.0, 0.0)


# ---------------------------------------------------------------- the real DEM

def brute_force(terrain, lat, lon, azimuths, eye=EYE, step_m=4.0, max_range_m=40000.0,
                near_step_m=None, near_to_m=6000.0):
    """Horizon by the simplest possible means: every 4 m along every ray, full detail.
    near_step_m: a finer step for the first near_to_m, for terrain with 1 m data."""
    cam = terrain.height(lat, lon) + eye
    if near_step_m is None:
        dist = np.arange(step_m, max_range_m + step_m, step_m)
    else:
        dist = np.concatenate([np.arange(near_step_m, near_to_m, near_step_m),
                               np.arange(near_to_m, max_range_m + step_m, step_m)])
    out = np.empty(len(azimuths))
    for i, az in enumerate(azimuths):
        la, lo = geo.destination(lat, lon, az, dist)
        out[i] = np.nanmax(geo.elevation_angle_deg(cam, terrain.height(la, lo), dist))
    return out


@pytest.mark.realdem
def test_fast_renderer_agrees_with_brute_force_on_the_real_dem(ctx_terrain):
    real_terrain = ctx_terrain
    rng = np.random.default_rng(11)
    # Positions where the stored candidates are: the soc_008 part of the CTX source. Since 15 Nov
    # the source reaches 80 km, and positions spread over all of it can sit on steep outer flanks
    # where ground a few tens of metres away makes the horizon (18.576 N 77.059 E, a 13 deg slope:
    # 0.09 deg between the two renderers there).
    (lat_min, lon_min), (lat_max, lon_max) = SOC_008_BOUNDS
    positions = [(LAT0, LON0)] + [(rng.uniform(lat_min + 0.03, lat_max - 0.03),
                                   rng.uniform(lon_min + 0.03, lon_max - 0.03)) for _ in range(7)]
    azimuths = np.arange(0.0, 360.0, 6.0) + 0.37
    errors = []
    for lat, lon in positions:
        fast = render_horizon(real_terrain, lat, lon, EYE, RenderConfig(), azimuths_deg=azimuths)
        errors.append(fast.elev_deg - brute_force(real_terrain, lat, lon, azimuths))
    errors = np.concatenate(errors)
    rms = float(np.sqrt(np.mean(errors ** 2)))
    print("\nfast vs brute force on the real DEM: rms %.4f deg, mean %+.4f, max %.4f (%d rays)"
          % (rms, errors.mean(), np.abs(errors).max(), errors.size))
    # Measured (15 Nov terrain): rms 0.002 deg, max 0.009 deg. Walking 100 m shifts the far
    # horizon by about 0.06 deg.
    assert rms < 0.006
    assert np.abs(errors).max() < 0.06


@pytest.mark.realdem
def test_fast_renderer_agrees_with_brute_force_on_every_source(real_terrain):
    # With 1 m data near the camera the reference has to step finer than 1 m there.
    azimuths = np.arange(0.0, 360.0, 15.0) + 0.37
    errors = []
    for lat, lon in ((LAT0, LON0), (18.47, 77.42)):
        fast = render_horizon(real_terrain, lat, lon, EYE, RenderConfig(), azimuths_deg=azimuths)
        errors.append(fast.elev_deg - brute_force(real_terrain, lat, lon, azimuths, near_step_m=0.5))
    errors = np.concatenate(errors)
    rms = float(np.sqrt(np.mean(errors ** 2)))
    print("\nfast vs 0.5 m brute force on the delivered terrain (%s): rms %.4f deg, max %.4f"
          % (", ".join(real_terrain.source_ids), rms, np.abs(errors).max()))
    assert rms < 0.01 and np.abs(errors).max() < 0.06


@pytest.mark.realdem
def test_landing_site_horizon_on_the_real_dem(ctx_terrain):
    real_terrain = ctx_terrain
    horizon = render_horizon(real_terrain, LAT0, LON0, EYE, RenderConfig(az_step_deg=1.0))
    assert np.isfinite(horizon.elev_deg).all()
    # The western rim stands a few degrees high; values from an independent pure-Python check
    west = horizon.elev_deg[225:286]
    assert 3.0 < west.max() < 5.5 and west.min() > 1.5
    assert horizon.dist_m[225:286].min() > 8000.0
    # Since 15 Nov the 20 m CTX reaches past the rim on every side (data/scripts/ctx_merge.py):
    # every ray gets at least 25 km of it (the source ends at 77.0 E), most the full 40 km
    assert horizon.reach_m.min() > 25000.0 and (horizon.reach_m >= 40000.0).mean() > 0.5
    # so distant terrain makes the horizon all round, the east included (1.5 deg, 30-40 km away)
    assert 0.5 < horizon.elev_deg[90:150].max() < 2.5 and horizon.dist_m[90:150].min() > 20000.0
    assert horizon.near_fraction(1000.0) < 0.05
