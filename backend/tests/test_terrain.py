import json
import math
from pathlib import Path

import numpy as np
import pytest

from conftest import cell_deg, grid_around, one_source
from marsloc.constants import LANDING_SITE_LAT, LANDING_SITE_LON, MARS_RADIUS_M
from marsloc.terrain import Manifest, SourceSpec, Terrain, TerrainError, TileSpec, find_manifest
from marsloc.terrain.manifest import parse_manifest
from marsloc.terrain.seams import compare_sources

LAT0, LON0 = LANDING_SITE_LAT, LANDING_SITE_LON


def plane(lat, lon):
    """A tilted plane in metres: rises 0.05 m per metre north and 0.02 m per metre of longitude grid."""
    return (-2500.0 + 0.05 * np.radians(lat - LAT0) * MARS_RADIUS_M
            + 0.02 * np.radians(lon - LON0) * MARS_RADIUS_M)


def plane_terrain(half=40, cell_m=20.0):
    bounds, lat2d, lon2d = grid_around(LAT0, LON0, half, half, cell_m)
    return one_source(bounds, plane(lat2d, lon2d)), bounds, lat2d, lon2d


# ---------------------------------------------------------------- lookup on one grid

def test_bilinear_is_exact_on_a_plane():
    terrain, bounds, _, _ = plane_terrain()
    rng = np.random.default_rng(0)
    margin = cell_deg(20.0)
    lat = rng.uniform(bounds[0][0] + margin, bounds[1][0] - margin, 2000)
    lon = rng.uniform(bounds[0][1] + margin, bounds[1][1] - margin, 2000)
    assert np.abs(terrain.height(lat, lon) - plane(lat, lon)).max() < 2e-3  # float32 storage


def test_a_pixel_centre_returns_that_pixel():
    bounds, lat2d, lon2d = grid_around(LAT0, LON0, 5, 7, 20.0)
    data = np.random.default_rng(1).uniform(-2600, -2400, lat2d.shape).astype(np.float32)
    terrain = one_source(bounds, data)
    assert np.array_equal(terrain.height(lat2d, lon2d).astype(np.float32), data)


def test_row_0_is_north_and_col_0_is_west():
    bounds, lat2d, lon2d = grid_around(LAT0, LON0, 5, 5, 20.0)
    data = np.zeros(lat2d.shape, dtype=np.float32)
    data[0, 0] = 100.0
    terrain = one_source(bounds, data)
    step = cell_deg(20.0)
    north_west = terrain.height(bounds[1][0] - step / 2, bounds[0][1] + step / 2)
    south_east = terrain.height(bounds[0][0] + step / 2, bounds[1][1] - step / 2)
    assert north_west == pytest.approx(100.0) and south_east == pytest.approx(0.0)


def test_scalars_and_arrays_keep_their_shape():
    terrain, _, lat2d, lon2d = plane_terrain(half=5)
    assert isinstance(terrain.height(LAT0, LON0), float)
    assert terrain.height(lat2d, lon2d).shape == lat2d.shape
    assert terrain.height(lat2d[:, :1], lon2d[:1, :]).shape == lat2d.shape  # broadcasting


def test_no_data_outside_the_grid_and_data_right_up_to_its_edge():
    terrain, bounds, _, _ = plane_terrain(half=5)
    tiny = 1e-9
    inside_corner = terrain.height(bounds[1][0] - tiny, bounds[0][1] + tiny)
    assert math.isfinite(inside_corner)
    assert math.isnan(terrain.height(bounds[1][0] + 1e-6, LON0))
    assert math.isnan(terrain.height(LAT0, bounds[0][1] - 1e-6))
    assert math.isnan(terrain.height(0.0, 0.0))


def test_a_hole_has_no_data_but_its_neighbours_still_do():
    bounds, lat2d, lon2d = grid_around(LAT0, LON0, 5, 5, 20.0)
    data = np.full(lat2d.shape, 50.0, dtype=np.float32)
    data[5, 5] = np.nan                       # the pixel under (LAT0, LON0)
    terrain = one_source(bounds, data)
    step = cell_deg(20.0)
    assert math.isnan(terrain.height(LAT0, LON0))
    assert math.isnan(terrain.height(LAT0 + 0.4 * step, LON0 - 0.4 * step))
    # Just inside the next pixel: bilinear would use the hole, the lookup uses what exists.
    assert terrain.height(LAT0 + 0.6 * step, LON0) == pytest.approx(50.0)


