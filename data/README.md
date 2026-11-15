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

Six scripts make these from the downloads in `raw/` (not in git). Run them from
the repo root, in this order:

```bash
pip install -r data/scripts/requirements.txt
python data/scripts/process_dem.py         # 1. slope.png, slope_bounds.json, cost_grid.json (slope)
python data/scripts/process_elevation.py   # 2. elevation_grid.json + .bin, terrain_features.geojson
python data/scripts/process_topography.py  # 3. contours.geojson, hillshade.png, elevation.png + legend
python data/scripts/process_sand.py        # 4. sand.geojson
python data/scripts/add_sand_to_grid.py    # 5. adds the sand layer to cost_grid.json
python data/scripts/make_places.py         # 6. places.geojson, and checks each place on the grid
```

Steps 5 and 6 read what the earlier steps wrote. Step 1 rewrites `cost_grid.json`
without sand, so whenever you rerun step 1, run steps 5 and 6 again. Step 2 checks
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
| `contours.geojson` | Contour lines every 10 m | `L.geoJSON(data)` |
| `hillshade.png` + `slope_bounds.json` | Grey shading, light from the north-west, about 50 % opaque | `L.imageOverlay(png, bounds)` |
| `elevation.png` + `slope_bounds.json` + `elevation_legend.json` | Colour by height, about 50 % opaque, and its colour stops | `L.imageOverlay(png, bounds)` + a legend |

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

### Contours and topography overlays

All made from the 20 m DEM by `process_topography.py`; heights above the Mars areoid.

- `contours.geojson`: `LineString` features with one property, `elevation_m` (a
  multiple of 10 m, from −2,710 to −1,520 m: 120 levels, ~2,850 lines, ~2.8 MB). Lines
  are simplified by up to 5 m (¼ pixel) to keep the file small; a 20 m interval would
  halve it. Coordinates are `[lon, lat]`.
- `hillshade.png` and `elevation.png` are 1596 × 1512 px, one pixel per DEM pixel,
  and cover exactly `slope_bounds.json`, like `slope.png`.
  - `hillshade.png`: grey (black = in shadow, white = facing the light), light from the
    north-west (azimuth 315°) at 45° above the horizon, alpha 128 (~50 %). The DEM's
    outermost pixels have no gradient and stay clear.
  - `elevation.png`: colours blend from dark blue (lowest) through green and yellow to
    brown (highest), alpha 128 (~50 %). The stops sit at the 0/10/25/50/75/90/100 %
    quantiles of the heights, so the crater floor, the delta and the rim each get
    their own colours.
- `elevation_legend.json`: `stops` (rising list of `{"elevation_m", "color": "#rrggbb"}`;
  colours blend linearly between stops), `units` (`m`), `opacity`, `vertical_datum`,
  `description`.

```js
const bounds = await fetch('/data/slope_bounds.json').then(r => r.json());
L.imageOverlay('/data/elevation.png', bounds).addTo(map);
L.imageOverlay('/data/hillshade.png', bounds).addTo(map);
fetch('/data/contours.geojson').then(r => r.json())
  .then(fc => L.geoJSON(fc, {
    style: f => ({ weight: f.properties.elevation_m % 50 === 0 ? 1.2 : 0.5, color: '#5a3a1a' }),
  }).addTo(map));
const legend = await fetch('/data/elevation_legend.json').then(r => r.json());
// legend.stops → e.g. a CSS linear-gradient from legend.stops[0].color to the last colour
```

**Sources:** slope from "MRO CTX, Jezero DEM, Controlled" (20 m), NASA Mars Trek
(`raw/jezero_ctx_dem_20m.tif`). Sand from Sun, V.Z., and Stack, K.M., 2020,
*Geologic map of Jezero crater and the Nili Planum region, Mars*, USGS Scientific
Investigations Map 3464, https://doi.org/10.3133/sim3464
(`raw/sim3464_database.zip`; the script reads layer `GeoUnits_v1` straight from the ZIP).
Places from the NASA Mars Trek "Jezero Crater Features and Landforms" bookmark.

## Localization terrain inputs

`scripts/fetch_terrain.py` installs only rasters whose source and SHA-256 are pinned
in `scripts/terrain_sources.json`; it writes `terrain.json` and the listed GeoTIFFs
to `backend/data_local/terrain/`, which is ignored by git. Run it from the repository
root after adding each authoritative source raster and its verified checksum:

```powershell
python data/scripts/fetch_terrain.py
python backend/scripts/check_terrain.py
```

Records may use a repository-relative `local_file`, or an official `url`, and must
include `id`, `priority`, nominal `cell_size_m`, contract-relative `file`, and the
64-character SHA-256. The script checks the digest before installing and derives
rows, columns, nodata, and Mars 2000 bounds from the GeoTIFF header. It does not
infer vertical offsets: set `vertical_offset_m` only from measured overlap residuals.
The `terrain_sources.json` currently pins the available CTX mosaic only:

