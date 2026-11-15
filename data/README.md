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

## Localization terrain – `backend/data_local/terrain/`

The engine's terrain (`backend/CONTRACTS.md`, section 1) is built from the official
sources with one command. Run from the repository root:

```bash
python data/scripts/fetch_terrain.py      # download -> crop -> offset -> check -> install (about 4 min, plus the 1.94 GB download the first time)
python backend/scripts/check_terrain.py   # the engine's own check of what was installed
python backend/scripts/build_horizons.py --bounds 18.2110274 77.1604655 18.7211945 77.6989752
```

The last line rebuilds the engine's stored horizons (`backend/cache/`) after a terrain
change, on the same candidate area as before (the soc_008 tile, 22,801 candidates).
Without `--bounds` the candidates follow the whole 20 m extent, about 6 times as many.

What `fetch_terrain.py` does, as set out in `scripts/terrain_sources.json`:

1. **Download** the official files into `raw/terrain/` (git-ignored, 1.94 GB), resuming
   a download that was cut off. The 11.4 GB global MOLA-HRSC blend is not downloaded: a
   1097 × 1039 px window (about ±100 km) is read over the network. Every input must
   match the SHA-256 of its **pixel data** pinned in `terrain_sources.json`, not of the
   file bytes. The Mars Trek and USGS files of soc_008 differ as files but give the
   same pin. `--update-pins` records new pins; use it only after a deliberate change of
   source.
2. **Crop** (`scripts/terrain_crops.py`, moved here from `backend/scripts/`).
   - HiRISE: the box around every test pose in `test_photos/manifest.json` plus 2 km,
     cut back to where the mosaic has data. The engine switches through holes
     without blending, so a source must have none.
   - MOLA-HRSC: the window as float32 metres.
   - Each file's projection is read (standard parallel, central meridian, sphere).
     Tiles are installed only on the contract grid: equirectangular with standard
     parallel 0 and central meridian 0, or degrees, on the 3,396,190 m sphere.
3. **CTX** (`scripts/ctx_merge.py`):
   - soc_008 is used where it exists. Around it, the JPL mosaic is resampled onto the
     soc_008 grid (its standard parallel is 18.4663°) and shifted to soc_008's level.
   - Its stereo blunders are cleaned: cells more than 15 m off their 7 × 7 median,
     steps over 60°, and areas thick with them. They are replaced by the blend,
     shifted to the surrounding level and faded in over 400 m.
   - soc_008 is feathered into the JPL mosaic over its outer 1 km. The result is cut to
     the 80 × 80 km box, without holes.
4. **Offset** (`scripts/terrain_offsets.py`): `vertical_offset_m` for HiRISE is measured
   over its whole crop against CTX. For MOLA-HRSC it is measured where it meets CTX,
   within 600 m of the CTX edge, which is where `check_terrain.py` looks.
5. **Check**: no holes; no step over 60° (80° for 1 m HiRISE); the landing site at
   −2567.2 ± 0.5 m; the places within 4 m of `places.geojson`; joins within 2 m; the
   crater rim at least 300 m above the floor in 8 directions; the delta front steeper
   than 20°. Any failure stops the build before anything is installed.
6. **Install** tiles of at most 2048 × 2048 (float32, NaN = no data, deflate) and
   `terrain.json` (contract 0.2). Each source also lists its products (name, DOI, URL,
   pixel pin) and each tile its `pixel_sha256`. A full report of the build goes to
   `terrain_build.json`. The old terrain is replaced only once everything is written.

