"""Shared test helpers.

Small made-up shapes (a plane, a cone, a wall) are used only to check the geometry against
formulas. Everything about how well the engine works is tested on the real DEM (marker
"realdem"), which is skipped when the file isn't there.
"""
import math

import numpy as np
import pytest

from marsloc.constants import LANDING_SITE_LAT, LANDING_SITE_LON, MARS_RADIUS_M
from marsloc.terrain import Manifest, Terrain, TerrainError, default_terrain_dir

# The USGS TRN CTX DTM (soc_008) inside the ctx_20m source: its numbers are known (data/README.md,
# data/output/elevation_grid.json) and the stored horizons' candidates lie in it. Since 15 Nov 2026
# ctx_20m also holds the JPL CTX mosaic around it, out to the 80 x 80 km box
# (data/scripts/ctx_merge.py).
SOC_008_BOUNDS = ((18.2110274, 77.1604655), (18.7211945, 77.6989752))
SOC_008_SHAPE = (1512, 1596)


def cell_deg(cell_m):
    """Degrees of latitude (and of the grid's longitude step) for a cell of cell_m metres."""
    return math.degrees(cell_m / MARS_RADIUS_M)


def grid_around(lat, lon, half_rows, half_cols, cell_m):
    """A grid regular in degrees with the point (lat, lon) exactly at a pixel centre.

    Returns (bounds, lat2d, lon2d): bounds as [[lat_min, lon_min], [lat_max, lon_max]] and the
    latitude and longitude of every pixel centre (row 0 = north). The grid has
    2 * half + 1 pixels each way and the point is the centre of the middle pixel.
    """
    step = cell_deg(cell_m)
    rows, cols = 2 * half_rows + 1, 2 * half_cols + 1
    lat_max = lat + (half_rows + 0.5) * step
    lon_min = lon - (half_cols + 0.5) * step
    bounds = [[lat_max - rows * step, lon_min], [lat_max, lon_min + cols * step]]
    lats = lat_max - (np.arange(rows) + 0.5) * step
    lons = lon_min + (np.arange(cols) + 0.5) * step
    lat2d, lon2d = np.meshgrid(lats, lons, indexing="ij")
    return bounds, lat2d, lon2d


def one_source(bounds, data, source_id="test", priority=10, **extra):
    return Terrain.from_arrays([dict(id=source_id, priority=priority, bounds=bounds, data=data, **extra)])


@pytest.fixture(scope="session")
def real_terrain():
    """The real terrain in backend/data_local/terrain/ (or $MARS_TERRAIN_DIR)."""
    try:
        terrain = Terrain.open()
        terrain.height(LANDING_SITE_LAT, LANDING_SITE_LON)  # loads the tile under the landing site
    except TerrainError as error:
        pytest.skip("real DEM not available: %s" % error)
    return terrain


@pytest.fixture(scope="session")
def ctx_terrain(real_terrain):
    """Only the 20 m CTX DEM of the real terrain: for checks against numbers known for it."""
    ctx = tuple(spec for spec in real_terrain.manifest.sources if spec.id == "ctx_20m")
    if not ctx:
        pytest.skip("the real terrain has no ctx_20m source")
    terrain = Terrain(Manifest(sources=ctx, root=real_terrain.manifest.root))
    terrain.height(LANDING_SITE_LAT, LANDING_SITE_LON)
    return terrain


@pytest.fixture(scope="session")
def terrain_dir():
    return default_terrain_dir()
