"""Add a sand layer to cost_grid.json, for route finding.

Run it last, after the scripts that make its inputs (all from the repo root):
  python data/scripts/process_dem.py       # cost_grid.json with slope_deg
  python data/scripts/process_sand.py      # sand.geojson
  python data/scripts/add_sand_to_grid.py  # this script

It adds "sand" to cost_grid.json: rows x cols of 0/1 on the same grid as slope_deg,
1 where the cell centre is inside a polygon of sand.geojson. Running it again
replaces the layer. process_dem.py rewrites cost_grid.json without it, so run this
script again after process_dem.py.
"""
import json
from pathlib import Path

import numpy as np
import shapely
import shapely.geometry

from process_dem import MAX_BYTES, write_grid_json

DATA_DIR = Path(__file__).resolve().parent.parent
GRID_PATH = DATA_DIR / "output" / "cost_grid.json"
SAND_PATH = DATA_DIR / "output" / "sand.geojson"
GRID_KEYS = ("slope_deg", "sand")
SAND_DESCRIPTION = ("sand[row][col] is 1 if the cell centre is inside a polygon of sand.geojson "
                    "(eolian bedforms, unit Aeb of USGS SIM 3464), else 0. Same rows and "
                    "columns as slope_deg.")


def sand_mask(bounds, rows, cols, polygons):
    """rows x cols array of 0/1: 1 where the cell centre is inside one of the polygons.

    bounds: [[lat_min, lon_min], [lat_max, lon_max]] of the whole grid; row 0 is the
    northern edge and col 0 the western edge. polygons: shapely polygons in lon/lat.
    """
    (lat_min, lon_min), (lat_max, lon_max) = bounds
    lons = lon_min + (np.arange(cols) + 0.5) * (lon_max - lon_min) / cols
    lats = lat_max - (np.arange(rows) + 0.5) * (lat_max - lat_min) / rows
    lon_grid, lat_grid = np.meshgrid(lons, lats)
    sand = shapely.union_all(polygons)
    shapely.prepare(sand)  # fast point-in-polygon tests for all cell centres
    return shapely.contains_xy(sand, lon_grid, lat_grid).astype(np.uint8)


def main():
    for path, maker in ((GRID_PATH, "process_dem.py"), (SAND_PATH, "process_sand.py")):
        if not path.exists():
            raise SystemExit("Missing %s. Run %s first." % (path, maker))
    grid = json.loads(GRID_PATH.read_text(encoding="utf-8"))
    features = json.loads(SAND_PATH.read_text(encoding="utf-8"))["features"]
    polygons = [shapely.geometry.shape(feature["geometry"]) for feature in features]
    sand = sand_mask(grid["bounds"], grid["rows"], grid["cols"], polygons)

    meta = {key: value for key, value in grid.items() if key not in GRID_KEYS}
    meta["sand_description"] = SAND_DESCRIPTION
    write_grid_json(GRID_PATH, meta, {"slope_deg": grid["slope_deg"], "sand": sand.tolist()})

    size = GRID_PATH.stat().st_size
    print("sand cells: %d of %d (%.1f %%)" % (sand.sum(), sand.size, 100.0 * sand.mean()))
    print("wrote %s (%.1f KB)" % (GRID_PATH.relative_to(DATA_DIR.parent).as_posix(), size / 1024))
    if size >= MAX_BYTES:
        raise SystemExit("%s is over the 5 MB limit" % GRID_PATH.name)


if __name__ == "__main__":
    main()
