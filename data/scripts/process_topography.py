"""Topography for the map: contour lines, a hillshade and a coloured elevation overlay.

Input (download into data/raw/, which is not committed):
  jezero_ctx_dem_20m.tif - "MRO CTX, Jezero DEM, Controlled" from NASA Mars Trek

Outputs (data/output/), for the same area and 20 m pixels as slope.png / slope_bounds.json:
  contours.geojson       LineStrings with elevation_m, every 10 m, for L.geoJSON
  hillshade.png          grey shading, light from the north-west, see-through, for L.imageOverlay
  elevation.png          colour by height, about 50 % opaque, for L.imageOverlay
  elevation_legend.json  the colour stops of elevation.png in metres

Run from the repo root:  python data/scripts/process_topography.py
"""
import json
import math

import contourpy
import numpy as np
import rasterio
import shapely
from PIL import Image

from process_dem import (DEM_PATH, LAT_MAX, LAT_MIN, LON_MAX, LON_MIN, MAX_BYTES, OUT_DIR,
                         box_window, check_dem_grid, horn_gradients, read_with_margin,
                         to_degrees, window_bounds)

CONTOUR_INTERVAL_M = 10
CONTOUR_SIMPLIFY_PX = 0.25    # lines are simplified by up to 1/4 pixel (5 m) to stay under 5 MB
SUN_AZIMUTH_DEG = 315.0       # light from the north-west (clockwise from north)
SUN_ALTITUDE_DEG = 45.0
HILLSHADE_ALPHA = 128         # about 50 % opaque
ELEVATION_ALPHA = 128         # about 50 % opaque
# Colours of elevation.png, low to high; placed at these fractions of the pixels (quantiles),
# so the crater floor, the delta and the rim each get their own colours
RAMP_COLOURS = [(44, 62, 143), (42, 131, 184), (63, 181, 157), (166, 217, 106),
                (246, 226, 127), (244, 162, 89), (181, 101, 29)]
RAMP_QUANTILES = [0.0, 0.1, 0.25, 0.5, 0.75, 0.9, 1.0]
VERTICAL_DATUM = "Mars areoid (MOLA topography); see elevation_grid.json"


def hillshade(z, dx, dy, azimuth=SUN_AZIMUTH_DEG, altitude=SUN_ALTITUDE_DEG):
    """Light falling on the ground, 0 (dark) to 1 (lit), from Horn's gradients.

    Same inputs as process_dem.horn_gradients (z with a 1-pixel margin). NaN where there
    is no gradient (gaps, the DEM's outermost pixels).
    """
    rise_east, rise_south = horn_gradients(z, dx, dy)
    az, alt = math.radians(azimuth), math.radians(altitude)
    light = (math.sin(az) * math.cos(alt), math.cos(az) * math.cos(alt), math.sin(alt))  # east, north, up
    # Surface normal (-rise_east, -rise_north, 1), with rise_north = -rise_south
    dot = -rise_east * light[0] + rise_south * light[1] + light[2]
    return np.clip(dot / np.sqrt(rise_east ** 2 + rise_south ** 2 + 1), 0.0, 1.0)


def hillshade_rgba(shade):
    """Grey pixels (shade 0 = black, 1 = white), see-through; transparent where shade is NaN."""
    grey = np.round(np.nan_to_num(shade) * 255).astype(np.uint8)
    rgba = np.stack([grey, grey, grey, np.full(grey.shape, HILLSHADE_ALPHA, np.uint8)], axis=-1)
    rgba[np.isnan(shade)] = 0
    return rgba


def colour_stops(z):
    """[(height_m, (r, g, b)), ...] rising, from the lowest to the highest height (10 m steps)."""
    values = np.quantile(z[~np.isnan(z)], RAMP_QUANTILES)
    heights = [math.floor(values[0] / 10) * 10] + [round(v / 10) * 10 for v in values[1:-1]] \
        + [math.ceil(values[-1] / 10) * 10]
    stops = []
    for height, colour in zip(heights, RAMP_COLOURS):
        if not stops or height > stops[-1][0]:
            stops.append((float(height), colour))
    return stops


def elevation_rgba(z, stops):
    """Colour each height by blending between the stops; transparent where z is NaN."""
    heights = [h for h, _ in stops]
    channels = [np.round(np.interp(np.nan_to_num(z), heights, [c[k] for _, c in stops]))
                for k in range(3)]
    rgba = np.stack(channels + [np.full(z.shape, ELEVATION_ALPHA)], axis=-1).astype(np.uint8)
    rgba[np.isnan(z)] = 0
    return rgba


