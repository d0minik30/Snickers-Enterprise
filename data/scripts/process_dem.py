"""Slope overlay and pathfinding grid for the area of the Jezero CTX DEM.

Input (download into data/raw/, which is not committed):
  jezero_ctx_dem_20m.tif - "MRO CTX, Jezero DEM, Controlled" from NASA Mars Trek

Processing area: the DEM's full extent, about 30 x 30 km (LON_MIN etc. below).

Outputs (data/output/):
  slope.png          slope classes at the DEM's 20 m, as a see-through overlay for L.imageOverlay
  slope_bounds.json  [[lat_min, lon_min], [lat_max, lon_max]] of slope.png
  cost_grid.json     slope in degrees on 40 m cells (the steepest of each 2 x 2 block of
                     20 m pixels), for pathfinding; add_sand_to_grid.py then adds the sand layer

Run from the repo root:  python data/scripts/process_dem.py
"""
import json
import math
from pathlib import Path

import numpy as np
import rasterio
from PIL import Image
from rasterio.crs import CRS
from rasterio.warp import transform as warp_transform
from rasterio.windows import Window

DATA_DIR = Path(__file__).resolve().parent.parent
DEM_PATH = DATA_DIR / "raw" / "jezero_ctx_dem_20m.tif"
OUT_DIR = DATA_DIR / "output"

# Mars 2000 sphere. The DEM is in equirectangular projection on this sphere
# (standard parallel 0, central meridian 0): x = R * lon and y = R * lat, in
# radians. So its pixels already form a lon/lat grid and need no resampling.
MARS_RADIUS_M = 3396190.0
MARS_LONLAT = CRS.from_proj4("+proj=longlat +R=3396190 +no_defs")

# Processing area: the full extent of the DEM (about 30 x 30 km). process_sand.py
# clips the sand to the same area.
LON_MIN, LON_MAX = 77.1604655, 77.6989752
LAT_MIN, LAT_MAX = 18.2110274, 18.7211945

# cost_grid.json cells are GRID_BLOCK x GRID_BLOCK DEM pixels (40 m); each keeps the steepest
GRID_BLOCK = 2

# Overlay colours (red, green, blue, alpha); alpha 128 is about 50 % opaque
GREEN = (0, 190, 0, 128)     # slope below 10 degrees
YELLOW = (255, 210, 0, 128)  # 10 to 25 degrees, both included
RED = (230, 0, 0, 128)       # above 25 degrees

MAX_BYTES = 5 * 1024 * 1024  # every output must stay under 5 MB


def to_degrees(metres):
    """Map metres (x or y in the DEM's projection) to degrees of lon or lat."""
    return math.degrees(metres / MARS_RADIUS_M)


def to_metres(degrees):
    """Degrees of lon or lat to map metres in the DEM's projection."""
    return math.radians(degrees) * MARS_RADIUS_M


def check_dem_grid(src):
    """Stop unless the DEM's x/y are plain lon/lat times R on the Mars 2000 sphere."""
    t = src.transform
    problem = None
    if t.b != 0 or t.d != 0:
        problem = "its grid is rotated"
    else:
        xs = [src.bounds.left, src.bounds.right, src.bounds.left, src.bounds.right]
        ys = [src.bounds.top, src.bounds.top, src.bounds.bottom, src.bounds.bottom]
        try:
            lons, lats = warp_transform(src.crs, MARS_LONLAT, xs, ys)
        except Exception as error:  # e.g. PROJ refuses to convert between planets
            problem = "its CRS can't be converted to Mars lon/lat (%s)" % error
        else:
            for x, y, lon, lat in zip(xs, ys, lons, lats):
                if abs(lon - to_degrees(x)) > 1e-9 or abs(lat - to_degrees(y)) > 1e-9:
                    problem = "its CRS is a different projection or sphere"
                    break
    if problem:
        raise SystemExit(
            "process_dem.py needs a DEM in equirectangular projection (standard parallel 0, "
            "central meridian 0) on the Mars 2000 sphere (R = 3396190 m), but %s. CRS: %s"
            % (problem, src.crs))


def box_window(t, lon_min, lat_min, lon_max, lat_max):
    """Whole-pixel window (col0, row0, col1, row1) that covers the box, snapped outward."""
    # A box edge this close (in pixels) to a pixel edge counts as on it. This absorbs float
    # noise and the rounding of the extent to 7 decimals of a degree (about 0.0003 pixel).
    eps = 0.01
    col0 = math.floor((to_metres(lon_min) - t.c) / t.a + eps)
    col1 = math.ceil((to_metres(lon_max) - t.c) / t.a - eps)
    row0 = math.floor((to_metres(lat_max) - t.f) / t.e + eps)
    row1 = math.ceil((to_metres(lat_min) - t.f) / t.e - eps)
    return col0, row0, col1, row1