# ---------------------------------------------------------------- several sources

def two_sources(fine_offset=0.0, hole=False, declared_offset=0.0, blend=0.0):
    """A coarse 100 m plane (about 6 km) with a fine 20 m patch (about 2 km) in the middle. The
    fine patch holds the same plane, shifted up by fine_offset. blend: the fine source's
    edge_blend_m (0 = a hard switch at its edge)."""
    c_bounds, c_lat, c_lon = grid_around(LAT0, LON0, 30, 30, 100.0)
    f_bounds, f_lat, f_lon = grid_around(LAT0, LON0, 50, 50, 20.0)
    fine = plane(f_lat, f_lon) + fine_offset
    if hole:
        fine[45:56, 45:56] = np.nan
    terrain = Terrain.from_arrays([
        dict(id="coarse", priority=10, bounds=c_bounds, data=plane(c_lat, c_lon)),
        dict(id="fine", priority=30, bounds=f_bounds, data=fine, vertical_offset_m=declared_offset),
    ], edge_blend_m=blend)
    return terrain, f_bounds, c_bounds


def test_the_highest_priority_source_wins_where_it_has_data():
    terrain, f_bounds, _ = two_sources(fine_offset=7.0)
    assert [s.id for s in terrain.sources] == ["fine", "coarse"]
    assert terrain.height(LAT0, LON0) == pytest.approx(plane(LAT0, LON0) + 7.0, abs=1e-3)
    outside = f_bounds[1][0] + cell_deg(300.0)
    assert terrain.height(outside, LON0) == pytest.approx(plane(outside, LON0), abs=1e-3)
    assert terrain.source_at(LAT0, LON0) == 0 and terrain.source_at(outside, LON0) == 1
    assert terrain.source_at(0.0, 0.0) == -1
    assert terrain.finest_cell_m(LAT0, LON0) == pytest.approx(20.0, rel=1e-6)
    assert terrain.finest_cell_m(outside, LON0) == pytest.approx(100.0, rel=1e-6)


def test_a_hole_in_the_fine_source_falls_through_to_the_coarse_one():
    terrain, _, _ = two_sources(fine_offset=7.0, hole=True)
    assert terrain.height(LAT0, LON0) == pytest.approx(plane(LAT0, LON0), abs=1e-3)
    beside = LAT0 + cell_deg(400.0)
    assert terrain.height(beside, LON0) == pytest.approx(plane(beside, LON0) + 7.0, abs=1e-3)


def test_vertical_offset_m_is_added_to_its_source():
    terrain, _, _ = two_sources(fine_offset=7.0, declared_offset=-7.0)
    assert terrain.height(LAT0, LON0) == pytest.approx(plane(LAT0, LON0), abs=1e-3)


# ---------------------------------------------------------------- blending at a source's edge

def test_a_source_is_blended_into_what_lies_beneath_along_its_edge():
    terrain, f_bounds, _ = two_sources(fine_offset=30.0, blend=400.0)
    assert terrain.blend_m == [400.0, 0.0]
    north_edge = f_bounds[1][0]
    inside = lambda metres: north_edge - cell_deg(metres)
    above = lambda lat: terrain.height(lat, LON0) - plane(lat, LON0)      # height above the coarse plane
    assert above(inside(0.01)) == pytest.approx(0.0, abs=0.05)             # at the edge: the lower source
    assert above(inside(200.0)) == pytest.approx(15.0, abs=0.05)           # half way: half of each
    assert above(inside(400.0)) == pytest.approx(30.0, abs=0.05)           # from the band inwards: its own
    assert above(inside(900.0)) == pytest.approx(30.0, abs=1e-3)
    assert above(north_edge + cell_deg(50.0)) == pytest.approx(0.0, abs=1e-3)   # outside: the lower source
    # no cliff anywhere on a walk across the edge, and the ramp only rises
    walk = np.array([above(inside(m)) for m in np.arange(-100.0, 600.0, 5.0)])
    assert np.abs(np.diff(walk)).max() < 1.0 and (np.diff(walk) > -1e-6).all()
    # the east edge blends the same way (distances measured on the ground, not in degrees)
    east = f_bounds[1][1] - cell_deg(200.0) / math.cos(math.radians(LAT0))
    assert terrain.height(LAT0, east) - plane(LAT0, east) == pytest.approx(15.0, abs=0.05)


