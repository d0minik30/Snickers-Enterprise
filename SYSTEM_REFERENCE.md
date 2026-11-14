# Snickers Enterprise — Mars Map System Reference

> **Purpose:** Self-contained reference for any LLM session working on this codebase. Read this before modifying frontend, backend, data, or engine code.

---

## 1. Project Identity

| Field | Value |
|---|---|
| **Challenge** | NASA Space Apps Challenge 2026 — *"Interplanetary Survival Guide: Martian Map"* |
| **Team** | Snickers Enterprise |
| **Repo** | `Snickers-Enterprise` (GitHub, user `d0minik30`) |
| **Region** | Jezero Crater, Mars — Perseverance landing site (18.4447°N, 77.4508°E) |
| **Core idea** | "Google Maps for Mars": plan a route at a control centre on Earth, follow it on the surface with a HUD, estimate position from skyline photos — all under the real Earth–Mars signal delay |

---

## 2. Team & Ownership Boundaries

| Person | Owns | Does NOT touch |
|---|---|---|
| **Person 1 — Engine** | `backend/` (the `marsloc` package, API server, scripts, tests) | `data/`, `frontend/` |
| **Person 2 — Data** | `data/` (scripts, raw sources, output layers, test photos) | `backend/`, `frontend/` |
| **Person 3 — Photo + App** | `frontend/` and `backend/skyline/` (photo→skyline extraction) | `data/`, `backend/marsloc/` (engine) |

> [!IMPORTANT]
> Each person treats the other two directories as **read-only**. The three file-format contracts in `backend/CONTRACTS.md` are the integration surfaces; they change only by team agreement.

---

## 3. Global Conventions

These apply across **every** file in the repo — frontend TypeScript, backend Python, and data scripts.

| Convention | Value |
|---|---|
| **Sphere** | Mars 2000 (IAU 2000), R = **3,396,190 m** |
| **Coordinates** | Degrees, **east-positive longitude** |
| **JSON lat/lon** | Named fields `{"lat": …, "lon": …}`, never a bare pair |
| **GeoJSON** | Standard `[lon, lat]` order |
| **Bounds** | `[[lat_min, lon_min], [lat_max, lon_max]]` — outer edges of outer cells |
| **Grids** | Row 0 = **northern** edge, col 0 = **western** edge, row-major |
| **Heights** | Metres above the **Mars areoid** (MOLA datum). Jezero floor ≈ −2,500 to −2,600 m; landing site = −2,567 m |
| **Azimuth / heading** | Degrees **clockwise from north**, 0 ≤ value < 360. East = 90° |
| **Elevation angle** | Degrees above the camera's **local horizontal**. Below horizontal is negative |
| **`east_m`, `north_m`** | Metres from the landing site: `east = d·sin(bearing)`, `north = d·cos(bearing)` where `d` = great-circle distance |
| **JSON keys** | `snake_case`; angles end in `_deg`, lengths in `_m` |
| **Signal delay** | 680,000 ms (11 min 20 s one-way), a single constant |

### Mars curvature formula

A terrain point at height `h` and ground distance `d`, seen from a camera at height `hc`:

$$\text{elev} = \arctan\!\left(\frac{(R+h)\cos(d/R) - (R+h_c)}{(R+h)\sin(d/R)}\right) \approx \frac{h - h_c - d^2/2R}{d}$$

Flat ground at 20 km sits ~59 m below a flat tangent plane. The horizon for a 1.7 m eye height is at −0.06°.

### Angle conversion (photo pixels → world rays)

For a rectilinear lens with focal length `f` (pixels), pixel `(x, y)` from image centre (x right, y up):

$$\text{az\_offset} = \arctan(x / f), \qquad \text{elev} = \arctan\!\left(\frac{y}{\sqrt{f^2 + x^2}}\right)$$

Using `atan(y/f)` instead overstates the elevation by ~15% at 30° off-axis.

---

## 4. Architecture Overview

