"""Elevation, local relief and the biggest terrain features, on the cost grid.

Input (download into data/raw/, which is not committed):
  jezero_ctx_dem_20m.tif - "MRO CTX, Jezero DEM, Controlled" from NASA Mars Trek

Outputs (data/output/):
  elevation_grid.bin        4 layers of little-endian int16 in decimetres (-32768 = no data),
                            each rows x cols, row-major, row 0 = north:
                            elevation_m, min_m, max_m, relief_m
  elevation_grid.json       what is in the .bin: the grid (the same as cost_grid.json),
                            layer order, byte offsets, scale, datum, ranges
  terrain_features.geojson  the biggest highs (mounds, rims, the delta front) and lows
                            (craters, pits), as points with height_m or depth_m and size_m

Same area and 40 m cells as process_dem.py (its constants and functions are used).
Run from the repo root:  python data/scripts/process_elevation.py
"""
import heapq
import json
import math

import numpy as np
import rasterio
from scipy import ndimage

from process_dem import (DEM_PATH, GRID_BLOCK, LAT_MAX, LAT_MIN, LON_MAX, LON_MIN, MAX_BYTES,
                         OUT_DIR, block_reduce, box_window, check_dem_grid, read_with_margin,
                         to_degrees, window_bounds)

NODATA = -32768  # int16 value for "no data"
SCALE = 0.1      # metres per int16 step (decimetres)
LAYERS = ("elevation_m", "min_m", "max_m", "relief_m")

# Small scale (relief_m): cell minus the mean of the 7 x 7 cells around it (~280 m x 266 m)
RELIEF_CELLS = 7
# Large scale (terrain_features.geojson)
HIGH_WINDOW_CELLS = 25   # a high stands above the mean of 25 x 25 cells (~1 km) ...
HIGH_THRESHOLD_M = 8.0   # ... by more than this
HIGH_RING_CELLS = 10     # its height is measured above the ground in a ~400 m ring around it
HIGH_MIN_CELLS = 6
MIN_HEIGHT_M = 20.0      # highs below this are not exported
MIN_DEPTH_M = 5.0        # lows (closed depressions) shallower than this are not exported
MAX_FEATURES = 100       # per kind, deepest / highest first

VERTICAL_DATUM = (
    "Height 0 is the Mars areoid (MOLA topography): the USGS file name is "
    "JEZ_ctx_B_soc_008_DTM_MOLAtopography_DeltaGeoid_20m, and the landing site reads about "
    "-2,567 m, Jezero's known floor level. USGS's processing note says the intermediate CTX "
    "DTMs referred to the Mars 2000 sphere (R = 3396190 m); heights on that sphere would be "
    "about 1-2 km lower here.")
VERTICAL_ACCURACY = (
    "USGS: vertical registration between the CTX DTMs is 3.8 m after aligning the mosaic to the "
    "HRSC DTM (whose vertical precision is about 13 m); Mars 2020 TRN required < 20 m. "
    "Source: USGS metadata for doi:10.5066/P906QQT8.")


def to_decimetres(values):
    """Metres (NaN = no data) to int16 decimetres; NODATA for NaN. Refuses values that don't fit."""
    dm = np.round(np.asarray(values, dtype="float64") / SCALE)
    finite = np.isfinite(dm)
    if (np.abs(dm[finite]) > 32767).any():
        raise ValueError("a value is beyond +-3276.7 m and doesn't fit in int16 decimetres")
    return np.where(finite, dm, NODATA).astype(np.int16)


def box_sum(values, size):
    """Sum over each cell's size x size window (size odd); cells off the grid add nothing."""
    k = size // 2
    padded = np.pad(values, ((k + 1, k), (k + 1, k)))
    s = padded.cumsum(0).cumsum(1)
    return s[size:, size:] - s[:-size, size:] - s[size:, :-size] + s[:-size, :-size]