def test_without_a_blend_band_the_switch_is_hard():
    terrain, f_bounds, _ = two_sources(fine_offset=30.0, blend=0.0)
    # 10 m inside is the centre of the fine source's outermost pixel
    just_in, just_out = f_bounds[1][0] - cell_deg(10.0), f_bounds[1][0] + cell_deg(1.0)
    step = (terrain.height(just_in, LON0) - plane(just_in, LON0)) - (terrain.height(just_out, LON0) - plane(just_out, LON0))
    assert step == pytest.approx(30.0, abs=0.05)


def test_blend_width_comes_from_the_manifest_an_override_or_the_default():
    c_bounds, c_lat, c_lon = grid_around(LAT0, LON0, 30, 30, 100.0)
    f_bounds, f_lat, f_lon = grid_around(LAT0, LON0, 50, 50, 20.0)
    sources = [dict(id="coarse", priority=10, bounds=c_bounds, data=plane(c_lat, c_lon)),
               dict(id="fine", priority=30, bounds=f_bounds, data=plane(f_lat, f_lon))]
    assert Terrain.from_arrays(sources).blend_m == pytest.approx([750.0, 0.0])      # 7.5 cells of 100 m
    with_manifest = [sources[0], dict(sources[1], edge_blend_m=250.0)]
    assert Terrain.from_arrays(with_manifest).blend_m == [250.0, 0.0]
    assert Terrain.from_arrays(with_manifest, edge_blend_m={"fine": 100.0}).blend_m == [100.0, 0.0]
    assert Terrain.from_arrays(with_manifest, edge_blend_m=0).blend_m == [0.0, 0.0]
    # the fingerprint changes with the blend, so stored horizons get rebuilt
    assert Terrain.from_arrays(sources).terrain_id() != Terrain.from_arrays(sources, edge_blend_m=0).terrain_id()
    again = parse_manifest(json.loads(json.dumps(Terrain.from_arrays(with_manifest).manifest.to_json())))
    assert again.sources[1].edge_blend_m == 250.0 and again.sources[0].edge_blend_m is None
    with pytest.raises(TerrainError, match="edge_blend_m"):
        parse_manifest({"sources": [{"id": "a", "priority": 1, "cell_size_m": 20, "edge_blend_m": -5,
                                     "tiles": [{"file": "a", "bounds": [[18.0, 77.0], [18.1, 77.1]],
                                                "rows": 10, "cols": 10}]}]})


def test_a_hole_in_a_blended_source_still_falls_through_and_the_outer_edge_stays():
    terrain, f_bounds, c_bounds = two_sources(fine_offset=30.0, hole=True, blend=300.0)
    assert terrain.height(LAT0, LON0) == pytest.approx(plane(LAT0, LON0), abs=1e-3)     # in the hole
    # The lowest source has nothing beneath it: its own heights right up to its edge.
    edge = c_bounds[1][0] - cell_deg(50.0)          # the centre of its outermost pixel
    assert terrain.height(edge, LON0) == pytest.approx(plane(edge, LON0), abs=1e-3)


def test_seam_check_finds_an_injected_5_m_step():
    terrain, _, _ = two_sources(fine_offset=5.0)
    (report,) = compare_sources(terrain)
    assert (report.upper, report.lower) == ("fine", "coarse")
    assert report.median_m == pytest.approx(5.0, abs=0.05)
    assert report.n_edge > 20 and report.edge_median_m == pytest.approx(5.0, abs=0.05)
    assert report.problem
    assert "STEP" in report.describe()


def test_seam_check_is_quiet_when_the_sources_agree_or_the_offset_is_declared():
    for terrain in (two_sources()[0], two_sources(fine_offset=5.0, declared_offset=-5.0)[0]):
        (report,) = compare_sources(terrain)
        assert abs(report.median_m) < 0.05 and not report.problem


def test_seam_check_reports_nothing_for_one_source():
    assert compare_sources(plane_terrain(half=5)[0]) == []