```
┌────────────────────────────────────────────────────────────────────────────┐
│                              FRONTEND (Person 3)                          │
│  Next.js 16 · React 19 · OpenLayers 10 · Leaflet · CSS Modules · Vitest  │
│  Static export (no server)                                                │
│                                                                           │
│  /field   — Phone HUD, heading-rotated map, turn-by-turn nav             │
│  /control — Laptop view, A* route planning, 11:20-delayed live view      │
│  /map     — Jezero Leaflet map with slope/sand/contour/elevation overlays│
│  /locate  — [PLANNED] Upload photos, edit skyline, call engine, show fix │
│                                                                           │
│  lib/mission/  — Event log + BroadcastChannel sync, pure state functions │
│  lib/planner/  — Swappable interface: planRoutes, replan, elevationAt    │
│  lib/nav/      — Haversine, bearings, turn instructions                  │
│  lib/mars/     — NASA tile grid, tile health monitoring                   │
│                                                                           │
│  Calls engine at NEXT_PUBLIC_ENGINE_URL (default http://localhost:8000)   │
└──────────────┬──────────────────────────────────────┬─────────────────────┘
               │  POST /locate (Contract §2 → §3)    │
               │                                      │
┌──────────────▼──────────────────────────────────────▼─────────────────────┐
│                         BACKEND (Person 1 + Person 3)                     │
│  Python 3.12 · FastAPI · NumPy · Rasterio · Pytest                        │
│                                                                           │
│  backend/marsloc/         — Person 1's engine (see §5 below)             │
│  backend/skyline/         — [PLANNED] Person 3's photo→skyline router    │
│  backend/scripts/         — build_horizons.py, check_terrain.py          │
│  backend/data_local/      — Terrain GeoTIFFs (git-ignored)               │
│  backend/cache/           — Precomputed horizon store (git-ignored)       │
│  backend/CONTRACTS.md     — The three file-format contracts              │
│                                                                           │
│  FastAPI: POST /locate, POST /skyline, GET /health (CORS enabled)        │
└──────────────┬───────────────────────────────────────────────────────────┘
               │  Reads terrain tiles (Contract §1)
               │
┌──────────────▼───────────────────────────────────────────────────────────┐
│                           DATA PIPELINE (Person 2)                        │
│  Python · GDAL/Rasterio · GeoPandas · NumPy · Pillow · SciPy             │
│                                                                           │
│  data/raw/                — Source files (git-ignored, large)             │
│  data/output/             — Committed layers (≤5 MB each)                │
│  data/scripts/            — Processing pipeline (6 scripts, in order)    │
│  data/test_photos/        — [PLANNED] Perseverance images + manifest     │
│                                                                           │
│  Sources:                                                                │
│    CTX DEM 20m (MRO, NASA Mars Trek) — current 30×30 km                  │
│    HiRISE ~1m [PLANNED] — near landing site                             │
│    MOLA-HRSC ~200m [PLANNED] — outer ring to 80×80 km                    │
│    USGS SIM 3464 — sand/eolian bedform polygons                          │
└──────────────────────────────────────────────────────────────────────────┘
```

---

## 5. Engine Architecture (backend/marsloc/) — BUILT

The engine finds where an astronaut stands from the skyline in their photos. Method: **coarse-to-fine skyline matching against precomputed horizons**.

### 5.1 Terrain Layer (`marsloc/terrain/`)

Multi-resolution height lookup over tiled GeoTIFFs.

- **`manifest.py`** — Reads `terrain.json` (or auto-generates one for the single CTX file). Validates the contract: sphere radius, units, bounds, nodata.
- **`source.py`** — One resolution level. Tiles are loaded lazily on first access. Bilinear interpolation with gap handling. **Coarser levels** are computed on demand (2^k × 2^k pixel averaging) for far-away lookups, so the renderer can ask for progressively less detail as distance grows.
- **`terrain.py`** — Facade over all sources. At each point the **highest-priority** source with data wins; no blending. `height(lat, lon, min_cell_m)` returns interpolated height; `min_cell_m` triggers coarser levels for performance.

**Key types:**
```python
Terrain.height(lat, lon, min_cell_m=0.0) → float or ndarray  # NaN = no data
Terrain.finest_cell_m(lat, lon) → float
Terrain.source_at(lat, lon) → int  # which source supplies this point
Terrain.terrain_id() → str  # SHA-256 fingerprint for cache invalidation
```

### 5.2 Horizon Renderer (`marsloc/horizon/render.py`)

For a camera position, compute the highest elevation angle of terrain in each azimuth bin over 360°.

**How the ray march works:**
1. Distances start one step from the camera. Step = `max(step_min, step_growth × distance)`, so far terrain costs few samples.
2. At each distance, heights are read at a detail level matching the step size (power-of-two coarsening).
3. Elevation angles include exact Mars curvature: `tan_elev = ((R+h)cos(d/R) − (R+h_c)) / ((R+h)sin(d/R))`.
4. The top-k highest samples per ray are **refined**: the stretch around each is resampled at finer spacing to catch crests between samples.
5. For each bin, the source terrain point (lat, lon, height, distance) is recorded for feature identification.

