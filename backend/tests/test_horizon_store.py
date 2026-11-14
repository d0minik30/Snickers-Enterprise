import json
import math

import numpy as np
import pytest

from conftest import cell_deg, grid_around, one_source
from marsloc import geo
from marsloc.constants import LANDING_SITE_LAT, LANDING_SITE_LON, MARS_RADIUS_M
from marsloc.horizon import RenderConfig, render_horizon
from marsloc.horizon.store import (DIST_NODATA, ELEV_NODATA, STORE_CONFIG, CandidateGrid, HorizonStore,
                                   build_store, default_store_dir, dequantize_dist, dequantize_elev,
                                   quantize_dist, quantize_elev)
from marsloc.terrain import Terrain
from test_terrain import write_geotiff

LAT0, LON0 = LANDING_SITE_LAT, LANDING_SITE_LON
SMALL = RenderConfig(az_step_deg=5.0, max_range_m=2500.0)


def bumpy_terrain(half=150):
    """6.0 km north-south by 5.7 km east-west of made-up hills, only to give the store
    something that varies."""
    bounds, lat2d, lon2d = grid_around(LAT0, LON0, half, half, 20.0)
    east, north = geo.latlon_to_local(lat2d, lon2d)
    data = -2500.0 + 60.0 * np.sin(east / 700.0) * np.cos(north / 900.0) + 0.01 * east
    return one_source(bounds, data), bounds


# ---------------------------------------------------------------- the candidate grid

def test_candidate_grid_has_the_asked_spacing_and_stays_inside():
    bounds = [[18.2110274, 77.1604655], [18.7211945, 77.6989752]]    # the CTX DEM
    grid = CandidateGrid.cover(bounds, 200.0)
    assert (grid.rows, grid.cols) == (151, 151)
    size = grid.cell_size_m
    assert size["north_south"] == pytest.approx(200.0, abs=1e-6)
    assert size["east_west"] == pytest.approx(200.0, abs=0.01)
    (lat_min, lon_min), (lat_max, lon_max) = grid.bounds
    assert bounds[0][0] <= lat_min and lat_max <= bounds[1][0]
    assert bounds[0][1] <= lon_min and lon_max <= bounds[1][1]
    # centred: the same room is left over on both sides
    assert lat_min - bounds[0][0] == pytest.approx(bounds[1][0] - lat_max, abs=1e-9)
    assert grid.lats[0] > grid.lats[-1] and grid.lons[0] < grid.lons[-1]     # row 0 north, col 0 west


def test_candidate_grid_margin_and_numbering():
    bounds = [[18.2110274, 77.1604655], [18.7211945, 77.6989752]]
    grid = CandidateGrid.cover(bounds, 200.0, margin_m=2000.0)
    assert (grid.rows, grid.cols) == (131, 131)
    assert grid.bounds[0][0] - bounds[0][0] >= math.degrees(2000.0 / MARS_RADIUS_M) - 1e-9
    lat, lon = grid.latlon(grid.cols + 2)                      # row 1, col 2
    assert lat == pytest.approx(grid.lats[1]) and lon == pytest.approx(grid.lons[2])
    assert grid.nearest(lat + 0.3 * grid.dlat, lon - 0.3 * grid.dlon) == grid.cols + 2
    assert grid.nearest(0.0, 0.0) == -1
    index = np.arange(grid.n)
    assert np.array_equal(grid.nearest(*grid.latlon(index)), index)
    assert CandidateGrid.from_json(json.loads(json.dumps(grid.to_json()))) == grid
    with pytest.raises(ValueError):
        CandidateGrid.cover(bounds, 200.0, margin_m=20000.0)


# ---------------------------------------------------------------- quantization