def test_seam_check_ignores_sources_that_never_meet():
    # coarse (bottom), middle and fine (top), each inside the one below. The fine source is
    # 9 m off the coarse one, but the middle one lies between them: no step to see there.
    c_bounds, c_lat, c_lon = grid_around(LAT0, LON0, 40, 40, 100.0)
    m_bounds, m_lat, m_lon = grid_around(LAT0, LON0, 100, 100, 20.0)
    f_bounds, f_lat, f_lon = grid_around(LAT0, LON0, 100, 100, 5.0)
    terrain = Terrain.from_arrays([
        dict(id="coarse", priority=10, bounds=c_bounds, data=plane(c_lat, c_lon)),
        dict(id="middle", priority=20, bounds=m_bounds, data=plane(m_lat, m_lon) + 9.0),
        dict(id="fine", priority=30, bounds=f_bounds, data=plane(f_lat, f_lon) + 9.0),
    ])
    by_pair = {(r.upper, r.lower): r for r in compare_sources(terrain)}
    assert not by_pair[("fine", "middle")].problem
    far_apart = by_pair[("fine", "coarse")]
    assert far_apart.median_m == pytest.approx(9.0, abs=0.1) and far_apart.n_edge == 0
    assert not far_apart.problem and "never meet" in far_apart.describe()
    assert by_pair[("middle", "coarse")].problem            # these two do meet, 9 m apart


# ---------------------------------------------------------------- coarser levels

def test_level_for_picks_the_coarsest_level_that_is_fine_enough():
    source = plane_terrain(half=5)[0].sources[0]
    assert [source.level_for(c) for c in (0, 10, 20, 39.9, 40, 79, 80, 1e9)] == [0, 0, 0, 0, 1, 1, 2, 6]


def test_coarser_levels_average_the_pixels():
    bounds, lat2d, lon2d = grid_around(LAT0, LON0, 32, 32, 20.0)     # 65 x 65 pixels
    data = np.random.default_rng(3).uniform(0, 100, lat2d.shape).astype(np.float32)
    source = one_source(bounds, data).sources[0]
    step = cell_deg(20.0)
    # The centre of the level-2 cell that holds rows 4-7, cols 8-11
    lat = bounds[1][0] - 6 * step
    lon = bounds[0][1] + 10 * step
    got = source.sample(np.array([lat]), np.array([lon]), 2)[0]
    assert got == pytest.approx(data[4:8, 8:12].mean(), abs=1e-4)
    # The last cell (cols 64-67) is cut off by the grid's edge: it averages the one column that
    # exists. The centre of pixel col 64 lies 0.625 of the way from cell 15's centre to cell 16's.
    lat_edge = bounds[1][0] - 2 * step
    lon_edge = bounds[1][1] - 0.5 * step
    got = source.sample(np.array([lat_edge]), np.array([lon_edge]), 2)[0]
    expected = 0.375 * data[0:4, 60:64].mean() + 0.625 * data[0:4, 64:65].mean()
    assert got == pytest.approx(expected, abs=1e-4)
    # A coarse cell must not invent terrain beyond the grid's real edge
    assert np.isnan(source.sample(np.array([lat_edge]), np.array([bounds[1][1] + 0.5 * step]), 2)[0])


def test_min_cell_m_reads_a_coarser_level_and_stays_exact_on_a_plane():
    terrain, bounds, _, _ = plane_terrain(half=64)
    rng = np.random.default_rng(4)
    margin = cell_deg(400.0)
    lat = rng.uniform(bounds[0][0] + margin, bounds[1][0] - margin, 500)
    lon = rng.uniform(bounds[0][1] + margin, bounds[1][1] - margin, 500)
    for min_cell in (40.0, 160.0):
        assert np.abs(terrain.height(lat, lon, min_cell_m=min_cell) - plane(lat, lon)).max() < 5e-3
    per_point = np.where(np.arange(500) % 2 == 0, 0.0, 160.0)
    assert np.abs(terrain.height(lat, lon, min_cell_m=per_point) - plane(lat, lon)).max() < 5e-3


# ---------------------------------------------------------------- tiles

