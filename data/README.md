# Data

Data files and scripts that prepare data go here.

Note: big map images and datasets are blocked by `.gitignore` on purpose —
the map loads them live from NASA. Only add small files you really need.

## `map_layers.json` – base map config

The frontend loads this file to set up the base map: the start view and the
NASA tile layers to draw. It holds no images; the tiles load live from NASA JPL
Mars Trek.

- `center`, `zoom`: the start view, the Perseverance landing site in Jezero Crater.
- `layers`: the tile layers in drawing order, **bottom to top**:

  | # | `name` | What it shows | `maxNativeZoom` |
  |---|---|---|---|
  | 1 (bottom) | Mars global base | Viking MDIM 2.1 colour mosaic, 232 m/pixel (Viking orbiters) | 7 |
  | 2 | CTX Jezero mosaic | CTX camera mosaic, 6 m/pixel (Mars Reconnaissance Orbiter) | 13 |
  | 3 (top) | HiRISE Jezero mosaic | HiRISE camera mosaic, 25 cm/pixel (Mars Reconnaissance Orbiter) | 17 |

- `attribution`: the credit text to show on the map.

Each layer has:

- `url`: a Leaflet tile URL (`{z}/{y}/{x}`). The double slash after `1.0.0` is
  how Mars Trek publishes it, so keep it.
- `maxNativeZoom`: the deepest zoom NASA has tiles for; past it, let Leaflet
  enlarge the last tiles. Measured on 2026-11-14 by requesting the landing-site
  tile at zooms 0–20.
- `bounds` (optional): the area the layer covers, copied from the layer's
  `WMTSCapabilities.xml`. The global base has none because it covers the
  whole planet.

**Coordinates** are always `[lat, lon]` in degrees, with east-positive longitude.
Bounds are `[[lat_min, lon_min], [lat_max, lon_max]]`. Leaflet takes both as they are.

**Note for the frontend:** the tiles are equirectangular (zoom 0 = 2 columns ×
1 row), so create the map with `L.CRS.EPSG4326`, and give it the Mars radius
(3389500 m) so distances come out right:
`L.extend({}, L.CRS.EPSG4326, { R: 3389500 })`. Do not set the `tms` option.

**Credit:** tiles by NASA/JPL-Caltech Mars Trek (https://trek.nasa.gov/mars/).
The global base is Viking orbiter data (MDIM 2.1); the Jezero mosaics are Mars
Reconnaissance Orbiter (MRO) data from its CTX and HiRISE cameras.

## Overlays and cost grid – `output/`

Two scripts make these from the downloads in `raw/` (not in git). Run them from
the repo root:

```bash
pip install -r data/scripts/requirements.txt
python data/scripts/process_dem.py    # slope.png, slope_bounds.json, cost_grid.json
python data/scripts/process_sand.py   # sand.geojson
```

They cover the Jezero box: lon 77.362–77.540, lat 18.360–18.529 (about 10 × 10 km
around the Perseverance landing site).

| File | What it is | How the frontend uses it |
|---|---|---|
| `slope.png` + `slope_bounds.json` | Slope overlay, about 50 % opaque: green < 10°, yellow 10–25°, red > 25° | `L.imageOverlay(png, bounds)` |
| `sand.geojson` | Sand: polygons of the eolian bedform unit (`Aeb`) | `L.geoJSON(data)` |
| `cost_grid.json` | Slope in degrees for each ~20 m cell | not drawn; for pathfinding later |

```js
const out = '../data/output/';  // relative to frontend/index.html
fetch(out + 'slope_bounds.json').then(r => r.json())
  .then(bounds => L.imageOverlay(out + 'slope.png', bounds).addTo(map));
fetch(out + 'sand.geojson').then(r => r.json())
  .then(sand => L.geoJSON(sand).addTo(map));
```

- `slope_bounds.json` is `[[lat_min, lon_min], [lat_max, lon_max]]`: the box snapped
  outward to whole DEM pixels, so up to 20 m larger on each side.
- `sand.geojson` uses GeoJSON's `[lon, lat]` order; `L.geoJSON` handles that.
- `cost_grid.json`: `slope_deg[row][col]` with row 0 at the northern edge, col 0 at
  the western edge and `null` for no data. `bounds`, `rows`, `cols` and
  `cell_size_deg` place each cell on the map; `cell_size_m` is its size on the
  ground (20 m north–south, about 18.97 m east–west). How slope becomes a cost is
  up to the pathfinder.
- All coordinates are degrees on the Mars 2000 sphere, east-positive longitude.
- To test locally, start the web server in the repo root, not in `frontend/`, or
  `../data/` can't be reached.
- `data/.gitignore` keeps `raw/` out of git but lets `output/*.png` and
  `output/*.geojson` in, which the root `.gitignore` would block.

**Sources:** slope from "MRO CTX, Jezero DEM, Controlled" (20 m), NASA Mars Trek
(`raw/jezero_ctx_dem_20m.tif`). Sand from Sun, V.Z., and Stack, K.M., 2020,
*Geologic map of Jezero crater and the Nili Planum region, Mars*, USGS Scientific
Investigations Map 3464, https://doi.org/10.3133/sim3464
(`raw/sim3464_database.zip`; the script reads layer `GeoUnits_v1` straight from the ZIP).