**Config defaults:**
```python
RenderConfig(
    az_step_deg=0.25,       # 1440 bins for a full circle
    max_range_m=40000,      # rays go 40 km
    step_growth=0.004,      # step grows with distance
    refine_top=3,           # refine the 3 highest samples per ray
    refine_sub=8,           # 8 sub-samples around each
)
```

**Output:** `Horizon` dataclass with arrays per azimuth: `elev_deg`, `dist_m`, `src_lat`, `src_lon`, `src_height_m`, `reach_m`.

### 5.3 Precomputed Horizon Store (`marsloc/horizon/store.py`)

360° skylines for every candidate on a regular grid, quantized and memory-mapped.

**Storage format (one folder in `backend/cache/`):**
| File | Dtype | Shape | Content |
|---|---|---|---|
| `meta.json` | — | — | Grid spec, render config, terrain fingerprint, build time |
| `elev.npy` | int16 | [candidates, azimuths] | Elevation in 0.01° steps; −32768 = none |
| `dist.npy` | uint16 | [candidates, azimuths] | Distance in metres (1 m steps); 0 = none |
| `ground.npy` | float32 | [candidates] | Terrain height under each candidate; NaN = off terrain |

**Store config** (coarser than live render, on purpose):
```python
STORE_CONFIG = RenderConfig(az_step_deg=0.5, step_growth=0.016, refine_top=4, refine_sub=12)
# → 720 bins per candidate, at 200 m spacing
```

**`CandidateGrid`** — Regular in degrees, north-to-south rows, west-to-east columns. Cell centres are the candidate positions. The likelihood heatmap uses the same grid.

**Build:** `scripts/build_horizons.py` renders all candidates, optionally in parallel (multi-process). Fingerprinted against the terrain so stale caches are detected.

### 5.4 Matcher (`marsloc/match/`)

Photos in → position, heading, uncertainty, likelihood map out.

#### Pipeline stages:

```
Pass 1: Prefilter (all candidates, wide 2° bins, cheap capped-squared-error cost)
    ↓ keeps best ~10% of candidates + top 3 headings each
Pass 2: Full likelihood (survivors only, 0.5° bins, proper Gaussian + outlier model)
    ↓ posterior over the grid → likelihood map
Mode finding: separate peaks in the likelihood (flood-fill, >600 m apart)
    ↓ top 3 modes
Fine search: live rendering at 100/50/25/12.5 m steps around each mode
    ↓ refined position, heading, per-photo residuals
Uncertainty: radius around best that holds 68% / 95% of the total likelihood
```

#### Scoring model (`score.py`):

Each observed skyline bin is modeled as either:
- **Inlier** (probability `(1 − outlier_fraction) × weight × trust`): observed = horizon + Gaussian noise
- **Outlier** (nearby rock, haze, bad trace): observed drawn uniformly from a wide range

The Gaussian width combines:
- Photo's own angle error (`sigma_deg`)
- DEM height error seen at distance: `degrees(dem_height_error_m / dist)`
- Parallax from position error: `degrees(position_error_m / dist)`
- Horizon slope × heading error