| File | SHA-256 | Extent | Notes |
|---|---|---|---|
| `backend/data_local/terrain/ctx_20m/jezero_ctx_dem_20m.tif` | `46fb2e1e9f9c1fdd02939c2a96f3e173a8731bd146fbeb969b2060e0a3c8e97e` | 18.2110274–18.7211945 N, 77.1604655–77.6989752 E | 20 m, controlled MRO CTX, areoid/MOLA datum, 1,512 × 1,596 |

At this checkout, `backend/scripts/check_terrain.py` reports the CTX source loads
with no nodata and no manifest problems. It reports **no overlap comparison**, because
the HiRISE and outer-ring rasters are not present. Therefore the 80 × 80 km coverage,
HiRISE/CTX/MOLA seam measurements, and validated nonzero offsets remain outstanding;
the current CTX-only manifest cannot cover all 40 km rays.

## Named engine landmarks

`output/features.geojson` is a small GeoJSON FeatureCollection in `[lon, lat]` order.
It currently includes the IAU Gazetteer center of Belva and the NASA Perseverance
landing-site reference point. Belva's elevation is sampled from the installed CTX
tile; its 37.8 m crater depth comes from the local terrain-features extraction and
is recorded as depth, not positive summit prominence. The landing-site record is a
reference point and its prominence is not applicable. Source URLs and measurement
notes travel with each feature. Add further named features only with checked
coordinates and elevations in the same Mars 2000 / areoid convention.

## Ground-truth photo cases

`test_photos/manifest.json` lists real Perseverance Navcam photos with known rover positions:
24 cases, one per rover pose (site/drive), 40 photos, sols 17–1700, about 50 m to 11.4 km from
the landing site. Photos from one pose are matched together, so their relative headings are known.
The sources are NASA's [Mars 2020 raw-image archive](https://mars.nasa.gov/mars2020/multimedia/raw-images/)
and [M20 waypoint GeoJSON](https://mars.nasa.gov/mmgis-maps/M20/Layers/json/M20_waypoints.json).

Per photo the manifest keeps only:
- source links (raw-image page, metadata-feed URL, full-resolution image URL) and the image SHA-256;
- the camera calibration from its raw-image record: CAHVORE model, camera vector, image size,
  subframe and scale, and the rover attitude (the skyline step reads only "down" from it);
- the UTC time;
- a review: `skyline_visible`, `trusted_share`, `usable`, `notes`.

Each case has a review too (`skyline_visible`, `usable`, `notes`; add `manual_notes` by hand, a
rebuild keeps them). No skyline samples are stored.

**Truth is kept apart**, in the top-level `truth` map by case name: the rover's final localized
waypoint for the site/drive (`lat`, `lon`, `rover_heading_deg` from its yaw), and each photo's true
heading (`photo_headings_deg`: the yaw plus the camera's direction from the rover's forward direction,
from its label). The drive counter goes up whenever the rover moves, so every photo with the same
site/drive was taken from that waypoint. Truth is for scoring only and must never be copied into a
`/locate` request.

Two curated photos (sols 100 and 1100) point at the ground and are listed as not usable. Extra photos
at the early poses (formerly `work/m20_candidates.json`) are included only when they have a waypoint
and a visible, traceable skyline; the second eye of a stereo pair is left out.

Three steps, from the repository root with the backend's Python (numpy, Pillow):

```powershell
py -3.10 data/scripts/fetch_test_photos.py                 # download into test_photos/images/, check, write the manifest
py -3.10 backend/skyline/scripts/build_test_requests.py    # skyline requests -> backend/skyline/out/test_requests/
py -3.10 backend/skyline/scripts/validate.py --out backend/skyline/out/validation.json `
    --app-copy frontend/lib/locate/fixtures/validation.json  # run the engine and score
```

`fetch_test_photos.py` only downloads, verifies (SHA-256 against the manifest, image size against the
record, camera model and attitude present, a final waypoint for the pose) and writes the list.
`test_photos/images/` and `backend/skyline/out/` are git-ignored.

## Data status and provenance

All geospatial coordinates use east-positive longitude and the Mars 2000 sphere
(3,396,190 m); terrain heights use metres above the Mars areoid. The original six
processing scripts and outputs listed above remain the map-layer pipeline. The new
`fetch_terrain.py`, `terrain_sources.json`, `fetch_test_photos.py`,
`test_photos/manifest.json`, and `output/features.geojson` are committed data-side
assets. Terrain GeoTIFFs and full-resolution rover images remain in ignored/local or
shared storage; checksums and manifest metadata are committed.