def contour_features(z, bounds, interval, tolerance_px):
    """GeoJSON LineString features with elevation_m, every `interval` metres.

    z is a grid of pixel centres covering bounds [[lat_min, lon_min], [lat_max, lon_max]]
    (row 0 = north). Lines are simplified by up to tolerance_px pixels.
    """
    rows, cols = z.shape
    (lat_s, lon_w), (lat_n, lon_e) = bounds
    dlon, dlat = (lon_e - lon_w) / cols, (lat_n - lat_s) / rows
    generator = contourpy.contour_generator(z=z, line_type="Separate")
    first = math.ceil(np.nanmin(z) / interval) * interval
    features = []
    for level in range(int(first), int(np.nanmax(z)) + 1, interval):
        for line in generator.lines(level):
            if tolerance_px:
                line = np.asarray(shapely.LineString(line).simplify(tolerance_px).coords)
            if len(line) < 2:
                continue
            coords = [[round(lon_w + (x + 0.5) * dlon, 6), round(lat_n - (y + 0.5) * dlat, 6)]
                      for x, y in line]
            features.append({"type": "Feature", "properties": {"elevation_m": level},
                             "geometry": {"type": "LineString", "coordinates": coords}})
    return features


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
        z_margin = read_with_margin(src, col0, row0, col1, row1)
    z = z_margin[1:-1, 1:-1]
    bounds = window_bounds(t, col0, row0, col1, row1)  # the same as slope_bounds.json
    rows = row1 - row0
    row_lats = [to_degrees(t.f + (row0 + k + 0.5) * t.e) for k in range(rows)]
    dx = [abs(t.a) * math.cos(math.radians(lat)) for lat in row_lats]

    shade_path = OUT_DIR / "hillshade.png"
    Image.fromarray(hillshade_rgba(hillshade(z_margin, dx, abs(t.e)))).save(shade_path, optimize=True)

    stops = colour_stops(z)
    elev_path = OUT_DIR / "elevation.png"
    Image.fromarray(elevation_rgba(z, stops)).save(elev_path, optimize=True)
    legend = {
        "description": "Colour stops of elevation.png (same bounds as slope_bounds.json). Colours "
                       "blend linearly between stops; heights below the first or above the last "
                       "stop get its colour. Stops sit at the 0, 10, 25, 50, 75, 90 and 100 % "
                       "quantiles of the heights, rounded to 10 m.",
        "units": "m",
        "vertical_datum": VERTICAL_DATUM,
        "opacity": round(ELEVATION_ALPHA / 255, 3),
        "stops": [{"elevation_m": h, "color": "#%02x%02x%02x" % c} for h, c in stops],
    }
    legend_path = OUT_DIR / "elevation_legend.json"
    with open(legend_path, "w", encoding="utf-8", newline="\n") as out:
        out.write(json.dumps(legend, indent=2) + "\n")

    features = contour_features(z, bounds, CONTOUR_INTERVAL_M, CONTOUR_SIMPLIFY_PX)
    contours = {"type": "FeatureCollection",
                "description": "Contour lines every %d m (elevation_m, height above the Mars areoid), "
                               "from the 20 m DEM, simplified by up to %g m."
                               % (CONTOUR_INTERVAL_M, CONTOUR_SIMPLIFY_PX * abs(t.a)),
                "features": features}
    contour_path = OUT_DIR / "contours.geojson"
    with open(contour_path, "w", encoding="utf-8", newline="\n") as out:
        out.write(json.dumps(contours, separators=(",", ":")) + "\n")

    print("area: %d x %d px of %g m, bounds %s" % (col1 - col0, rows, abs(t.a), bounds))
    print("contours: %d lines every %d m (%d levels)" % (
        len(features), CONTOUR_INTERVAL_M, len({f["properties"]["elevation_m"] for f in features})))
    print("colour stops: %s" % ", ".join("%g" % h for h, _ in stops))
    for path in (contour_path, shade_path, elev_path, legend_path):
        size = path.stat().st_size
        print("wrote %s (%.1f KB)" % (path.relative_to(OUT_DIR.parent.parent).as_posix(), size / 1024))
        if size >= MAX_BYTES:
            raise SystemExit("%s is over the 5 MB limit" % path.name)


if __name__ == "__main__":
    main()
