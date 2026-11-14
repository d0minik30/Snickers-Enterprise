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
1 row), so create the map with `L.CRS.EPSG4326`, and give it the Mars 2000 sphere
radius (3396190 m, the same as the data scripts) so distances come out right:
`L.extend({}, L.CRS.EPSG4326, { R: 3396190 })`. Do not set the `tms` option.

**Credit:** tiles by NASA/JPL-Caltech Mars Trek (https://trek.nasa.gov/mars/).
The global base is Viking orbiter data (MDIM 2.1); the Jezero mosaics are Mars
Reconnaissance Orbiter (MRO) data from its CTX and HiRISE cameras.

## Overlays, cost grid, elevation and places – `output/`

Five scripts make these from the downloads in `raw/` (not in git). Run them from
the repo root, in this order:

```bash
pip install -r data/scripts/requirements.txt
python data/scripts/process_dem.py        # 1. slope.png, slope_bounds.json, cost_grid.json (slope)
python data/scripts/process_elevation.py  # 2. elevation_grid.json + .bin, terrain_features.geojson
python data/scripts/process_sand.py       # 3. sand.geojson
python data/scripts/add_sand_to_grid.py   # 4. adds the sand layer to cost_grid.json
python data/scripts/make_places.py        # 5. places.geojson, and checks each place on the grid
```

Steps 4 and 5 read what the earlier steps wrote. Step 1 rewrites `cost_grid.json`
without sand, so whenever you rerun step 1, run steps 4 and 5 again. Step 2 checks
that its grid is still the one in `cost_grid.json`.

They cover the full extent of the Jezero CTX DEM: lon 77.1604655–77.6989752,
lat 18.2110274–18.7211945 (about 30 × 30 km around the Perseverance landing site).

| File | What it is | How the frontend uses it |
|---|---|---|
| `slope.png` + `slope_bounds.json` | Slope overlay at the DEM's 20 m, about 50 % opaque: green < 10°, yellow 10–25°, red > 25° | `L.imageOverlay(png, bounds)` |
| `sand.geojson` | Sand: polygons of the eolian bedform unit (`Aeb`) | `L.geoJSON(data)` |
| `places.geojson` | The base (Perseverance landing site) and 4 mission sites, as points | `L.geoJSON(data)` |
| `cost_grid.json` | Slope and sand for each 40 m cell | not drawn; for pathfinding later |
| `elevation_grid.json` + `elevation_grid.bin` | Height, lowest/highest point and local relief of each 40 m cell (same grid as `cost_grid.json`) | profiles, climb/descent costs, "how high/deep" |
| `terrain_features.geojson` | The biggest highs (mounds, rims, the delta front) and lows (craters, pits), as points | `L.geoJSON(data)` |

The frontend's `predev`/`prebuild` script copies `data/map_layers.json` and
`data/output/*` into `frontend/public/data/`, so the app loads them from `/data/…`:

```js
fetch('/data/slope_bounds.json').then(r => r.json())
  .then(bounds => L.imageOverlay('/data/slope.png', bounds).addTo(map));
fetch('/data/sand.geojson').then(r => r.json())
  .then(sand => L.geoJSON(sand).addTo(map));
fetch('/data/places.geojson').then(r => r.json())
  .then(places => L.geoJSON(places, {
    pointToLayer: (feature, latlng) => L.circleMarker(latlng, { radius: 6 }),
    onEachFeature: (feature, layer) => layer.bindTooltip(feature.properties.name),
  }).addTo(map));
```

- `slope_bounds.json` is `[[lat_min, lon_min], [lat_max, lon_max]]` of the whole DEM.
  The DEM's outermost pixels have no slope (they lack neighbours), so they stay clear.
- `sand.geojson` and `places.geojson` use GeoJSON's `[lon, lat]` order; `L.geoJSON`
  handles that. Each place has `name`, `type` (`base` or `mission_site`), `source`
  and `elevation_m` (height of the 20 m DEM pixel under it, same datum as below).
  `L.circleMarker` needs no marker images, which bundlers often fail to find.
- `cost_grid.json` has two layers on the same 40 m grid, each `rows` × `cols`, with
  row 0 at the northern edge and col 0 at the western edge:
  - `slope_deg[row][col]`: the steepest slope (degrees) of the cell's 2 × 2 DEM
    pixels, so steep spots aren't averaged away; `null` for no data (the outer ring).
  - `sand[row][col]`: 1 if the cell centre is inside a `sand.geojson` polygon, else 0.

  `bounds`, `rows`, `cols` and `cell_size_deg` place each cell on the map: a point is
  in row `floor((lat_max − lat) / cell_size_deg.lat)` and column
  `floor((lon − lon_min) / cell_size_deg.lon)`. `cell_size_m` is the cell's size on
  the ground (40 m north–south, about 37.94 m east–west). How slope and sand become
  a cost is up to the pathfinder.
- All coordinates are degrees on the Mars 2000 sphere, east-positive longitude.
- `data/.gitignore` keeps `raw/` out of git but lets `output/*.png` and
  `output/*.geojson` in, which the root `.gitignore` would block.
  `data/.gitattributes` keeps the JSON/GeoJSON outputs in LF line endings and marks
  `.bin` files as binary.

### Elevation – `elevation_grid.json` + `elevation_grid.bin`

Exactly the `cost_grid.json` grid (same `bounds`, `rows`, `cols`, `cell_size_deg`,
`cell_size_m`), so one `(row, col)` addresses both. JSON text would be ~19 MB, so the
values are in a binary file: four layers one after another, each `rows` × `cols`
little-endian **int16**, row-major (index `row * cols + col`, row 0 = northern edge,
col 0 = western edge). Metres = value × `scale` (0.1, i.e. decimetres); `nodata`
(−32768) means no data.

| Layer | `offset_bytes` | Meaning (metres) |
|---|---|---|
| `elevation_m` | 0 | mean of the cell's 2 × 2 DEM pixels |
| `min_m` | `rows*cols*2` | lowest of the 4 pixels |
| `max_m` | `2*rows*cols*2` | highest of the 4 pixels |
| `relief_m` | `3*rows*cols*2` | height above (+) or depth below (−) its surroundings, see below |

`elevation_grid.json` also has `layers` (name, `offset_bytes`, `min`, `max`,
description, in file order), `dtype`, `byte_order`, `scale`, `units` (`m`), `nodata`,
`source`, `vertical_datum` and `vertical_accuracy`.

- **Height 0 = the Mars areoid** (MOLA topography), the usual "sea level" of Mars. The
  USGS product is `JEZ_ctx_B_soc_008_DTM_MOLAtopography_DeltaGeoid_20m`; Jezero's floor
  is about −2,500 to −2,600 m (the landing site reads −2,567 m).
- **Accuracy:** USGS gives 3.8 m vertical registration between the CTX DTMs, after
  aligning them to the HRSC DTM (whose own vertical precision is about 13 m)
  ([metadata](https://doi.org/10.5066/P906QQT8)). Heights within the area are consistent
  to a few metres; the absolute level may be off by more.
- This DEM has no gaps, so every cell has an elevation. The outer ring of cells has an
  elevation but no slope (`slope_deg` is `null` there).
- **`relief_m` (small scale):** the cell's `elevation_m` minus the mean of the 7 × 7
  cells around it (~280 m × 266 m, the cell itself left out; fewer cells at the
  border). Positive = mound, ridge, crater rim, the top of the delta front; negative =
  pit, crater floor, channel, the foot of a scarp. It shows bumps up to a few hundred
  metres across; for bigger features use `terrain_features.geojson`.

```js
const meta = await fetch('/data/elevation_grid.json').then(r => r.json());
const buf = await fetch('/data/' + meta.data_file).then(r => r.arrayBuffer());
const layer = name => new Int16Array(buf, meta.layers.find(l => l.name === name).offset_bytes,
                                     meta.rows * meta.cols);
const elevation = layer('elevation_m');
const metres = (row, col) => {
  const v = elevation[row * meta.cols + col];
  return v === meta.nodata ? null : v * meta.scale;
};
```

`Int16Array` reads the platform's byte order, which is little-endian in every
mainstream browser (x86 and ARM); use `DataView.getInt16(offset, true)` to be strict.

### Terrain features – `terrain_features.geojson`

Points (`[lon, lat]`) for the biggest features, found on the 40 m `elevation_m` at a
larger scale than `relief_m`:

- `kind: "low"`: closed depressions (craters, pits). `depth_m` = the lowest point of
  the rim (where it would spill) minus the floor; the point is the floor; `size_m` =
  diameter of a circle with the depression's area. Craters with a breached rim get
  the depth below the breach.
- `kind: "high"`: areas more than 8 m above the mean of the ~1 km (25 × 25 cells)
  around them, such as mounds, buttes, crater and Jezero rims and the delta front.
  `height_m` = the top minus the low ground (10th percentile) in a ~400 m ring around
  the area; the point is the top; `size_m` = the area's longest extent.
- Every feature also has `elevation_m` (at its point). Lows ≥ 5 m deep and highs
  ≥ 20 m high are kept, at most 100 of each, deepest/highest first. Example: the delta
  front is a `high` of about 96 m, and the ~700 m crater on the delta a `low` of
  about 38 m.

```js
fetch('/data/terrain_features.geojson').then(r => r.json())
  .then(fc => L.geoJSON(fc, {
    pointToLayer: (f, latlng) => L.circleMarker(latlng, { radius: 4 }),
    onEachFeature: (f, layer) => layer.bindTooltip(f.properties.kind === 'high'
      ? `${f.properties.height_m} m high` : `${f.properties.depth_m} m deep`),
  }).addTo(map));
```

**Sources:** slope from "MRO CTX, Jezero DEM, Controlled" (20 m), NASA Mars Trek
(`raw/jezero_ctx_dem_20m.tif`). Sand from Sun, V.Z., and Stack, K.M., 2020,
*Geologic map of Jezero crater and the Nili Planum region, Mars*, USGS Scientific
Investigations Map 3464, https://doi.org/10.3133/sim3464
(`raw/sim3464_database.zip`; the script reads layer `GeoUnits_v1` straight from the ZIP).
Places from the NASA Mars Trek "Jezero Crater Features and Landforms" bookmark.