**Trust** (`reliability`): bins formed by terrain < 750 m away are down-weighted (20 m DEM can't show rocks and ledges that close). Full trust beyond 1500 m.

#### Key config (`MatcherConfig`):
```python
MatcherConfig(
    near_field_m=1500,          # trust ramp
    outlier_fraction=0.1,       # 10% of bins expected to be outliers
    outlier_range_deg=10.0,     # outlier range
    prefilter_keep=0.10,        # keep top 10% from pass 1
    fine_modes=3,               # refine up to 3 separate places
    fine_levels=4,              # 100 → 50 → 25 → 12.5 m
    ambiguous_below=0.6,        # status = "ambiguous" if best holds < 60%
    no_match_below=0.5,         # status = "no_match" if < 50% of skyline fits
)
```

#### Output: `MatchResult`
```python
MatchResult(
    status: str,              # "ok", "ambiguous", "no_match"
    warnings: list[str],
    best: Candidate,          # lat, lon, east_m, north_m, heading_deg, score, probability, spread_m
    candidates: list,         # ranked by probability
    uncertainty_m: float,     # 68% radius
    uncertainty_95_m: float,  # 95% radius
    likelihood: ndarray,      # float32 [rows, cols], 0..1 relative to best
    grid: CandidateGrid,
    timing_ms: dict,
    stats: dict,
)
```

### 5.5 Supporting modules

- **`geo.py`** — Haversine distance, bearing, destination, local↔latlon frame, elevation angle with curvature, curvature drop. All numpy-vectorized.
- **`constants.py`** — `MARS_RADIUS_M`, `LANDING_SITE_LAT/LON`, `DEFAULT_EYE_HEIGHT_M`, `CONTRACT_VERSION`.
- **`match/resample.py`** — Bins photo samples into the grid's azimuth step. Groups photos by known/unknown relative headings.
- **`match/likelihood.py`** — Posterior from log-likelihoods, mode finding (flood-fill on the grid), `radius_for_mass` (uncertainty circles).
- **`match/fine.py`** — Live-render refinement around mode peaks, stepping from 100 m down to 12.5 m.
- **`match/sun.py`** — Sun position hint: if photo has `time_utc` + sun azimuth offset, converts to a heading prior.

---

## 6. Contracts (`backend/CONTRACTS.md`)

### §0 — Shared conventions
(See §3 of this document)

### §1 — Terrain input (Person 2 → Engine)

A folder at `backend/data_local/terrain/` (or `$MARS_TERRAIN_DIR`) containing `terrain.json` and GeoTIFF tiles.

```json
{
  "contract_version": "0.1",
  "sphere_radius_m": 3396190,
  "vertical_datum": "mars_areoid_mola",
  "units": "m",
  "sources": [
    {
      "id": "ctx_20m",
      "priority": 20,
      "cell_size_m": 20,
      "nodata": -3.4028226550889045e38,
      "vertical_offset_m": 0,
      "tiles": [
        {
          "file": "ctx_20m/jezero_ctx_dem_20m.tif",
          "bounds": [[18.2110274, 77.1604655], [18.7211945, 77.6989752]],
          "rows": 1512, "cols": 1596
        }
      ]
    }
  ]
}
```

**Priority cascade:** Highest priority with data wins. Suggested: HiRISE 30, CTX 20, coarse ring 10.

**Coverage needed:** Skyline rendered out to 40 km. Rays leave the current CTX DEM between 13.8–23.0 km. Planned: ~80×80 km total.

### §2 — Skyline input (Person 3 → Engine): `POST /locate`

```json
{
  "contract_version": "0.1",
  "photos": [
    {
      "id": "photo_1",
      "camera": { "hfov_deg": 60.0, "vfov_deg": 45.0, "width_px": 4000, "height_px": 3000, "lens_model": "rectilinear" },
      "eye_height_m": 1.7,
      "horizon_uncertainty_deg": 0.2,
      "relative_heading_deg": null,
      "time_utc": "2026-11-15T10:20:00Z",
      "sun": { "az_offset_deg": -12.4, "elev_deg": 31.0 },
      "samples": [
        { "az_offset_deg": -29.5, "elev_deg": 1.82, "weight": 1.0 }
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

**Key rules:**
- `az_offset_deg`: relative to optical axis, **positive = clockwise = right**
- `elev_deg`: above local horizontal, roll/pitch already removed by Person 3
- `weight`: 0–1, 0 = don't use (nearby rock, haze)
- `relative_heading_deg`: heading of this photo minus first photo; `null` = unknown
- At most 8 photos per request, 20–5000 samples per photo

### §3 — Result (Engine → Person 3): `POST /locate` response

```json
{
  "contract_version": "0.1",
  "status": "ok",
  "best": {
    "lat": 18.4452, "lon": 77.4391,
    "east_m": -657.8, "north_m": 29.6,
    "ground_elevation_m": -2561.3,
    "heading_deg": 262.5,
    "score": 0.91, "probability": 0.84,
    "uncertainty_m": 140, "uncertainty_95_m": 420
  },
  "candidates": [ /* ranked list */ ],
  "likelihood_grid": {
    "bounds": [[18.35, 77.35], [18.54, 77.55]],
    "rows": 57, "cols": 56,
    "scale": 255,
    "values": [ /* int 0..255, row-major */ ]
  },
  "dominant_feature": {
    "lat": 18.4581, "lon": 77.2702,
    "distance_m": 9530, "elev_angle_deg": 3.46,
    "prominence_deg": 1.1,
    "name": null
  },
  "photos": [
    {
      "id": "photo_1",
      "heading_deg": 262.5,
      "rms_residual_deg": 0.09,
      "inlier_fraction": 0.91,
      "residuals": [ /* per-sample observed vs model */ ]
    }
  ],
  "engine": {
    "version": "0.1.0",
    "terrain_sources": ["ctx_20m"],
    "timing_ms": { "total": 1840 }
  }
}
```

**Status values:** `"ok"`, `"ambiguous"` (another place fits nearly as well), `"no_match"` (nothing fits; `best` is least-bad).

---

## 7. Data Pipeline (`data/`)

### 7.1 Source data

| Source | Resolution | Coverage | Vertical datum |
|---|---|---|---|
| MRO CTX Jezero DEM Controlled | 20 m/px | 30×30 km (lon 77.16–77.70, lat 18.21–18.72) | Mars areoid (MOLA) |
| USGS SIM 3464 (Sun & Stack 2020) | — | Jezero geological map | — |
| HiRISE DTM [PLANNED] | ~1 m/px | Near landing site | Needs vertical alignment |
| MOLA-HRSC blend [PLANNED] | ~200 m/px | Global/80×80 km ring | Needs vertical alignment |

### 7.2 Processing pipeline (run in order from repo root)

```bash
pip install -r data/scripts/requirements.txt
python data/scripts/process_dem.py         # 1. slope.png, slope_bounds.json, cost_grid.json
python data/scripts/process_elevation.py   # 2. elevation_grid.json + .bin, terrain_features.geojson
python data/scripts/process_topography.py  # 3. contours.geojson, hillshade.png, elevation.png + legend
python data/scripts/process_sand.py        # 4. sand.geojson
python data/scripts/add_sand_to_grid.py    # 5. adds sand layer to cost_grid.json
python data/scripts/make_places.py         # 6. places.geojson
```

> [!WARNING]
> Step 1 rewrites `cost_grid.json` without sand. If you rerun step 1, rerun steps 5 and 6. Step 2 checks that its grid matches `cost_grid.json`.

### 7.3 Output files

**40 m grid files** (same `bounds`, `rows`, `cols`, `cell_size_deg`):

| File | Content | Used for |
|---|---|---|
| `cost_grid.json` | `slope_deg[row][col]` + `sand[row][col]` per 40 m cell | Pathfinding (A*) |
| `elevation_grid.json` + `.bin` | 4 layers as int16 (elevation, min, max, relief) × 0.1 m scale | Height profiles, climb costs |

**GeoJSON overlays:**
- `slope_bounds.json` — bounds for all image overlays
- `sand.geojson` — eolian bedform polygons
- `places.geojson` — base + 4 mission sites with `elevation_m`
- `terrain_features.geojson` — prominent highs and lows (mounds, craters, delta front)
- `contours.geojson` — 10 m interval contour lines

**Image overlays** (1596×1512 px, one pixel per DEM pixel):
- `slope.png` — green/yellow/red by steepness, alpha 128
- `hillshade.png` — grey shading from NW, alpha 128
- `elevation.png` + `elevation_legend.json` — height coloring, alpha 128

### 7.4 Grid conventions

A point is at row `floor((lat_max − lat) / cell_size_deg.lat)` and column `floor((lon − lon_min) / cell_size_deg.lon)`. The frontend copies `data/output/` into `frontend/public/data/` at every build via a `predev`/`prebuild` script.

---

## 8. Frontend Architecture (`frontend/`)

### 8.1 Tech stack

Next.js 16 (App Router, TypeScript, static export), React 19, OpenLayers 10 (Field/Control maps), Leaflet (Jezero map), CSS Modules + design tokens, Vitest 5, Barlow Condensed typeface.

### 8.2 Screens

| Route | Purpose | Map engine |
|---|---|---|
| `/` | Landing page — explains setup, links to screens | — |
| `/field/` | Phone HUD — heading-rotated map, turn-by-turn nav, growing position uncertainty ring | OpenLayers |
| `/control/` | Laptop view — Plan mode (A* routes) / Live mode (delayed telemetry, signal timeline) | OpenLayers |
| `/map/` (Jezero) | Interactive Mars map with slope/sand/elevation overlays | Leaflet |
| `/locate/` [PLANNED] | Photo upload → skyline editing → engine call → result visualization | Leaflet |

### 8.3 Visual language: "Instrument"

| Token | Value | Meaning |
|---|---|---|
| `--surface` | `#0A0A0B` | Panels, bands |
| `--rule` | `#34343A` | Dividing lines |
| `--text` | `#FFFFFF` | Values |
| `--muted` | `#8D8D96` | Labels |
| `--route` | `#FF5CE1` | Active route, waypoints (magenta) |
| `--caution` | `#FFB000` | Hazards, in-transit, ageing data |
| `--nominal` | `#5BE37D` | Healthy, delivered, low risk |
| `--danger` | `#FF5A4F` | High risk |

Square corners, 1 px rules, no blur/shadows/gradients. Changing numbers use tabular figures to prevent layout jiggle. Respects `prefers-reduced-motion: reduce`.

### 8.4 Mission simulation

**Event-sourced state:** Both browser windows share an append-only log in `localStorage`, announced via `BroadcastChannel`. Pure functions evaluate `f(log, mission_time) → screen state`.

- **Field** sees Control events after `sent + delay ≤ now`
- **Control** sees Field as it was at `now − delay`, plus an "Estimated Now" marker projected forward

**Event types** (`lib/mission/types.ts`):
```typescript
type MissionEvent =
  | { type: 'route-sent'; origin: 'control'; route: Route; ... }
  | { type: 'route-changed'; origin: 'control'; reason: 'hazard' | 'replan'; ... }
  | { type: 'message'; origin: 'control'; text: string; order?: 'hold' | 'proceed' }
  | { type: 'ack'; origin: 'field'; targetId: string }
  | { type: 'traverse-started'; origin: 'field' }
  | { type: 'report'; origin: 'field'; text: string }
```

**Mission clock** speeds: 1×, 10×, 30× (default), 60×. At 30× the 11:20 delay takes ~23 s real time. All on-screen times are mission times.

### 8.5 Route planner interface (`lib/planner/`)

The **swappable boundary** between the UI and real data. The UI only imports from `lib/planner/index.ts`:

```typescript
// Currently mock implementations — Person 2's real data replaces what's behind these
export { planRoutes, replan, spliceRoute } from './routes';
export { elevationAt, DEMO_BOUNDS } from './terrain';
export { positionErrorM, satellitePasses } from './passes';
```

**Key types** (`lib/planner/types.ts`):
```typescript
type LatLon = { lat: number; lon: number };
type Route = {
  id: string; profile: 'safest' | 'shortest' | 'flattest';
  points: LatLon[]; elevationM: number[]; waypoints: Waypoint[];
  lengthM: number; maxSlopeDeg: number; risk: 'low' | 'medium' | 'high';
};
type Hazard = { id: string; center: LatLon; radiusM: number; label: string; source: 'survey' | 'control' };
```

The A* pathfinder runs three times with different cost weightings to produce safest/shortest/flattest routes.

### 8.6 NASA map tiles

Tiles load live from NASA Mars Trek (no stored imagery). Three layers bottom to top:
1. Viking MDIM 2.1 (232 m/px, global, maxNativeZoom 7)
2. CTX Jezero mosaic (6 m/px, maxNativeZoom 13)
3. HiRISE Jezero mosaic (25 cm/px, maxNativeZoom 17)

**OpenLayers** (Field/Control): Equirectangular grid, 2 columns × 1 row at zoom 0, rotatable.
**Leaflet** (Jezero): `L.CRS.EPSG4326` with `R: 3396190`.

If tiles fail to load, a strip says "MAP IMAGERY UNAVAILABLE" and routes/markers still draw.

---

## 9. File Structure

```
Snickers-Enterprise/
├── README.md
├── Background.txt                    # NASA challenge description
├── index.html                        # Old redirect (GitHub Pages, deprecated)
├── .gitignore
│
├── backend/
│   ├── README.md
│   ├── CONTRACTS.md                  # §1 terrain, §2 skyline, §3 result
│   ├── requirements.txt
│   ├── pytest.ini
│   ├── marsloc/                      # Person 1's engine
│   │   ├── __init__.py
│   │   ├── constants.py              # MARS_RADIUS_M, LANDING_SITE, CONTRACT_VERSION
│   │   ├── geo.py                    # Sphere geometry, local frame, elevation angles
│   │   ├── simulate.py               # [validation] synthetic skylines for testing
│   │   ├── terrain/
│   │   │   ├── manifest.py           # terrain.json parsing, GeoTIFF header reading
│   │   │   ├── source.py             # One-resolution tile manager, bilinear sampling
│   │   │   └── terrain.py            # Multi-source facade, priority cascade
│   │   ├── horizon/
│   │   │   ├── render.py             # Ray-march horizon renderer
│   │   │   └── store.py              # Precomputed horizon grid (build + read)
│   │   └── match/
│   │       ├── matcher.py            # Top-level locate() pipeline
│   │       ├── coarse.py             # Two-pass coarse search (prefilter + likelihood)
│   │       ├── fine.py               # Live-render refinement around modes
│   │       ├── likelihood.py         # Posterior, mode finding, uncertainty radii
│   │       ├── resample.py           # Bin photo samples to grid azimuth step
│   │       ├── score.py              # Per-bin likelihood model (Gaussian + outlier)
│   │       └── sun.py                # Sun position → heading hint
│   ├── scripts/
│   │   ├── build_horizons.py         # Precompute all candidate horizons
│   │   └── check_terrain.py          # Report terrain sources, tile problems, height steps
│   ├── tests/                        # pytest (76 tests passing)
│   ├── data_local/                   # GeoTIFFs (git-ignored)
│   └── cache/                        # Precomputed horizons (git-ignored)
│
├── data/
│   ├── README.md                     # Full documentation of all outputs and pipeline
│   ├── map_layers.json               # Base map config (NASA Mars Trek tile URLs)
│   ├── scripts/
│   │   ├── requirements.txt
│   │   ├── process_dem.py            # → slope.png, slope_bounds.json, cost_grid.json
│   │   ├── process_elevation.py      # → elevation_grid.json + .bin, terrain_features.geojson
│   │   ├── process_topography.py     # → contours.geojson, hillshade.png, elevation.png
│   │   ├── process_sand.py           # → sand.geojson
│   │   ├── add_sand_to_grid.py       # → adds sand to cost_grid.json
│   │   └── make_places.py            # → places.geojson
│   ├── output/                       # Committed layers (copied to frontend at build)
│   └── raw/                          # Source files (git-ignored)
│
├── frontend/
│   ├── README.md                     # How to run, test, host, present the demo
│   ├── AGENTS.md                     # Next.js version warning
│   ├── package.json                  # mars-map@0.1.0
│   ├── next.config.ts, tsconfig.json, vitest.config.ts
│   ├── app/
│   │   ├── layout.tsx                # Root layout, Barlow Condensed font
│   │   ├── tokens.css                # Design tokens (CSS custom properties)
│   │   ├── globals.css
│   │   ├── page.tsx                  # Landing page
│   │   ├── field/page.tsx
│   │   ├── control/page.tsx
│   │   └── map/page.tsx              # Jezero map (Leaflet)
│   ├── components/
│   │   ├── field/                    # FieldScreen, NextMoveBand, MessageStrip, ReadoutBand
│   │   ├── control/                  # ControlScreen, PlanRail, LiveRail, SignalTimeline
│   │   ├── jezero/                   # JezeroScreen, mapData (Leaflet-based)
│   │   ├── map/                      # MarsMap (OpenLayers), overlays, styles
│   │   └── shared/                   # Bar, TurnArrow
│   ├── lib/
│   │   ├── nav/                      # geo.ts, format.ts, instructions.ts
│   │   ├── mission/                  # types.ts, store.ts, clock.ts, field.ts, control.ts
│   │   ├── planner/                  # index.ts (swappable), astar.ts, terrain.ts, passes.ts
│   │   ├── mars/                     # tiles.ts, tileHealth.ts
│   │   └── testing/                  # fixtures.ts
│   ├── public/data/                  # Copied from data/output/ at build time
│   └── docs/superpowers/             # Design spec and implementation plan
```

---

## 10. Running the Project

### Frontend
```bash
cd frontend
npm install
npm run dev          # Dev server on port 3000
npm test             # 133 Vitest tests
npm run typecheck    # tsc --noEmit
npm run build        # Static site in out/
npm run smoke        # E2E in real browser (needs Edge/Chrome)
```

### Backend
```bash
cd backend
python -m venv .venv
.venv\Scripts\python -m pip install -r requirements.txt  # Windows
.venv\Scripts\python -m pytest                            # 76 tests

# Terrain setup (get jezero_ctx_dem_20m.tif from Person 2):
# Place at backend/data_local/terrain/ctx_20m/jezero_ctx_dem_20m.tif

# Build precomputed horizons (slow, run once):
.venv\Scripts\python scripts\build_horizons.py

# Check terrain:
.venv\Scripts\python scripts\check_terrain.py
```

### Data pipeline
```bash
pip install -r data/scripts/requirements.txt
# Run scripts 1–6 in order (see §7.2)
# Requires data/raw/jezero_ctx_dem_20m.tif (not in git)
```

---

## 11. Test Coverage

| Suite | Tests | What it covers |
|---|---|---|
| **Frontend (Vitest)** | 133 | Geo math, turn instructions, formatting, mission state + delay, field/control models, signal timeline, A* planner, tile health |
| **Backend (pytest)** | 76 | Sphere geometry, elevation angles, terrain sampling, horizon rendering, horizon store build/read/quantize, sun position, seam detection |

---

## 12. Key Design Decisions & Rationale

1. **Precomputed horizons + coarse-to-fine matching** — Not brute force. Precomputing ~22,500 candidate skylines (one-time cost) makes the coarse scan a fast numpy batch operation (~1–3 s). Only ~50 candidates get expensive live rendering.

2. **No stored ridge shapes** — Skylines depend on where you stand. Comparing against stored reference skylines would fail; instead, skylines are computed from the DEM for candidate positions and compared with the observed one.

3. **Robust outlier model** — A 30 cm rock 2 m away creates an ~8° spike that would ruin a naive comparison. The Gaussian + uniform-outlier likelihood model caps the influence of any single bin, and weights from Person 3 zero out known bad segments.

4. **Multiple candidates + heatmap** — The crater rim looks similar from many directions. Returning a single "best" point would be dishonest. The system returns ranked candidates with probabilities and a full likelihood surface.

5. **Heading as a free parameter** — No compass on Mars. Heading is found by circular cross-correlation of the partial FOV against each 360° candidate skyline. Optional sun hints provide a soft prior.

6. **Event-sourced mission state** — Both browser windows derive the same state from a shared log via pure functions. No server needed, survives reload, and the delay is a first-class part of the state evaluation.

7. **Swappable planner interface** — All UI code imports only from `lib/planner/index.ts`. The mock terrain, routes, and satellite passes behind it can be replaced with real data without touching any screen component.

8. **Static export** — The entire frontend is a static site (`next export`). No server-side rendering. The engine is called client-side. This allows hosting on any static platform (Vercel, Netlify, GitHub Pages).

9. **OpenLayers over Leaflet** (for Field/Control) — Leaflet can't rotate the map. The Field HUD needs the map turned to face the direction of travel. OpenLayers reads NASA's equirectangular tiles directly and rotates natively.

10. **CSS Modules + hand-written CSS** — No Tailwind, no component library. The team wants a design that doesn't look generated and is easy for humans to modify by hand.

---

## 13. Known Limitations & Planned Work

| Area | Status | Next step |
|---|---|---|
| Engine matcher, dominant feature, API | **Built** | Validation harness with real Perseverance photos |
| Photo → skyline extraction (`backend/skyline/`) | **Not started** | Person 3 builds classic image processing pipeline |
| `/locate/` screen | **Not started** | Person 3 builds upload, skyline editor, result view |
| Wider terrain (80×80 km) | **Not started** | Person 2 acquires HiRISE + MOLA-HRSC, aligns vertically |
| Test photos with known positions | **Not started** | Person 2 collects 15–30 Perseverance Navcam/Mastcam-Z images |
| Named features GeoJSON | **Not started** | Person 2 extracts from DEM by prominence |
| Validation screen | **Not started** | Person 3 builds after engine returns real results |

---

## 14. Pitfalls to Watch For

> [!CAUTION]
> **Angle conventions** — `az_offset_deg` is positive to the right (clockwise). Azimuth 0 = north, 90 = east. Test with a known example whenever you touch angle code.

> [!CAUTION]
> **Nearby rocks** — A 30 cm rock 2 m away rises ~8° and looks like a mountain. Weights + robust scoring handle this, but any new scoring code must preserve the outlier model.

> [!WARNING]
> **Height datum offsets** — CTX and HiRISE may be on different zero levels. The engine reports height steps at source boundaries (`check_terrain.py`). Person 2 fixes via `vertical_offset_m`.

> [!WARNING]
> **Low relief** — From Jezero's floor the rim stands only ~1–5° above the horizon. The far skyline shifts ~0.06° per 100 m walked. A 0.3° pitch error in the photo matters. This is why `horizon_uncertainty_deg` exists.

> [!NOTE]
> **Look-alike positions** — The crater rim looks similar from many directions. The system handles this by returning multiple candidates and an honest probability distribution, but UI code must be prepared for `status: "ambiguous"`.

> [!NOTE]
> **Mars curvature** — Must be included everywhere elevation angles are computed. At 20 km, the ground is 59 m lower than on a flat planet. Never use a flat-Earth approximation.