def window_bounds(t, col0, row0, col1, row1):
    """[[lat_min, lon_min], [lat_max, lon_max]] of a pixel window, rounded to 7 decimals."""
    lat_s, lat_n = to_degrees(t.f + row1 * t.e), to_degrees(t.f + row0 * t.e)
    lon_w, lon_e = to_degrees(t.c + col0 * t.a), to_degrees(t.c + col1 * t.a)
    return [[round(lat_s, 7), round(lon_w, 7)], [round(lat_n, 7), round(lon_e, 7)]]


def read_with_margin(src, col0, row0, col1, row1):
    """Elevations (NaN = no data) of the window plus a 1-pixel margin on every side.

    The margin gives the window's edge pixels a full 3x3 neighbourhood. Where it falls
    off the DEM it is NaN, so the DEM's outermost pixels get no slope.
    """
    c0, r0 = max(col0 - 1, 0), max(row0 - 1, 0)
    c1, r1 = min(col1 + 1, src.width), min(row1 + 1, src.height)
    z = src.read(1, window=Window(c0, r0, c1 - c0, r1 - r0), masked=True)
    z = z.astype("float64").filled(np.nan)
    z[np.abs(z) > 1e30] = np.nan  # ISIS special pixel values that aren't flagged as nodata
    pad = ((r0 - (row0 - 1), (row1 + 1) - r1), (c0 - (col0 - 1), (col1 + 1) - c1))
    return np.pad(z, pad, constant_values=np.nan)


def horn_slope_deg(z, dx, dy):
    """Slope in degrees with Horn's 3x3 method (the one gdaldem slope uses).

    z: elevations in metres with a 1-pixel margin on every side; the result has
    2 fewer rows and columns. dx: east-west ground spacing in metres for each
    result row. dy: north-south ground spacing in metres. Pixels on or next to
    a gap (NaN) get NaN.
    """
    a, b, c = z[:-2, :-2], z[:-2, 1:-1], z[:-2, 2:]
    d, f = z[1:-1, :-2], z[1:-1, 2:]
    g, h, i = z[2:, :-2], z[2:, 1:-1], z[2:, 2:]
    dx = np.asarray(dx, dtype="float64")[:, np.newaxis]
    dz_dx = ((c + 2 * f + i) - (a + 2 * d + g)) / (8 * dx)
    dz_dy = ((g + 2 * h + i) - (a + 2 * b + c)) / (8 * dy)
    slope = np.degrees(np.arctan(np.hypot(dz_dx, dz_dy)))
    slope[np.isnan(z[1:-1, 1:-1])] = np.nan  # Horn skips the centre pixel; a gap there still means no slope
    return slope