| Source | Product (exact name) | DOI / link | Resolution | Coverage | Heights |
|---|---|---|---|---|---|
| `hirise_1m` | High-Resolution Imaging Science Experiment Digital Terrain Model Mosaic for Mars 2020 Terrain Relative Navigation (USGS, 2020) | [10.5066/P9REJ9JN](https://doi.org/10.5066/P9REJ9JN) | 1 m | product 18.3068–18.6693 N, 77.2229–77.5840 E (data on 66 % of it); installed 18.3949–18.5291 N, 77.2578–77.4882 E | areoid; median 0.4 m below the CTX mosaic (USGS) |
| `ctx_20m` | Context Camera Digital Terrain Model Mosaic for Mars 2020 Terrain Relative Navigation (USGS, 2020), "soc_008" | [10.5066/P906QQT8](https://doi.org/10.5066/P906QQT8) | 20 m | 18.2110–18.7212 N, 77.1605–77.6990 E | areoid (MOLA, delta geoid) |
| `ctx_20m` | Mars 2020 Science Investigation CTX DEM Mosaic (JPL, PDS4 `urn:nasa:pds:mars2020_ctx_basemap_2021:data:m20_ctxdem_mosaic`) | no DOI; [label](https://planetarymaps.usgs.gov/mosaic/mars2020_trn/CTX/ScienceInvestigationMaps_JPL/M20_JezeroCrater_CTXDEM_20m.xml) cites Mangold et al. 2021, doi:10.1126/science.abl4051 | 20 m | 17.5805–19.2902 N, 76.9974–78.5826 E | not stated; measured +0.01 m from soc_008 |
| `mola_200m` | Mars MGS MOLA - MEX HRSC Blended DEM Global 200m v2 (Fergason, Hare & Laura, 2018) | no DOI; [USGS page](https://astrogeology.usgs.gov/search/map/mars_mgs_mola_mex_hrsc_blended_dem_global_200m) | 200 m | global; window 16.70–20.20 N, 75.60–79.30 E | areoid (MOLA) |

Download addresses: `https://planetarymaps.usgs.gov/mosaic/...` (redirects to the USGS
S3 bucket); every URL, size and pin is in `terrain_sources.json`.

**Installed on 15 Nov 2026**:

| Source | Grid | Tiles | On disk | `vertical_offset_m` | `edge_blend_m` |
|---|---|---|---|---|---|
| `hirise_1m` | 13,654 × 7,958 px of 1 m | 28 | 150.6 MB | +0.83 | 150 |
| `ctx_20m` | 3,452 × 4,001 px of 20 m | 4 | 27.7 MB | 0 (reference) | 1,500 |
| `mola_200m` | 1,097 × 1,039 px of 200 m | 1 | 1.1 MB | −14.91 | – |

- **Coverage of the 80 × 80 km box around the landing site:** 20 m data covers 81.9 %
  of it: soc_008 14.3 %, the JPL mosaic 63.2 %, JPL replaced from the blend 4.4 %.
  MOLA-HRSC covers the remaining 18.1 %, the strip west of 77.0° E where the JPL mosaic
  ends.
- **Joins after the offsets** (median, then per edge N / S / E / W):
  - HiRISE / CTX: +0.43 m; −0.2 / −0.4 / +0.7 / +6.4 m.
  - CTX / blend: 0.0 m; −9.2 / −11.1 / +2.5 / +13.2 m.

  The engine ramps over `edge_blend_m`. `check_terrain.py` measures +0.69 m and −0.15 m
  at the joins and finds no problems.

**Known limits:**
- **sol 1700:** of the 24 test poses, 23 lie inside HiRISE (21 with 2 km or more around
  them). The sol 1700 pose (site 82) is 442 m outside: the official mosaic has no data
  there.
- **HiRISE vs CTX:** the two USGS DTMs differ by a spread of 3.6 m, and in 1 km patches
  by −5 to +11 m, with no simple tilt. A single offset can't remove this, hence the
  +6.4 m on the HiRISE west edge.
- **JPL strip seams:** the JPL mosaic's seams near 77.05° E and 77.73–77.87° E (steps
  of about 3 m, up to 9 m) are not corrected.
- **Unfixed HiRISE steps:** HiRISE has 1,248 neighbour steps over 60° (the largest is
  77°), which are left as they are.

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

`test_photos/manifest.json` is the one committed list of test cases with known positions
(`backend/CONTRACTS.md` section 4): 24 rover poses (NASA site/drive), sols 17–1700, from about 20 m to
11.4 km from the landing site, with 38 real Perseverance Navcam photos. Sources: NASA's
[Mars 2020 raw-image archive](https://mars.nasa.gov/mars2020/multimedia/raw-images/) and the
[M20 waypoint GeoJSON](https://mars.nasa.gov/mmgis-maps/M20/Layers/json/M20_waypoints.json).

Each case holds:
- `photos`: per photo the NASA image page, metadata-feed URL, full-resolution image URL and SHA-256,
  UTC time, and the camera calibration (CAHVORE model as the feed gives it, image size, the sensor
  rectangle for crops, horizontal and vertical field of view). Plus a `review` record:
  `skyline_visible`, `usable` (fit for validation), `notes` (e.g. "robotic arm turret blocks the
  middle") and `reviewed_by`.
- `truth`, kept apart and used only for scoring: `lat`/`lon` from the final NASA waypoint localization
  for the photo's site/drive, the rover heading (waypoint yaw), and per photo the true azimuth and
  elevation of the optical axis, from the label's rover attitude applied to the CAHVORE axis.

The manifest holds no skyline samples. Skyline requests are generated from it by the skyline step
(`backend/skyline/scripts/build_test_requests.py`, see `backend/skyline/README.md`) into the git-ignored
`backend/cache/test_requests/`, so they never go stale in git.

To download the images (into `test_photos/images/`, git-ignored, about 60 MB), verify them against the
recorded checksums and refresh calibration and truth from NASA, run from the repository root:

```powershell
.\backend\.venv\Scripts\python.exe data/scripts/fetch_test_photos.py
.\backend\.venv\Scripts\python.exe data/scripts/fetch_test_photos.py --add <NASA image id>   # add a photo
```

A checksum mismatch stops the script (use `--update-checksums` only if NASA really replaced a product).
`--add` accepts Navcam frames with a camera model and attitude, at a pose NASA localized, and refuses
the second eye of a stereo pair already listed. New photos get an empty `review`; fill it from the review
sheet (`build_test_requests.py --review`). The script keeps every `review` as it is. It never runs the
skyline extractor; it uses only the CAHVORE geometry in `backend/skyline/camera.py` for the field of view.

## Data status and provenance

All geospatial coordinates use east-positive longitude and the Mars 2000 sphere
(3,396,190 m); terrain heights use metres above the Mars areoid. The original six
processing scripts and outputs listed above remain the map-layer pipeline. The new
`fetch_terrain.py`, `terrain_sources.json`, `fetch_test_photos.py`,
`test_photos/manifest.json`, and `output/features.geojson` are committed data-side
assets. Terrain GeoTIFFs and full-resolution rover images remain in ignored/local or
shared storage; checksums and manifest metadata are committed. Skyline requests built from the
photos are generated, never committed.