def test_quantized_angles_are_within_half_a_step():
    elev = np.random.default_rng(0).uniform(-5.0, 40.0, 10000)
    back = dequantize_elev(quantize_elev(elev))
    assert np.abs(back - elev).max() <= 0.005 + 5e-6      # half a step, plus float32 rounding
    assert quantize_elev(np.array([np.nan]))[0] == ELEV_NODATA
    assert np.isnan(dequantize_elev(np.array([ELEV_NODATA], dtype=np.int16))[0])
    assert quantize_elev(np.array([-0.057]))[0] == -6            # negative angles survive


def test_quantized_distances_are_within_half_a_metre():
    dist = np.random.default_rng(1).uniform(10.0, 40000.0, 10000)
    assert np.abs(dequantize_dist(quantize_dist(dist)) - dist).max() <= 0.5 + 1e-3
    assert quantize_dist(np.array([np.nan]))[0] == DIST_NODATA
    assert np.isnan(dequantize_dist(np.array([DIST_NODATA], dtype=np.uint16))[0])
    assert quantize_dist(np.array([0.2]))[0] == 1               # never mistaken for "none"
    assert dequantize_dist(quantize_dist(np.array([90000.0]), 2.0), 2.0)[0] == 90000.0


# ---------------------------------------------------------------- build and read back

def test_stored_horizons_equal_live_renders(tmp_path):
    terrain, _ = bumpy_terrain()
    meta = build_store(terrain, tmp_path / "store", spacing_m=1000.0, config=SMALL)
    store = HorizonStore.load(tmp_path / "store")
    assert (store.grid.rows, store.grid.cols) == (6, 5)
    assert store.grid.n == meta["n_candidates"] == 30 and meta["n_valid"] == 30
    assert store.n_az == 72 and store.az_step_deg == 5.0 and store.az_deg[18] == 90.0
    assert store.config == SMALL and store.eye_height_m == 1.7
    assert store.matches(terrain)
    for index in range(store.grid.n):
        lat, lon = store.grid.latlon(index)
        live = render_horizon(terrain, lat, lon, 1.7, SMALL)
        assert np.abs(store.elev_deg(index) - live.elev_deg).max() <= 0.005 + 1e-5
        assert np.abs(store.dist_m(index) - live.dist_m).max() <= 0.5 + 1e-3
        assert store.ground[index] == pytest.approx(live.ground_m, abs=1e-3)
    assert store.elev_deg().shape == (30, 72)
    assert store.elev_deg([3, 7]).shape == (2, 72)
    assert meta["bytes"]["elev.npy"] < 30 * 72 * 2 + 200 and meta["build_seconds"] >= 0


def test_candidates_off_the_terrain_are_marked_invalid(tmp_path):
    terrain, bounds = bumpy_terrain()
    step = cell_deg(1000.0)
    wider = [[bounds[0][0], bounds[0][1]], [bounds[1][0], bounds[1][1] + 3 * step / math.cos(math.radians(LAT0))]]
    build_store(terrain, tmp_path / "store", spacing_m=1000.0, config=SMALL, bounds=wider)
    store = HorizonStore.load(tmp_path / "store")
    off = store.grid.lons > bounds[1][1]
    assert off.any() and not off.all()
    valid = store.valid.reshape(store.grid.rows, store.grid.cols)
    assert not valid[:, off].any() and valid[:, ~off].all()
    first_off = int(np.flatnonzero(off)[0])
    assert np.isnan(store.elev_deg(first_off)).all() and np.isnan(store.dist_m(first_off)).all()
    assert np.isnan(store.near_fraction(1000.0)[first_off])


def test_near_fraction_counts_bins_formed_by_close_terrain(tmp_path):
    terrain, _ = bumpy_terrain()
    build_store(terrain, tmp_path / "store", spacing_m=1000.0, config=SMALL)
    store = HorizonStore.load(tmp_path / "store")
    share = store.near_fraction(800.0)
    expected = (store.dist_m() < 800.0).mean(axis=1)
    assert np.allclose(share, expected)
    assert (store.near_fraction(1e9) == 1.0).all() and (store.near_fraction(1.0) == 0.0).all()