def split_into_tiles(bounds, data, row_cut, col_cut, source_id="tiled"):
    """The grid cut into four tiles at (row_cut, col_cut), as a Terrain over in-memory arrays."""
    (lat_min, lon_min), (lat_max, lon_max) = bounds
    rows, cols = data.shape
    dlat, dlon = (lat_max - lat_min) / rows, (lon_max - lon_min) / cols
    tiles, arrays = [], {}
    for r0, r1 in ((0, row_cut), (row_cut, rows)):
        for c0, c1 in ((0, col_cut), (col_cut, cols)):
            name = "t_%d_%d" % (r0, c0)
            arrays[name] = data[r0:r1, c0:c1]
            tiles.append(TileSpec(file=name, lat_min=lat_max - r1 * dlat, lon_min=lon_min + c0 * dlon,
                                  lat_max=lat_max - r0 * dlat, lon_max=lon_min + c1 * dlon,
                                  rows=r1 - r0, cols=c1 - c0))
    spec = SourceSpec(id=source_id, priority=10, cell_size_m=20.0, tiles=tuple(tiles))
    return Terrain(Manifest(sources=(spec,)), arrays=arrays)


def test_tiles_give_the_same_heights_as_one_grid_at_every_level():
    bounds, lat2d, lon2d = grid_around(LAT0, LON0, 40, 45, 20.0)
    rng = np.random.default_rng(5)
    data = rng.uniform(-2600, -2400, lat2d.shape).astype(np.float32)
    data[10:13, 50:60] = np.nan
    whole = one_source(bounds, data)
    tiled = split_into_tiles(bounds, data, row_cut=37, col_cut=53)   # cuts not on any 2^k boundary
    lat = rng.uniform(bounds[0][0] - 0.001, bounds[1][0] + 0.001, 5000)
    lon = rng.uniform(bounds[0][1] - 0.001, bounds[1][1] + 0.001, 5000)
    for min_cell in (0.0, 40.0, 80.0, 320.0):
        a = whole.height(lat, lon, min_cell_m=min_cell)
        b = tiled.height(lat, lon, min_cell_m=min_cell)
        assert np.array_equal(np.isnan(a), np.isnan(b))
        assert np.nanmax(np.abs(a - b)) < 1e-3
    assert np.isnan(a).any() and np.isfinite(a).any()


def test_only_the_tiles_that_are_touched_get_loaded():
    bounds, lat2d, lon2d = grid_around(LAT0, LON0, 40, 40, 20.0)
    terrain = split_into_tiles(bounds, plane(lat2d, lon2d), row_cut=40, col_cut=40)
    assert terrain.tiles_loaded == 0
    step = cell_deg(20.0)
    terrain.height(bounds[1][0] - 5 * step, bounds[0][1] + 5 * step)      # deep inside the NW tile
    assert terrain.tiles_loaded == 1
    terrain.height(LAT0, LON0)                                            # where all four meet
    assert terrain.tiles_loaded == 4


def test_a_tile_off_the_grid_is_refused():
    step = cell_deg(20.0)
    a = TileSpec("a", LAT0, LON0, LAT0 + 10 * step, LON0 + 10 * step, 10, 10)
    b = TileSpec("b", LAT0, LON0 + 10.4 * step, LAT0 + 10 * step, LON0 + 20.4 * step, 10, 10)
    with pytest.raises(TerrainError, match="not on the source's grid"):
        Terrain(Manifest(sources=(SourceSpec("s", 10, 20.0, (a, b)),)), arrays={})


# ---------------------------------------------------------------- files and the manifest

def write_geotiff(path, data, lat_max, lon_min, cell_m=20.0, nodata=None, in_metres=True):
    """A north-up float32 GeoTIFF. in_metres: equirectangular map metres on the sphere (like
    the CTX DEM); otherwise degrees."""
    import rasterio
    from rasterio.transform import from_origin

    path.parent.mkdir(parents=True, exist_ok=True)
    if in_metres:
        transform = from_origin(math.radians(lon_min) * MARS_RADIUS_M,
                                math.radians(lat_max) * MARS_RADIUS_M, cell_m, cell_m)
    else:
        transform = from_origin(lon_min, lat_max, cell_deg(cell_m), cell_deg(cell_m))
    with rasterio.open(path, "w", driver="GTiff", height=data.shape[0], width=data.shape[1],
                       count=1, dtype="float32", transform=transform, nodata=nodata) as dst:
        dst.write(data.astype(np.float32), 1)