def surroundings_mean(z, size):
    """Mean of the cells around each cell in a size x size window, without the cell itself.

    Cells off the grid or without data are left out (near the border the window is smaller).
    """
    valid = ~np.isnan(z)
    zero_filled = np.where(valid, z, 0.0)
    total = box_sum(zero_filled, size) - zero_filled
    count = box_sum(valid.astype("float64"), size) - valid
    with np.errstate(invalid="ignore", divide="ignore"):
        return np.where(count > 0, total / count, np.nan)


def relief(z, size):
    """Height above (+) or depth below (-) the mean of the surrounding size x size cells."""
    return z - surroundings_mean(z, size)


def fill_depressions(z):
    """Fill every closed depression up to the level where it would spill (priority flood).

    Water leaves at the grid border and at cells without data, so depressions that drain
    there stay unfilled.
    """
    rows, cols = z.shape
    filled = z.copy()
    done = np.isnan(z)
    heap = []
    edge = np.zeros(z.shape, dtype=bool)
    edge[[0, -1], :] = True
    edge[:, [0, -1]] = True
    edge |= ndimage.binary_dilation(np.isnan(z), np.ones((3, 3)))  # next to no data
    for r, c in zip(*np.nonzero(edge & ~done)):
        done[r, c] = True
        heapq.heappush(heap, (z[r, c], r, c))
    while heap:
        level, r, c = heapq.heappop(heap)
        for dr in (-1, 0, 1):
            for dc in (-1, 0, 1):
                rr, cc = r + dr, c + dc
                if 0 <= rr < rows and 0 <= cc < cols and not done[rr, cc]:
                    done[rr, cc] = True
                    filled[rr, cc] = max(z[rr, cc], level)
                    heapq.heappush(heap, (filled[rr, cc], rr, cc))
    return filled


def find_lows(z, filled, cell_area_m2, min_depth):
    """Closed depressions (craters, pits): depth below the lowest point of their rim.

    Returns dicts with row/col of the lowest point, depth_m, size_m (diameter of a circle
    with the depression's area at its spill level) and elevation_m of the lowest point.
    """
    labels, _ = ndimage.label(filled - z > 1e-6, structure=np.ones((3, 3)))
    lows = []
    for i, box in enumerate(ndimage.find_objects(labels), 1):
        inside = labels[box] == i
        zz = np.where(inside, z[box], np.inf)
        r, c = np.unravel_index(np.argmin(zz), zz.shape)
        depth = filled[box][inside].max() - zz[r, c]
        if depth >= min_depth:
            lows.append({"row": int(r + box[0].start), "col": int(c + box[1].start),
                         "depth_m": float(depth), "elevation_m": float(zz[r, c]),
                         "size_m": float(2 * math.sqrt(inside.sum() * cell_area_m2 / math.pi))})
    return lows


def find_highs(z, window, threshold, ring, cell_m, min_cells):
    """Raised areas (mounds, buttes, rims, the delta front) and how high they stand.

    An area is a group of cells more than `threshold` above the mean of their window x
    window surroundings. Its height is its highest point minus the low ground around it
    (10th percentile of a `ring`-cell wide band). size_m is its longest extent.
    cell_m = (north-south, east-west) cell size in metres.
    """
    raised = z - ndimage.uniform_filter(z, window, mode="nearest") > threshold
    labels, _ = ndimage.label(raised, structure=np.ones((3, 3)))
    rows, cols = z.shape
    highs = []
    for i, box in enumerate(ndimage.find_objects(labels), 1):
        r0, r1 = max(box[0].start - ring, 0), min(box[0].stop + ring, rows)
        c0, c1 = max(box[1].start - ring, 0), min(box[1].stop + ring, cols)
        area = labels[r0:r1, c0:c1] == i
        if area.sum() < min_cells:
            continue
        around = ndimage.binary_dilation(area, np.ones((3, 3)), iterations=ring) & ~area
        zz = z[r0:r1, c0:c1]
        r, c = np.unravel_index(np.argmax(np.where(area, zz, -np.inf)), zz.shape)
        highs.append({"row": int(r + r0), "col": int(c + c0),
                      "height_m": float(zz[r, c] - np.percentile(zz[around], 10)),
                      "elevation_m": float(zz[r, c]),
                      "size_m": float(max((box[0].stop - box[0].start) * cell_m[0],
                                          (box[1].stop - box[1].start) * cell_m[1]))})
    return highs