def test_a_store_knows_when_the_terrain_changed(tmp_path):
    terrain, bounds = bumpy_terrain()
    build_store(terrain, tmp_path / "store", spacing_m=1500.0, config=SMALL)
    store = HorizonStore.load(tmp_path / "store")
    _, lat2d, _ = grid_around(LAT0, LON0, 100, 100, 20.0)
    other = one_source([[18.0, 77.0], [18.1, 77.1]], np.zeros(lat2d.shape, dtype=np.float32))
    assert store.matches(terrain) and not store.matches(other)


def test_missing_and_outdated_stores_say_what_to_do(tmp_path):
    with pytest.raises(FileNotFoundError, match="build_horizons.py"):
        HorizonStore.load(tmp_path / "nothing")
    terrain, _ = bumpy_terrain(half=80)
    build_store(terrain, tmp_path / "store", spacing_m=1500.0, config=SMALL)
    meta_path = tmp_path / "store" / "meta.json"
    meta = json.loads(meta_path.read_text(encoding="utf-8"))
    meta["format_version"] = 0
    meta_path.write_text(json.dumps(meta), encoding="utf-8")
    with pytest.raises(ValueError, match="rebuild"):
        HorizonStore.load(tmp_path / "store")


@pytest.mark.slow
def test_parallel_build_gives_the_same_store(tmp_path):
    # workers > 1 reopen the terrain from its folder, so this one needs files
    bounds, lat2d, lon2d = grid_around(LAT0, LON0, 100, 100, 20.0)
    east, north = geo.latlon_to_local(lat2d, lon2d)
    data = -2500.0 + 40.0 * np.sin(east / 500.0) + 30.0 * np.cos(north / 400.0)
    folder = tmp_path / "terrain"
    write_geotiff(folder / "ctx_20m" / "jezero_ctx_dem_20m.tif", data, bounds[1][0], bounds[0][1])
    terrain = Terrain.open(folder)
    build_store(terrain, tmp_path / "one", spacing_m=800.0, config=SMALL, workers=1)
    build_store(terrain, tmp_path / "two", spacing_m=800.0, config=SMALL, workers=2)
    one, two = HorizonStore.load(tmp_path / "one", mmap=False), HorizonStore.load(tmp_path / "two", mmap=False)
    assert one.grid == two.grid and one.grid.n == 20
    assert np.array_equal(one.elev_q, two.elev_q) and np.array_equal(one.dist_q, two.dist_q)
    assert np.array_equal(one.ground, two.ground)
    with pytest.raises(ValueError, match="opened from a folder"):
        build_store(bumpy_terrain(half=60)[0], tmp_path / "three", spacing_m=800.0, config=SMALL, workers=2)


# ---------------------------------------------------------------- the real store

@pytest.mark.realdem
def test_real_store_matches_live_renders(real_terrain):
    directory = default_store_dir()
    if not (directory / "meta.json").exists():
        pytest.skip("no precomputed horizons; build them with scripts/build_horizons.py")
    store = HorizonStore.load(directory)
    if not store.matches(real_terrain):
        pytest.skip("the precomputed horizons were built from different terrain; rebuild them")
    assert store.config == STORE_CONFIG and store.valid.all()
    rng = np.random.default_rng(5)
    for index in rng.choice(store.grid.n, 6, replace=False):
        lat, lon = store.grid.latlon(index)
        live = render_horizon(real_terrain, lat, lon, store.eye_height_m, store.config)
        assert np.abs(store.elev_deg(index) - live.elev_deg).max() <= 0.005 + 1e-5
        assert np.abs(store.dist_m(index) - live.dist_m).max() <= 0.5 + 1e-3
    # The landing site's cell: the western rim stands a few degrees high
    index = store.grid.nearest(LAT0, LON0)
    assert index >= 0
    west = store.elev_deg(index)[int(240 / store.az_step_deg):int(280 / store.az_step_deg)]
    assert 3.0 < west.max() < 5.5