def terrain_folder(tmp_path, shift_header_m=0.0, in_metres=True):
    """A terrain folder with terrain.json and two 30 x 30 tiles side by side."""
    step = cell_deg(20.0)
    lat_max, lon_min = LAT0 + 15 * step, LON0 - 30 * step
    lats = lat_max - (np.arange(30) + 0.5) * step
    tiles = []
    for k in range(2):
        west = lon_min + k * 30 * step
        lons = west + (np.arange(30) + 0.5) * step
        lat2d, lon2d = np.meshgrid(lats, lons, indexing="ij")
        data = plane(lat2d, lon2d)
        if k == 1:
            data[0, 0] = -3.4028226550889045e38      # the CTX file's nodata value
        name = "ctx_20m/tile_%d.tif" % k
        write_geotiff(tmp_path / name, data, lat_max + cell_deg(shift_header_m), west,
                      nodata=-3.4028226550889045e38 if k == 1 else None, in_metres=in_metres)
        tiles.append({"file": name, "bounds": [[lat_max - 30 * step, west], [lat_max, west + 30 * step]],
                      "rows": 30, "cols": 30})
    manifest = {"contract_version": "0.1", "sphere_radius_m": 3396190, "vertical_datum": "mars_areoid_mola",
                "units": "m", "sources": [{"id": "ctx_20m", "priority": 20, "cell_size_m": 20,
                                           "tiles": tiles}]}
    (tmp_path / "terrain.json").write_text(json.dumps(manifest), encoding="utf-8")
    return tmp_path, lat_max, lon_min, step


@pytest.mark.parametrize("in_metres", [True, False])
def test_geotiff_tiles_load_lazily_and_read_correctly(tmp_path, in_metres):
    root, lat_max, lon_min, step = terrain_folder(tmp_path, in_metres=in_metres)
    terrain = Terrain.open(root)
    assert terrain.tiles_loaded == 0
    lat, lon = lat_max - 10.3 * step, lon_min + 7.7 * step              # in the west tile
    assert terrain.height(lat, lon) == pytest.approx(plane(lat, lon), abs=2e-3)
    assert terrain.tiles_loaded == 1
    lat, lon = lat_max - 10.3 * step, lon_min + 30.0 * step             # on the border of the tiles
    assert terrain.height(lat, lon) == pytest.approx(plane(lat, lon), abs=2e-3)
    assert terrain.tiles_loaded == 2
    assert math.isnan(terrain.height(lat_max - 0.5 * step, lon_min + 30.5 * step))  # the nodata pixel
    assert terrain.issues == []


def test_a_geotiff_header_that_disagrees_with_the_manifest_is_reported(tmp_path):
    root, lat_max, lon_min, step = terrain_folder(tmp_path, shift_header_m=200.0)
    terrain = Terrain.open(root)
    terrain.height(lat_max - 10 * step, lon_min + 10 * step)
    assert len(terrain.issues) == 1 and "10.0 pixels away" in terrain.issues[0]


def test_a_tile_with_the_wrong_size_is_refused(tmp_path):
    root, lat_max, lon_min, step = terrain_folder(tmp_path)
    manifest = json.loads((root / "terrain.json").read_text(encoding="utf-8"))
    tile = manifest["sources"][0]["tiles"][0]
    tile["rows"] = 15
    tile["bounds"][0][0] = lat_max - 15 * step
    (root / "terrain.json").write_text(json.dumps(manifest), encoding="utf-8")
    terrain = Terrain.open(root)
    with pytest.raises(TerrainError, match="30 x 30 pixels"):
        terrain.height(lat_max - 5 * step, lon_min + 5 * step)


def test_a_missing_folder_says_what_to_do(tmp_path):
    with pytest.raises(TerrainError, match="jezero_ctx_dem_20m.tif"):
        Terrain.open(tmp_path / "nothing_here")


@pytest.mark.parametrize("change, message", [
    ({"sphere_radius_m": 3389500}, "Mars 2000 sphere"),
    ({"units": "km"}, "units"),
    ({"sources": []}, "no sources"),
])
def test_a_manifest_that_breaks_the_contract_is_refused(change, message):
    good = {"sphere_radius_m": 3396190, "units": "m", "sources": [
        {"id": "a", "priority": 1, "cell_size_m": 20,
         "tiles": [{"file": "a.tif", "bounds": [[18.0, 77.0], [18.1, 77.1]], "rows": 10, "cols": 10}]}]}
    parse_manifest(good)
    with pytest.raises(TerrainError, match=message):
        parse_manifest({**good, **change})


