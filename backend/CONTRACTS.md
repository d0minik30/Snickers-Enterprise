# Engine contracts — DRAFT v0.3 (not agreed yet)

The three file formats around the localization engine in `backend/`:

1. **Terrain input** — Person 2 (data) → engine
2. **Skyline input** — Person 3 (photo + app) → engine, the body of `POST /locate`
3. **Result** — engine → Person 3, the response of `POST /locate`

Nothing here is final until all three of us agree. After that, a change needs a new
`contract_version` and a heads-up to the team.

**Changed in 0.2:** section 1 only. Along its edge a source is now blended into the source beneath
it (`edge_blend_m`) instead of switching hard.

**Changed in 0.3** (from Person 3's review, `backend/skyline/CONTRACT_REVIEW.md`): section 2 gains the
optional `roll_uncertainty_deg` per photo and the `lens_model` value `cahvore`; section 3 gains
`photos[].horizon_tilt_deg`; an unknown `contract_version` is refused with HTTP 422; `/locate`,
`/health` and the skyline step's `/skyline` routes are served by one server. Nothing was removed:
a request may say `"0.1"`, `"0.2"` or `"0.3"`, and the result repeats the request's value.

## 0. Conventions shared by all three

| Thing | Convention |
|---|---|
| Sphere | Mars 2000 sphere, R = 3 396 190 m (same as `data/scripts` and `MARS_RADIUS_M` in `frontend/lib/nav/geo.ts`) |
| Latitude, longitude | Degrees, east-positive longitude. In JSON always named fields `{"lat": …, "lon": …}`, never a bare pair |
| Bounds | `[[lat_min, lon_min], [lat_max, lon_max]]`, the outer edges of the outer cells (same as `data/output/*.json`) |
| Grids | Row 0 = northern edge, col 0 = western edge, row-major (same as `cost_grid.json`) |
| Heights | Metres above the Mars areoid (MOLA datum), the datum of the current CTX DEM. The landing site reads −2567.2 m |
| Azimuth, heading | Degrees clockwise from north, 0 ≤ value < 360. East = 90 |
| Elevation angle | Degrees above the camera's local horizontal (the plane at right angles to "straight down" at the camera). Below horizontal is negative |
| Landing site (origin) | 18.4447 N, 77.4508 E |
| `east_m`, `north_m` | Metres from the landing site: with `d` = great-circle distance and `b` = initial bearing from the landing site to the point (`distanceM` and `bearingDeg` in `geo.ts`), `east_m = d·sin b`, `north_m = d·cos b` |
| JSON keys | `snake_case`; angles end in `_deg`, lengths in `_m` |

Curvature: a terrain point at height `h` and ground distance `d`, seen from a camera at height
`hc` (ground + eye height), has elevation angle
`atan2((R+h)·cos(d/R) − (R+hc), (R+h)·sin(d/R))`, which is about `(h − hc − d²/2R) / d`.
Flat ground therefore sits slightly below 0° (the horizon is at −0.06° for a 1.7 m eye height), and
terrain 20 km away loses 59 m.

## 1. Terrain input (Person 2 → engine)

A folder, **outside git**, that the engine reads from `backend/data_local/terrain/` (or the path in
the environment variable `MARS_TERRAIN_DIR`). It holds one manifest, `terrain.json`, and the height
tiles it lists.

### Tiles

- **Format:** GeoTIFF, one band, float32, lossless compression or none. The manifest, not the
  GeoTIFF header, is the authority on where a tile sits; the engine cross-checks the header against
  it and reports any mismatch.
- **Grid:** regular in degrees, north up: rows along constant latitude, columns along constant
  longitude. This is the grid of the current CTX file (equirectangular, standard parallel 0, on the
  sphere). HiRISE DTMs usually come in a projection with a different standard parallel, so they need
  resampling onto this grid.
- **Registration:** `bounds` are the outer edges of the outer pixels; each value is the height at its
  pixel's centre.
- **Units and datum:** metres above the Mars areoid, for every source. If a source is known to sit
  on a different zero level, give `vertical_offset_m` (the engine adds it to that source's heights).
- **Nodata:** `NaN`, or the value in `nodata`. The engine also treats anything below −1e30 as nodata
  (the CTX file uses −3.4028e38).
- **Tiles of one source** share one cell size and one grid, touch edge to edge, and do not overlap.
  The engine interpolates across tile borders. Suggested tile size: at most 2048 × 2048 pixels.
  A source may be a single file.

### Which source wins

At each spot the engine uses the source with the highest `priority` that has data there, and falls
through to the next one where it is nodata. Suggested: HiRISE 30, CTX 20, coarse ring 10.

**Blend band (new in 0.2).** Two sources can differ by tens of metres where they meet: CTX and the
200 m data by up to about 30 m locally. A hard switch puts a false cliff into every horizon that
looks across the join. So along the edge of its bounds a source is blended into whatever lies beneath
it: at the edge the height is the lower source's, `edge_blend_m` further in it is the source's own,
with a smooth ramp in between. `edge_blend_m` is optional per source. Without it the engine uses
7.5 cells of the source beneath: 150 m for HiRISE onto CTX, 1.5 km for CTX onto the 200 m data.
`0` gives a hard switch. Holes inside a source (nodata) are not blended; they fall through as before.

The engine still measures the raw height step where sources join and reports it
(`backend/scripts/check_terrain.py`); Person 2 fixes the data or sets `vertical_offset_m`. Blending
hides a step; it does not make a wrong zero level right.

### Coverage the engine needs

The skyline is rendered out to 40 km. From the landing site, every ray leaves the current CTX DEM
between 13.8 and 23.0 km, before it reaches the east and south rim. So the wider area should reach
at least the whole rim plus a few km beyond it in every direction (the planned 80 × 80 km does).
Fine HiRISE data matters most within about 2 km of where the astronaut can be.

### `terrain.json`

```json
{
  "contract_version": "0.2",
  "sphere_radius_m": 3396190,
  "vertical_datum": "mars_areoid_mola",
  "units": "m",
  "sources": [
    {
      "id": "ctx_20m",
      "description": "MRO CTX, Jezero DEM, Controlled (NASA Mars Trek)",
      "priority": 20,
      "cell_size_m": 20,
      "nodata": -3.4028226550889045e38,
      "vertical_offset_m": 0,
      "edge_blend_m": 1500,
      "tiles": [
        {
          "file": "ctx_20m/jezero_ctx_dem_20m.tif",
          "bounds": [[18.2110274, 77.1604655], [18.7211945, 77.6989752]],
          "rows": 1512,
          "cols": 1596
        }
      ]
    }
  ]
}
```

| Field | Meaning |
|---|---|
| `sources[].id` | Short name; appears in engine reports and in the result's `engine.terrain_sources` |
| `sources[].priority` | Higher wins where sources overlap |
| `sources[].cell_size_m` | Nominal north–south cell size, for choosing data by distance. The exact size comes from `bounds`, `rows`, `cols` |
| `sources[].nodata` | Optional; see Nodata above |
| `sources[].vertical_offset_m` | Optional, default 0 |
| `sources[].edge_blend_m` | Optional. Width in metres of the blend band along the source's edge. Default: 7.5 cells of the source beneath. 0 = hard switch |
| `tiles[].file` | Path relative to the folder |
| `tiles[].bounds`, `rows`, `cols` | Where the tile sits and its size in pixels |

Until Person 2 delivers this folder, the engine builds the manifest above itself when it finds
the one CTX file at `backend/data_local/terrain/ctx_20m/jezero_ctx_dem_20m.tif`.

A `.ply` point cloud is only for looking at the terrain in CloudCompare. The engine can export one
from the height grids; it is not an input.

## 2. Skyline input (Person 3 → engine): body of `POST /locate`

One request = one standing position, one or more photos taken from it (within a few metres).

```json
{
  "contract_version": "0.1",
  "photos": [
    {
      "id": "photo_1",
      "camera": {
        "hfov_deg": 60.0,
        "vfov_deg": 45.0,
        "width_px": 4000,
        "height_px": 3000,
        "lens_model": "rectilinear"
      },
      "eye_height_m": 1.7,
      "horizon_uncertainty_deg": 0.2,
      "relative_heading_deg": null,
      "time_utc": "2026-11-15T10:20:00Z",
      "sun": { "az_offset_deg": -12.4, "elev_deg": 31.0 },
      "samples": [
        { "az_offset_deg": -29.5, "elev_deg": 1.82, "weight": 1.0 },
        { "az_offset_deg": -29.4, "elev_deg": 1.85, "weight": 1.0 },
        { "az_offset_deg": -29.3, "elev_deg": 9.10, "weight": 0.0 }
      ]
    }
  ],
  "options": {
    "prior": { "lat": 18.4447, "lon": 77.4508, "radius_m": 3000 },
    "top_k": 5,
    "include_likelihood_grid": true,
    "include_residuals": true
  }
}
```

### Per photo

| Field | Required | Meaning |
|---|---|---|
| `id` | yes | Any string; echoed in the result |
| `camera.hfov_deg`, `vfov_deg` | yes | Full horizontal and vertical field of view. A stitched panorama may have `hfov_deg` up to 360 |
| `camera.width_px`, `height_px` | yes | Image size. With the field of view it tells the engine how fine one pixel is, which sets the expected angle noise |
| `camera.lens_model` | yes | `rectilinear`, `fisheye_equidistant`, `cylindrical`, `cahvore` or `other`. For the record and for diagnostics; the engine does not undo lens distortion, the samples must already be angles |
| `eye_height_m` | no, default 1.7 | Camera height above the ground |
| `horizon_uncertainty_deg` | no, default 0 | How far the "local horizontal" used for `elev_deg` may be off (leftover pitch error). If above 0, the engine fits one constant up/down shift per photo within ± this value |
| `roll_uncertainty_deg` | no, default 0 | How far the camera's roll may be off. A roll error tilts the skyline: at azimuth offset `a` the elevation is off by about `t · sin(a)`. If above 0, the engine also fits that tilt `t` per photo within ± this value (new in 0.3) |
| `relative_heading_deg` | no, default `null` | Heading of this photo's optical axis minus the heading of the first photo's, clockwise positive. `null` = unknown. The first photo has 0 or `null`. Photos with a number turn together with the first photo; photos with `null` are matched at their own free heading |
| `time_utc` | no | When the photo was taken, ISO 8601, UTC |
| `sun` | no | Centre of the sun in the image: `az_offset_deg` (same convention as samples) and optionally `elev_deg`. Needs `time_utc`. The engine turns it into a heading hint; it is a hint, not a constraint |
| `samples` | yes | The traced skyline, at least 20 samples, at most 5000 |

### Samples

| Field | Meaning |
|---|---|
| `az_offset_deg` | Azimuth of the sample's viewing ray minus the azimuth of the optical axis, measured in the horizontal plane. **Positive = clockwise = to the right in the image** |
| `elev_deg` | Angle of the viewing ray above the local horizontal, with camera roll and pitch already removed |
| `weight` | 0 to 1. 0 = do not use (nearby rock, haze, rover hardware). Default 1 |

- Both angles are angles of the **ray in the world**, not image-plane angles. For a rectilinear lens
  with focal length `f` (pixels) and a level camera, a pixel `(x, y)` from the image centre (x right,
  y up) has `az_offset = atan(x / f)` and `elev = atan(y / sqrt(f² + x²))`. Using `atan(y / f)` instead
  overstates the elevation by 15 % at 30° off-axis.
- Sign check: if the camera faces east (heading 90°), a peak to the right of the image centre at
  `az_offset_deg = +10` is at azimuth 100° (toward the south-east).
- Any order, any spacing; about one sample per 0.1° is plenty. The engine sorts and resamples.
- Where the skyline can't be traced, either leave the samples out or give them weight 0. Both count
  as a gap.
- Negative `elev_deg` is normal on flat ground.

### Options (all optional)

| Field | Default | Meaning |
|---|---|---|
| `prior` | none | Rough known position: only candidates within `radius_m` of it are searched |
| `top_k` | 5 | How many candidates to return |
| `include_likelihood_grid` | true | Set false to leave the heatmap out |
| `include_residuals` | true | Set false to leave the per-sample residual lists out |

Limits: at most 8 photos per request. A request that breaks the contract gets HTTP 422 with a
message naming the field. That includes a `contract_version` the engine does not know: a stale
app fails loudly instead of being half understood.

## 3. Result (engine → Person 3): response of `POST /locate`

```json
{
  "contract_version": "0.1",
  "status": "ok",
  "warnings": [],
  "best": {
    "lat": 18.4452,
    "lon": 77.4391,
    "east_m": -657.8,
    "north_m": 29.6,
    "ground_elevation_m": -2561.3,
    "heading_deg": 262.5,
    "score": 0.91,
    "probability": 0.84,
    "uncertainty_m": 140,
    "uncertainty_95_m": 420
  },
  "candidates": [
    { "rank": 1, "lat": 18.4452, "lon": 77.4391, "east_m": -657.8, "north_m": 29.6,
      "heading_deg": 262.5, "score": 0.91, "probability": 0.84 },
    { "rank": 2, "lat": 18.4710, "lon": 77.4466, "east_m": -236.1, "north_m": 1558.9,
      "heading_deg": 255.0, "score": 0.74, "probability": 0.11 }
  ],
  "likelihood_grid": {
    "bounds": [[18.3500, 77.3500], [18.5400, 77.5500]],
    "rows": 57,
    "cols": 56,
    "cell_size_m": { "north_south": 200.0, "east_west": 200.2 },
    "scale": 255,
    "values": [[0, 0, 3, 12], [0, 1, 40, 255]]
  },
  "dominant_feature": {
    "name": null,
    "lat": 18.4581,
    "lon": 77.2702,
    "east_m": -10157.0,
    "north_m": 820.5,
    "elevation_m": -1978.0,
    "distance_m": 9530,
    "distance_check_m": 9410,
    "azimuth_deg": 274.6,
    "elev_angle_deg": 3.46,
    "prominence_deg": 1.1,
    "photo_id": "photo_1",
    "az_offset_deg": 12.1
  },
  "photos": [
    {
      "id": "photo_1",
      "heading_deg": 262.5,
      "horizon_shift_deg": 0.04,
      "rms_residual_deg": 0.09,
      "median_abs_residual_deg": 0.05,
      "inlier_fraction": 0.91,
      "residuals": [
        { "az_offset_deg": -29.5, "observed_elev_deg": 1.82, "model_elev_deg": 1.79,
          "residual_deg": 0.03, "distance_m": 10240, "used": true }
      ]
    }
  ],
  "engine": {
    "version": "0.1.0",
    "terrain_sources": ["ctx_20m"],
    "candidate_spacing_m": 200,
    "timing_ms": { "total": 1840, "coarse": 900, "fine": 700 }
  }
}
```

| Field | Meaning |
|---|---|
| `status` | `ok`; `ambiguous` (another, separate place fits nearly as well: show the candidates and the heatmap, not one point); `no_match` (nothing fits well enough: `best` is still the least-bad place but must not be trusted) |
| `warnings` | Plain-English strings, e.g. `"skyline is nearly flat (0.3° of relief): position is weakly constrained"`, `"38 % of the skyline was given weight 0"` |
| `best` | The most likely position and the heading of the **first** photo |
| `best.score` | 0 to 1: the share of the trusted skyline (by weight) that the matched terrain reproduces within tolerance. 1 = every trusted sample fits |
| `best.probability` | 0 to 1: the share of the total likelihood that lies in this candidate's peak. Low = look-alike places exist |
| `best.uncertainty_m` | Radius of the circle around `best` that holds 68 % of the likelihood. `uncertainty_95_m`: the same for 95 %; it gets large when look-alike places exist |
| `candidates` | The `top_k` separate peaks of the likelihood, best first. `candidates[0]` is `best` |
| `likelihood_grid` | Heatmap. Regular in degrees like `cost_grid.json`; `values[row][col]` are integers 0 to `scale`, and `value / scale` is the likelihood relative to the best cell. Cropped to the box that holds everything above 0. Draw it with `L.imageOverlay` semantics using `bounds` |
| `dominant_feature` | The most prominent distant piece of the matched skyline inside the photos, or `null` if the skyline has none. `lat`/`lon`/`elevation_m`: the terrain point that forms it. `distance_m`: ground distance from the camera. `distance_check_m`: the same distance recomputed from the height difference and `elev_angle_deg` with curvature; a big gap between the two means don't trust it. `name`: the nearest named place or terrain feature from `data/output/`, else `null`. `photo_id` and `az_offset_deg`: where to label it in the photo |
| `photos[].heading_deg` | Direction each photo's optical axis faced, clockwise from north |
| `photos[].horizon_shift_deg` | The constant up/down shift the engine fitted (0 unless `horizon_uncertainty_deg` was given) |
| `photos[].horizon_tilt_deg` | The tilt `t` the engine fitted (0 unless `roll_uncertainty_deg` was given; new in 0.3) |
| `photos[].rms_residual_deg`, `median_abs_residual_deg`, `inlier_fraction` | How far this photo's trusted skyline is from the matched one |
| `photos[].residuals` | Per sample bin: what was observed, what the terrain gives at the matched position (`model_elev_deg`, so the app can draw the matched skyline over the photo), their difference, how far away the terrain forming it is, and whether the bin counted (`used` is false for weight 0 and rejected outliers). Bins formed by terrain closer than about 1–2 km count less: 20 m elevation data can't show rocks, ripples and ledges that close |
| `engine` | Version, the terrain sources in use, candidate grid spacing and timings |

`GET /health` returns `{"status": "ok", "contract_version": "0.3", "terrain_loaded": true,
"skylines_loaded": true}`.

**One server.** `POST /locate` and `GET /health` are served by the same FastAPI app as the skyline
step's routes (`/skyline`, `/skyline/convert`, from `backend/skyline/api.py`), so the app needs one
base URL. CORS allows `http://localhost:3000` and the hosted site's address. Errors: FastAPI's 422
list (`detail: [{loc, msg}]`) for contract violations; other 4xx carry a `detail` string.

## 4. Test cases with known positions (Persons 2 and 3 → engine)

So the validation harness can run on real Perseverance photos. The test cases are one committed list,
`data/test_photos/manifest.json` (Person 2, written by `data/scripts/fetch_test_photos.py`). It holds
the inputs and the truth, but no skyline: skylines are generated from it, never committed.

One case per rover pose (NASA site/drive), with the photos taken there:

```json
{
  "name": "site03_drive0578",
  "pose": "3/578",
  "sol": 17,
  "photos": [{
    "image_id": "NLF_0017_…", "instrument": "NAVCAM_LEFT", "time_utc": "2021-03-08T05:07:20.728Z",
    "source": "NASA raw-image page", "metadata_url": "…", "image_url": "…", "image_sha256": "…",
    "camera": { "model": "CAHVORE", "components": "…", "width_px": 1280, "height_px": 960,
                "hfov_deg": 96.5, "vfov_deg": 73.1 },
    "review": { "skyline_visible": true, "usable": true, "notes": "…", "reviewed_by": "…" }
  }],
  "truth": { "lat": 18.4452799, "lon": 77.45149726, "headings_deg": { "NLF_0017_…": 61.76 },
             "position_source": "…", "heading_source": "…" }
}
```

- `truth` is for scoring only and never goes into a request. `headings_deg` maps each photo to the
  true azimuth of its optical axis (degrees from north), or `null` where it isn't known.
- `review.usable` says whether a photo is fit for validation (a skyline is visible and not mostly
  hidden); only usable photos are sent to the engine.
- The requests are generated (Person 3, `backend/skyline/scripts/build_test_requests.py`): the current
  skyline step runs on every usable photo and writes one section 2 body per case to
  `backend/cache/test_requests/<name>.json` (git-ignored), plus `index.json` saying which image each
  `photo_k` is. `backend/skyline/scripts/validate.py` sends those bodies to the engine and scores the
  answers against `truth`.

## Open questions for the team

1. **Person 2:** is GeoTIFF on a regular degree grid fine for HiRISE too (it needs resampling), and
   can every source be on the areoid datum?
2. **Person 3:** can you produce true ray angles (the `atan(y / sqrt(f² + x²))` form) and an honest
   `horizon_uncertainty_deg`? Seen from the crater floor the rim stands only 2–5° high and the far
   skyline shifts by about 0.06° per 100 m walked, so a 0.3° pitch error matters.
3. **Person 3:** is the heatmap as a JSON grid of 0–255 fine, or would you rather have a PNG?
4. **Everyone:** is `prior` (a rough known position) something the app can supply? It makes look-alike
   places far less likely to win.