def cell_lonlat(bounds, rows, cols, row, col):
    (lat_s, lon_w), (lat_n, lon_e) = bounds
    return (lon_w + (col + 0.5) * (lon_e - lon_w) / cols,
            lat_n - (row + 0.5) * (lat_n - lat_s) / rows)


def features_geojson(lows, highs, bounds, rows, cols):
    feats = []
    for kind, items, key in (("low", lows, "depth_m"), ("high", highs, "height_m")):
        for item in sorted(items, key=lambda x: -x[key])[:MAX_FEATURES]:
            lon, lat = cell_lonlat(bounds, rows, cols, item["row"], item["col"])
            feats.append({"type": "Feature",
                          "properties": {"kind": kind, key: round(item[key], 1),
                                         "size_m": round(item["size_m"]),
                                         "elevation_m": round(item["elevation_m"], 1)},
                          "geometry": {"type": "Point", "coordinates": [round(lon, 6), round(lat, 6)]}})
    return {
        "type": "FeatureCollection",
        "description": (
            "Biggest terrain features on the 40 m elevation grid. low: closed depressions "
            "(craters, pits); depth_m = lowest point of the rim minus the floor; point = the "
            "floor; size_m = diameter of a circle with the same area. high: areas more than "
            "%g m above the mean of the ~1 km around them; height_m = top minus the low ground "
            "(10th percentile) in a ~400 m ring around the area; point = the top; size_m = "
            "longest extent. Lows >= %g m deep and highs >= %g m high, at most %d of each."
            % (HIGH_THRESHOLD_M, MIN_DEPTH_M, MIN_HEIGHT_M, MAX_FEATURES)),
        "features": feats,
    }