def test_manifest_round_trips_through_json():
    terrain, _, _ = two_sources(fine_offset=1.0, declared_offset=-1.0)
    again = parse_manifest(json.loads(json.dumps(terrain.manifest.to_json())))
    assert again.sources == terrain.manifest.sources


# ---------------------------------------------------------------- the real DEM

@pytest.mark.realdem
def test_self_built_manifest_matches_the_contract_example(real_terrain, terrain_dir):
    if (terrain_dir / "terrain.json").exists():
        pytest.skip("the folder has its own terrain.json")
    manifest = find_manifest(terrain_dir).to_json()
    (source,) = manifest["sources"]
    (tile,) = source["tiles"]
    assert (source["id"], source["priority"], source["cell_size_m"]) == ("ctx_20m", 20, 20.0)
    assert tile["file"] == "ctx_20m/jezero_ctx_dem_20m.tif"
    assert (tile["rows"], tile["cols"]) == (1512, 1596)
    # The extent in data/README.md and CONTRACTS.md, to 7 decimals
    assert np.allclose(tile["bounds"], [[18.2110274, 77.1604655], [18.7211945, 77.6989752]], atol=6e-8)
    assert source["nodata"] < -1e38


@pytest.mark.realdem
def test_real_dem_heights_match_the_data_teams_numbers(ctx_terrain):
    real_terrain = ctx_terrain          # these numbers are the CTX DEM's
    assert real_terrain.issues == []
    # data/README.md: the landing site reads -2,567 m; places.geojson: -2567.2
    assert real_terrain.height(LAT0, LON0) == pytest.approx(-2567.2, abs=0.5)
    places = Path(__file__).resolve().parents[2] / "data" / "output" / "places.geojson"
    if places.exists():
        for feature in json.loads(places.read_text(encoding="utf-8"))["features"]:
            lon, lat = feature["geometry"]["coordinates"]
            # places.geojson holds the pixel under the place; bilinear differs a little on slopes
            assert real_terrain.height(lat, lon) == pytest.approx(
                feature["properties"]["elevation_m"], abs=4.0), feature["properties"]["name"]


@pytest.mark.realdem
def test_real_dem_has_no_gaps_and_the_known_height_range(ctx_terrain):
    real_terrain = ctx_terrain
    source = real_terrain.sources[0]
    lats = source.lat_top - (np.arange(1512) + 0.5) * source.dlat
    lons = source.lon_left + (np.arange(1596) + 0.5) * source.dlon
    heights = real_terrain.height(lats[:, None], lons[None, :])
    assert np.isfinite(heights).all()
    # data/output/elevation_grid.json: min_m -2710.7, max_m -1515.5
    assert heights.min() == pytest.approx(-2710.7, abs=0.06)
    assert heights.max() == pytest.approx(-1515.5, abs=0.06)
    assert compare_sources(real_terrain) == []


@pytest.mark.realdem
def test_real_terrain_sources_join_without_steps(real_terrain):
    """Whatever sources the data team delivered: tiles load cleanly, no source is more than
    2 m off the one it meets, and the height is continuous across every source edge."""
    for source in real_terrain.sources:
        for tile in source.tiles:
            tile.level(0)
    assert real_terrain.issues == []
    reports = compare_sources(real_terrain)
    assert [r.describe() for r in reports if r.problem] == []
    for number, source in enumerate(real_terrain.sources[:-1]):
        if real_terrain.blend_m[number] <= 0:
            continue
        # walk across the middle of the source's northern and western edges in 2 m steps
        metres = np.arange(-60.0, 60.0, 2.0)
        mid_lat, mid_lon = (source.lat_min + source.lat_top) / 2, (source.lon_left + source.lon_max) / 2
        north = real_terrain.height(source.lat_top + np.degrees(metres / MARS_RADIUS_M), mid_lon)
        west = real_terrain.height(mid_lat, source.lon_left + np.degrees(metres / MARS_RADIUS_M))
        for walk in (north, west):
            if np.isfinite(walk).all():
                # 2 m apart on real ground: a few metres at most, never a cliff of tens of metres
                assert np.abs(np.diff(walk)).max() < 6.0, source.id