def block_max(values, block):
    """Steepest value of each block x block group of cells (NaN if any of them is NaN).

    If the size isn't a whole number of blocks, the last blocks are filled up with NaN.
    """
    rows, cols = values.shape
    padded = np.pad(values, ((0, -rows % block), (0, -cols % block)), constant_values=np.nan)
    r, c = padded.shape
    return padded.reshape(r // block, block, c // block, block).max(axis=(1, 3))


def slope_colours(slope):
    """RGBA pixels: green < 10, yellow 10-25, red > 25 degrees; transparent where there is no data."""
    rgba = np.zeros(slope.shape + (4,), dtype=np.uint8)
    rgba[slope < 10] = GREEN
    rgba[(slope >= 10) & (slope <= 25)] = YELLOW
    rgba[slope > 25] = RED
    return rgba


def write_grid_json(path, meta, grids):
    """JSON with the metadata first, then each grid (rows north to south) one row per line.

    add_sand_to_grid.py writes cost_grid.json with this too, so the layout stays the same.
    """
    entries = ["  %s: %s" % (json.dumps(key), json.dumps(value)) for key, value in meta.items()]
    for name, rows in grids.items():
        lines = ",\n".join("    " + json.dumps(row, separators=(",", ":")) for row in rows)
        entries.append("  %s: [\n%s\n  ]" % (json.dumps(name), lines))
    with open(path, "w", encoding="utf-8", newline="\n") as out:
        out.write("{\n" + ",\n".join(entries) + "\n}\n")


def write_cost_grid(path, grid, bounds, cell_m):
    """cost_grid.json with the slope layer; add_sand_to_grid.py adds the sand layer."""
    lat_s, lat_n = bounds[0][0], bounds[1][0]
    centre = (lat_s + lat_n) / 2

    def east_west(lat):
        return cell_m * math.cos(math.radians(lat))

    meta = {
        "description": "Slope in degrees for pathfinding, on %g m cells: each cell holds the "
                       "steepest slope of its %d x %d DEM pixels, so steep spots aren't averaged "
                       "away. slope_deg[row][col]: row 0 is the northern edge, col 0 the western "
                       "edge; null means no data (e.g. the DEM's outermost pixels have no slope). "
                       "cell_size_m.east_west is at the centre latitude; it changes by %.1f %% "
                       "from the southern to the northern edge."
                       % (cell_m, GRID_BLOCK, GRID_BLOCK,
                          100 * (east_west(lat_s) - east_west(lat_n)) / east_west(centre)),
        "source": "NASA Mars Trek: MRO CTX Jezero DEM (Controlled), 20 m",
        "bounds": bounds,
        "rows": int(grid.shape[0]),
        "cols": int(grid.shape[1]),
        "cell_size_deg": {"lat": round(to_degrees(cell_m), 10), "lon": round(to_degrees(cell_m), 10)},
        "cell_size_m": {"north_south": cell_m, "east_west": round(east_west(centre), 3)},
    }
    rows = [[None if math.isnan(v) else v for v in row] for row in grid.tolist()]
    write_grid_json(path, meta, {"slope_deg": rows})


def main():
    if not DEM_PATH.exists():
        raise SystemExit("Missing %s. Download \"MRO CTX, Jezero DEM, Controlled\" from "
                         "NASA Mars Trek and save it there." % DEM_PATH)
    OUT_DIR.mkdir(parents=True, exist_ok=True)

    with rasterio.open(DEM_PATH) as src:
        check_dem_grid(src)
        t = src.transform
        col0, row0, col1, row1 = box_window(t, LON_MIN, LAT_MIN, LON_MAX, LAT_MAX)
        if col0 < 0 or row0 < 0 or col1 > src.width or row1 > src.height:
            raise SystemExit("The processing area is not fully inside the DEM.")
        z = read_with_margin(src, col0, row0, col1, row1)

    # Ground spacing: 20 m north-south; east-west, 20 map metres are 20 * cos(latitude) on the ground
    rows, cols = row1 - row0, col1 - col0
    row_lats = [to_degrees(t.f + (row0 + k + 0.5) * t.e) for k in range(rows)]
    dx = [abs(t.a) * math.cos(math.radians(lat)) for lat in row_lats]
    dy = abs(t.e)
    # Rounded once, so the PNG classes and the grid values always agree
    slope = np.round(horn_slope_deg(z, dx, dy), 1)
    grid = block_max(slope, GRID_BLOCK)

    bounds = window_bounds(t, col0, row0, col1, row1)
    grid_bounds = window_bounds(t, col0, row0, col0 + grid.shape[1] * GRID_BLOCK,
                                row0 + grid.shape[0] * GRID_BLOCK)

    png_path = OUT_DIR / "slope.png"
    bounds_path = OUT_DIR / "slope_bounds.json"
    grid_path = OUT_DIR / "cost_grid.json"
    Image.fromarray(slope_colours(slope)).save(png_path, optimize=True)
    with open(bounds_path, "w", encoding="utf-8", newline="\n") as out:
        out.write(json.dumps(bounds) + "\n")
    write_cost_grid(grid_path, grid, grid_bounds, abs(t.a) * GRID_BLOCK)

    valid = slope[~np.isnan(slope)]
    print("area: DEM cols %d-%d, rows %d-%d (%d x %d px of %g m)"
          % (col0, col1, row0, row1, cols, rows, abs(t.a)))
    print("bounds [[lat_min, lon_min], [lat_max, lon_max]]: %s" % bounds)
    print("slope: min %.1f, median %.1f, max %.1f deg; no data: %d px"
          % (valid.min(), np.median(valid), valid.max(), slope.size - valid.size))
    print("classes: green (<10) %.1f %%, yellow (10-25) %.1f %%, red (>25) %.1f %% of the pixels with data" % (
        100.0 * np.sum(valid < 10) / valid.size,
        100.0 * np.sum((valid >= 10) & (valid <= 25)) / valid.size,
        100.0 * np.sum(valid > 25) / valid.size))
    print("cost grid: %d x %d cells of %g m (steepest of each %d x %d block); no data: %d cells"
          % (grid.shape[1], grid.shape[0], abs(t.a) * GRID_BLOCK, GRID_BLOCK, GRID_BLOCK,
             int(np.isnan(grid).sum())))
    for path in (png_path, bounds_path, grid_path):
        size = path.stat().st_size
        print("wrote %s (%.1f KB)" % (path.relative_to(DATA_DIR.parent).as_posix(), size / 1024))
        if size >= MAX_BYTES:
            raise SystemExit("%s is over the 5 MB limit" % path.name)
    print("cost_grid.json has no sand layer now: run add_sand_to_grid.py and make_places.py "
          "next (after process_sand.py)")


if __name__ == "__main__":
    main()
