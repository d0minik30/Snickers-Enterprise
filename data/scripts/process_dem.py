"""Slope overlay and pathfinding grid for the Jezero box.

Input (download into data/raw/, which is not committed):
  jezero_ctx_dem_20m.tif - "MRO CTX, Jezero DEM, Controlled" from NASA Mars Trek

Outputs (data/output/):
  slope.png          slope classes as a see-through overlay, for L.imageOverlay
  slope_bounds.json  [[lat_min, lon_min], [lat_max, lon_max]] of slope.png
  cost_grid.json     slope in degrees on the same ~20 m grid, for pathfinding

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

# Jezero box: 10 x 10 km around the Perseverance landing site (18.4447 N, 77.4508 E)
LON_MIN, LON_MAX = 77.362, 77.540
LAT_MIN, LAT_MAX = 18.360, 18.529

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
    eps = 1e-6  # pixels; stops floating-point noise at an exact pixel edge from adding a pixel
    col0 = math.floor((to_metres(lon_min) - t.c) / t.a + eps)
    col1 = math.ceil((to_metres(lon_max) - t.c) / t.a - eps)
    row0 = math.floor((to_metres(lat_max) - t.f) / t.e + eps)
    row1 = math.ceil((to_metres(lat_min) - t.f) / t.e - eps)
    return col0, row0, col1, row1


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


def slope_colours(slope):
    """RGBA pixels: green < 10, yellow 10-25, red > 25 degrees; transparent where there is no data."""
    rgba = np.zeros(slope.shape + (4,), dtype=np.uint8)
    rgba[slope < 10] = GREEN
    rgba[(slope >= 10) & (slope <= 25)] = YELLOW
    rgba[slope > 25] = RED
    return rgba


def write_cost_grid(path, slope, bounds, cell_deg, dy, dx_centre):
    """JSON with the metadata first, then one line per grid row (north to south)."""
    meta = {
        "description": "Slope in degrees for pathfinding. slope_deg[row][col]: row 0 is the "
                       "northern edge, col 0 the western edge; null means no data. "
                       "cell_size_m.east_west is at the centre latitude (it changes by "
                       "less than 0.1 % across the box).",
        "source": "NASA Mars Trek: MRO CTX Jezero DEM (Controlled), 20 m",
        "bounds": bounds,
        "rows": int(slope.shape[0]),
        "cols": int(slope.shape[1]),
        "cell_size_deg": {"lat": cell_deg, "lon": cell_deg},
        "cell_size_m": {"north_south": dy, "east_west": dx_centre},
    }
    rows = [[None if math.isnan(v) else v for v in row] for row in slope.tolist()]
    with open(path, "w", encoding="utf-8", newline="\n") as out:
        out.write("{\n")
        for key, value in meta.items():
            out.write("  %s: %s,\n" % (json.dumps(key), json.dumps(value)))
        out.write('  "slope_deg": [\n')
        out.write(",\n".join("    " + json.dumps(row, separators=(",", ":")) for row in rows))
        out.write("\n  ]\n}\n")


def main():
    if not DEM_PATH.exists():
        raise SystemExit("Missing %s. Download \"MRO CTX, Jezero DEM, Controlled\" from "
                         "NASA Mars Trek and save it there." % DEM_PATH)
    OUT_DIR.mkdir(parents=True, exist_ok=True)

    with rasterio.open(DEM_PATH) as src:
        check_dem_grid(src)
        t = src.transform
        col0, row0, col1, row1 = box_window(t, LON_MIN, LAT_MIN, LON_MAX, LAT_MAX)
        # One extra pixel on every side, so the edge pixels get a full 3x3 neighbourhood
        if col0 < 1 or row0 < 1 or col1 > src.width - 1 or row1 > src.height - 1:
            raise SystemExit("The Jezero box (plus a 1-pixel margin) is not fully inside the DEM.")
        window = Window(col0 - 1, row0 - 1, col1 - col0 + 2, row1 - row0 + 2)
        z = src.read(1, window=window, masked=True).astype("float64").filled(np.nan)
    z[np.abs(z) > 1e30] = np.nan  # ISIS special pixel values that aren't flagged as nodata

    # Ground spacing: 20 m north-south; east-west, 20 map metres are 20 * cos(latitude) on the ground
    rows = row1 - row0
    row_lats = [to_degrees(t.f + (row0 + k + 0.5) * t.e) for k in range(rows)]
    dx = [abs(t.a) * math.cos(math.radians(lat)) for lat in row_lats]
    dy = abs(t.e)
    # Rounded once, so the PNG classes and the grid values always agree
    slope = np.round(horn_slope_deg(z, dx, dy), 1)

    lat_s, lat_n = to_degrees(t.f + row1 * t.e), to_degrees(t.f + row0 * t.e)
    lon_w, lon_e = to_degrees(t.c + col0 * t.a), to_degrees(t.c + col1 * t.a)
    bounds = [[round(lat_s, 7), round(lon_w, 7)], [round(lat_n, 7), round(lon_e, 7)]]
    centre_lat = (lat_s + lat_n) / 2

    png_path = OUT_DIR / "slope.png"
    bounds_path = OUT_DIR / "slope_bounds.json"
    grid_path = OUT_DIR / "cost_grid.json"
    Image.fromarray(slope_colours(slope)).save(png_path, optimize=True)
    with open(bounds_path, "w", encoding="utf-8", newline="\n") as out:
        out.write(json.dumps(bounds) + "\n")
    write_cost_grid(grid_path, slope, bounds,
                    cell_deg=round(to_degrees(abs(t.a)), 10), dy=dy,
                    dx_centre=round(abs(t.a) * math.cos(math.radians(centre_lat)), 3))

    valid = slope[~np.isnan(slope)]
    n = slope.size
    print("DEM window: cols %d-%d, rows %d-%d (%d x %d px)" % (col0, col1, row0, row1, col1 - col0, rows))
    print("bounds [[lat_min, lon_min], [lat_max, lon_max]]: %s" % bounds)
    print("slope: min %.1f, median %.1f, max %.1f deg; no data: %d px"
          % (valid.min(), np.median(valid), valid.max(), n - valid.size))
    print("classes: green (<10) %.1f %%, yellow (10-25) %.1f %%, red (>25) %.1f %%" % (
        100.0 * np.sum(slope < 10) / n,
        100.0 * np.sum((slope >= 10) & (slope <= 25)) / n,
        100.0 * np.sum(slope > 25) / n))
    for path in (png_path, bounds_path, grid_path):
        size = path.stat().st_size
        print("wrote %s (%.1f KB)" % (path.relative_to(DATA_DIR.parent).as_posix(), size / 1024))
        if size >= MAX_BYTES:
            raise SystemExit("%s is over the 5 MB limit" % path.name)


if __name__ == "__main__":
    main()