def main():
    if not DEM_PATH.exists():
        raise SystemExit("Missing %s. See process_dem.py." % DEM_PATH)
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    with rasterio.open(DEM_PATH) as src:
        check_dem_grid(src)
        t = src.transform
        col0, row0, col1, row1 = box_window(t, LON_MIN, LAT_MIN, LON_MAX, LAT_MAX)
        if col0 < 0 or row0 < 0 or col1 > src.width or row1 > src.height:
            raise SystemExit("The processing area is not fully inside the DEM.")
        z20 = read_with_margin(src, col0, row0, col1, row1)[1:-1, 1:-1]

    # The same 40 m cells as cost_grid.json (process_dem.py): 2 x 2 DEM pixels each
    mean = block_reduce(z20, GRID_BLOCK, np.mean)
    lowest = block_reduce(z20, GRID_BLOCK, np.min)
    highest = block_reduce(z20, GRID_BLOCK, np.max)
    rows, cols = mean.shape
    bounds = window_bounds(t, col0, row0, col0 + cols * GRID_BLOCK, row0 + rows * GRID_BLOCK)
    cell_m = abs(t.a) * GRID_BLOCK
    centre = (bounds[0][0] + bounds[1][0]) / 2
    east_west = round(cell_m * math.cos(math.radians(centre)), 3)
    rel = relief(mean, RELIEF_CELLS)

    layers = dict(zip(LAYERS, (mean, lowest, highest, rel)))
    encoded = {name: to_decimetres(values) for name, values in layers.items()}
    bin_path = OUT_DIR / "elevation_grid.bin"
    with open(bin_path, "wb") as out:
        for name in LAYERS:
            out.write(encoded[name].astype("<i2").tobytes())

    descriptions = {
        "elevation_m": "mean height of the cell's 2 x 2 DEM pixels",
        "min_m": "lowest of the cell's 2 x 2 DEM pixels",
        "max_m": "highest of the cell's 2 x 2 DEM pixels",
        "relief_m": "elevation_m minus the mean elevation_m of the %d x %d cells around the cell "
                    "(~%d m x %d m, the cell itself left out; smaller near the border): + = stands "
                    "above its surroundings (mound, ridge, crater rim), - = lies below them (pit, "
                    "crater floor, channel)" % (RELIEF_CELLS, RELIEF_CELLS, RELIEF_CELLS * cell_m,
                                                round(RELIEF_CELLS * east_west)),
    }
    n = rows * cols
    meta = {
        "description": "Terrain heights on the cost grid. elevation_grid.bin holds the layers below "
                       "one after another, each rows x cols little-endian int16 in row-major order "
                       "(index = row * cols + col; row 0 = northern edge, col 0 = western edge). "
                       "Metres = value * scale; nodata means no data.",
        "source": "NASA Mars Trek: MRO CTX Jezero DEM (Controlled), 20 m",
        "vertical_datum": VERTICAL_DATUM,
        "vertical_accuracy": VERTICAL_ACCURACY,
        "bounds": bounds,
        "rows": rows,
        "cols": cols,
        "cell_size_deg": {"lat": round(to_degrees(cell_m), 10), "lon": round(to_degrees(cell_m), 10)},
        "cell_size_m": {"north_south": cell_m, "east_west": east_west},
        "data_file": bin_path.name,
        "dtype": "int16",
        "byte_order": "little-endian",
        "scale": SCALE,
        "units": "m",
        "nodata": NODATA,
        "layers": [{"name": name, "offset_bytes": i * n * 2,
                    "min": round(float(np.nanmin(layers[name])), 1),
                    "max": round(float(np.nanmax(layers[name])), 1),
                    "description": descriptions[name]} for i, name in enumerate(LAYERS)],
    }
    json_path = OUT_DIR / "elevation_grid.json"
    with open(json_path, "w", encoding="utf-8", newline="\n") as out:
        out.write(json.dumps(meta, indent=2) + "\n")

    filled = fill_depressions(mean)
    lows = find_lows(mean, filled, cell_m * east_west, MIN_DEPTH_M)
    highs = [h for h in find_highs(mean, HIGH_WINDOW_CELLS, HIGH_THRESHOLD_M, HIGH_RING_CELLS,
                                   (cell_m, east_west), HIGH_MIN_CELLS) if h["height_m"] >= MIN_HEIGHT_M]
    feat_path = OUT_DIR / "terrain_features.geojson"
    with open(feat_path, "w", encoding="utf-8", newline="\n") as out:
        out.write(json.dumps(features_geojson(lows, highs, bounds, rows, cols)) + "\n")

    grid_path = OUT_DIR / "cost_grid.json"
    if grid_path.exists():
        grid = json.loads(grid_path.read_text(encoding="utf-8"))
        for key in ("bounds", "rows", "cols", "cell_size_deg", "cell_size_m"):
            if grid[key] != meta[key]:
                raise SystemExit("elevation grid %s differs from cost_grid.json; rerun process_dem.py" % key)

    print("grid: %d x %d cells of %g m, bounds %s" % (cols, rows, cell_m, bounds))
    for layer in meta["layers"]:
        print("  %-12s %8.1f .. %7.1f m" % (layer["name"], layer["min"], layer["max"]))
    print("features: %d lows >= %g m deep, %d highs >= %g m high (at most %d of each exported)"
          % (len(lows), MIN_DEPTH_M, len(highs), MIN_HEIGHT_M, MAX_FEATURES))
    for path in (bin_path, json_path, feat_path):
        size = path.stat().st_size
        print("wrote %s (%.1f KB)" % (path.relative_to(OUT_DIR.parent.parent).as_posix(), size / 1024))
        if size >= MAX_BYTES:
            raise SystemExit("%s is over the 5 MB limit" % path.name)


if __name__ == "__main__":
    main()
