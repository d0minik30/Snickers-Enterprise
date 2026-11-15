# Snickers Enterprise — Mars Map System Reference

> **Purpose:** Self-contained reference for any LLM session working on this codebase. Read this before modifying frontend, backend, data, or engine code.
>
> **Status:** corrected on 2026-11-15 (about 03:00 local) to match what is actually built and measured. For the live status of the night's work, what is left and where to start, read **`GOOD_MORNING.md`** in the repo root first. Numbers marked *target* are design goals, not measurements.

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

Flat ground at 20 km sits ~59 m below a flat tangent plane (and 235 m lower at 40 km). The horizon for a 1.7 m eye height is at −0.06°.

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
│  /locate  — Upload photos, edit skyline, show engine fix (saved results) │
│  /validate— Saved validation run on real Perseverance photos vs truth    │
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
│  backend/skyline/         — Person 3's photo→skyline router              │
│  backend/scripts/         — build_horizons.py, check_terrain.py, …       │
│  backend/data_local/      — Multi-res GeoTIFFs (HiRISE, CTX, MOLA)       │
│  backend/cache/           — Horizon store, test requests (git-ignored)   │
│  backend/CONTRACTS.md     — The file-format contracts (§1–§4)            │
│                                                                           │
│  HTTP today: backend/skyline/scripts/dev_server.py serves POST /skyline, │
│  POST /skyline/convert, GET /health. POST /locate is NOT built yet; the  │
│  app shows engine results saved by backend/skyline/scripts/*.py.         │
└──────────────┬───────────────────────────────────────────────────────────┘
               │  Reads terrain tiles (Contract §1)
               │
┌──────────────▼───────────────────────────────────────────────────────────┐
│                           DATA PIPELINE (Person 2)                        │
│  Python · GDAL/Rasterio · GeoPandas · NumPy · Pillow · SciPy             │
│                                                                           │
│  data/scripts/fetch_terrain.py — In-flight range cropping & manifest gen │
│  data/scripts/terrain_sources.json — Checksum & offset pinning           │
│  data/output/             — Committed layers (≤5 MB each)                │
│  data/scripts/            — Processing pipeline (6 scripts, in order)    │
│  data/test_photos/        — Perseverance images + manifest.json          │
│                                                                           │
│  Sources:                                                                │
│    HiRISE ~1m (USGS MSR TRN) — 5×5 km landing site box                   │
│    CTX DEM 20m (MRO, NASA Mars Trek) — 30×30 km controlled crater floor  │
│    MOLA-HRSC ~200m (USGS Blend) — 80×80 km regional coverage             │
│    USGS SIM 3464 — sand/eolian bedform polygons                          │
└──────────────────────────────────────────────────────────────────────────┘
```

---

## 5. Engine Architecture (backend/marsloc/)

The engine finds where an astronaut stands from the skyline in their photos. Method: **coarse-to-fine skyline matching against precomputed horizons**.

### 5.1 Multi-Resolution Terrain Layer (`marsloc/terrain/`)

Multi-resolution height lookup over tiled GeoTIFFs.

- **`manifest.py`** — Reads `terrain.json` (or auto-generates one for the single CTX file). Validates the contract: sphere radius, units, bounds, nodata.
- **`source.py`** — One resolution level. Tiles are loaded lazily on first access. Bilinear interpolation with gap handling. **Coarser levels** are computed on demand (2^k × 2^k pixel averaging) for far-away lookups.
- **`terrain.py`** — Facade over all sources. At each point the **highest-priority** source with data wins, blended into the source beneath over a band along its edge (`edge_blend_m`, contract v0.2; default 7.5 cells of the lower source: 150 m HiRISE→CTX, 1.5 km CTX→MOLA). Measured: the height jump across the CTX edge fell from a median 14.7 m (max 62 m) to 1.2 m (max 4.6 m). Sources:
  1. `hirise_1m`: Priority 30, nominal cell size 1.0 m (fine landing site)
  2. `ctx_20m`: Priority 20, nominal cell size 20.0 m (crater floor & rim)
  3. `mola_200m`: Priority 10, nominal cell size 200.0 m (80×80 km outer horizon)

### 5.2 Horizon Renderer (`marsloc/horizon/render.py`)

For a camera position, compute the highest elevation angle of terrain in each azimuth bin over 360°.

**Ray Marching Schedule:**
1. Distances start one step from the camera: $\Delta d = \max(\Delta d_{\min}, \text{step\_growth} \times d)$
2. At distance $d$, heights are queried at resolution $\text{detail} = 2^{\lfloor \log_2(\Delta d) \rfloor}$
3. Curvature-adjusted elevation: $\tan \theta = \frac{(R+h)\cos(d/R) - (R+h_c)}{(R+h)\sin(d/R)}$
4. Top-k samples are refined via local sub-sampling to find peaks falling between rays.
5. Records the landmark coordinate $(lat, lon, height, distance)$ that cast the horizon peak.

### 5.3 Precomputed Horizon Store (`marsloc/horizon/store.py`)

360° skylines for every candidate on a 200 m grid, quantized and memory-mapped. Current build (`backend/cache/horizons_200m_0.5deg/`): the CTX extent, 22,801 candidates, 66 MB, about 3 min with 15 workers (55 ms per candidate per core). The full 80 × 80 km area would be 1.08 M candidates, 3.1 GB, about 2.4 h; not built. All test photo positions lie inside the CTX extent. Between 20 % and 65 % of a horizon is formed by the 200 m data beyond CTX.

| File | Dtype | Shape | Content |
|---|---|---|---|
| `meta.json` | — | — | Grid spec, render config, terrain fingerprint, build time |
| `elev.npy` | int16 | [candidates, azimuths] | Elevation in 0.01° steps; −32768 = none |
| `dist.npy` | uint16 | [candidates, azimuths] | Distance in metres (1 m steps); 0 = none |
| `ground.npy` | float32 | [candidates] | Terrain height under each candidate; NaN = off terrain |

### 5.4 Matcher (`marsloc/match/`)

> [!WARNING]
> **The matcher is NOT validated yet** (being fixed overnight 15 Nov; see `GOOD_MORNING.md` and `backend/STATUS.md`). Measured on simulated photos: about 60 % land within 100 m and wrong answers are still reported as confident. Known bug: a true position can lose to a look-alike that fits 2–3× worse. Real Perseverance photos (24 poses, committed engine): 2 within 50 m, truth inside the 95 % circle for 8 of 24, median error 5.3 km. The pipeline below is the design.

Coarse-to-fine matching pipeline:
1. **Pass 1: Prefilter:** Pooled 2.0° bins, evaluates all candidates and headings using vectorized capped squared error ($z \le 9 \cdot \text{trust}$). Drops 90% of candidates in ~1.0 s.
2. **Pass 2: Likelihood:** Survivors evaluated in 0.5° bins with full Gaussian + outlier mixture model. Produces the likelihood surface.
3. **Mode Finding:** Flood-fill separates peaks $>600\text{ m}$ apart.
4. **Fine Search:** Hierarchical coordinate descent (100 m $\to$ 50 m $\to$ 25 m $\to$ 12.5 m) with live ray-marching on top modes.
5. **Uncertainty Calculation:** Integrates likelihood mass to find exact 68% and 95% confidence radii.

---

## 6. Contracts (`backend/CONTRACTS.md`)

Versions: §1 is at **0.2** (adds the optional `edge_blend_m` blend band); §2 and §3 are as in 0.1 and requests saying 0.1 are accepted; §4 (test cases) is now one slim manifest plus generated requests (see §7.3). Proposed by Person 3 (`backend/skyline/CONTRACT_REVIEW.md`) and not yet in the contract unless `CONTRACTS.md` says so: optional `roll_uncertainty_deg`, `cahvore` as a `lens_model` value, HTTP 422 on an unknown `contract_version`, and the `/skyline` router in the same server as `/locate`. `CONTRACTS.md` is the authority; the excerpts below are short.

### §1 — Terrain Input (Person 2 → Engine)
Folder `backend/data_local/terrain/` with `terrain.json` (the delivered file says 0.1 and has no `edge_blend_m`, so the engine's defaults apply):
```json
{
  "contract_version": "0.1",
  "sphere_radius_m": 3396190,
  "vertical_datum": "mars_areoid_mola",
  "units": "m",
  "sources": [
    { "id": "hirise_1m", "priority": 30, "cell_size_m": 1.0, "vertical_offset_m": 0.0, "tiles": [...] },
    { "id": "ctx_20m", "priority": 20, "cell_size_m": 20.0, "vertical_offset_m": 0.0, "tiles": [...] },
    { "id": "mola_200m", "priority": 10, "cell_size_m": 200.0, "vertical_offset_m": -1.2, "tiles": [...] }
  ]
}
```

### §2 — Skyline Input (Person 3 → Engine): `POST /locate`
```json
{
  "contract_version": "0.1",
  "photos": [
    {
      "id": "photo_1",
      "camera": { "hfov_deg": 60.0, "vfov_deg": 45.0, "width_px": 4000, "height_px": 3000, "lens_model": "rectilinear" },
      "eye_height_m": 1.7,
      "horizon_uncertainty_deg": 0.2,
      "samples": [{ "az_offset_deg": -29.5, "elev_deg": 1.82, "weight": 1.0 }]
    }
  ],
  "options": { "prior": { "lat": 18.4447, "lon": 77.4508, "radius_m": 3000 }, "top_k": 5 }
}
```

### §3 — Result (Engine → Person 3): `POST /locate` response
```json
{
  "contract_version": "0.1",
  "status": "ok",
  "best": {
    "lat": 18.4452, "lon": 77.4391, "east_m": -657.8, "north_m": 29.6,
    "ground_elevation_m": -2561.3, "heading_deg": 262.5,
    "score": 0.91, "probability": 0.84, "uncertainty_m": 140, "uncertainty_95_m": 420
  },
  "candidates": [...],
  "likelihood_grid": { "bounds": [[18.35, 77.35], [18.54, 77.55]], "rows": 57, "cols": 56, "scale": 255, "values": [...] },
  "dominant_feature": { "lat": 18.4581, "lon": 77.2702, "distance_m": 9530, "elev_angle_deg": 3.46, "name": "Western Rim Scarp" }
}
```

---

## 7. Data Pipeline & Optimization

### 7.1 Cloud-Native HTTP Range Streaming (99.95% Bandwidth Reduction)
Instead of downloading multi-gigabyte global rasters, `data/scripts/fetch_terrain.py` uses HTTP range queries (`/vsicurl/` via `rasterio`) to window-crop remote Cloud-Optimized GeoTIFFs:

| Source | Full Dataset Size | Window Cropped | Network Downloaded | Bandwidth Saved |
|---|---|---|---|---|
| **MOLA-HRSC 200m** | ~45 GB (Global) | **±100 km box** (210 × 210 km) | **2.4 MB** | **99.995%** |
| **HiRISE DTM 1m** | ~5.3 GB (Mosaic) | 5 × 5 km box (Landing site) | **20.0 MB** | **99.62%** |
| **Total** | **> 50 GB** | Target Region | **~22.4 MB** | **99.95%** |

### 7.2 Vertical Datum Seam Alignment & Perimeter Boundary Distribution
Elevation products come from different orbital stereo campaigns and can have vertical offsets. 

#### Perimeter Step Distribution Along CTX Boundary ($N = 3,108$ sampled points):
| Boundary Edge | Sample Count | Mean Diff | Median Diff | Std Dev | 5th – 95th Percentile | Min / Max |
|---|---|---|---|---|---|---|
| **North Edge (18.72°N)** | 798 points | $-1.98\text{ m}$ | $-0.14\text{ m}$ | $13.7\text{ m}$ | $[-28.6\text{ m}, +16.9\text{ m}]$ | $-45.6\text{ m} / +29.2\text{ m}$ |
| **South Edge (18.21°N)** | 798 points | $+0.04\text{ m}$ | $+1.62\text{ m}$ | $20.8\text{ m}$ | $[-37.6\text{ m}, +30.8\text{ m}]$ | $-77.6\text{ m} / +37.7\text{ m}$ |
| **West Edge (77.16°E)** | 756 points | $-13.31\text{ m}$ | $-12.72\text{ m}$ | $18.0\text{ m}$ | $[-42.8\text{ m}, +13.7\text{ m}]$ | $-80.5\text{ m} / +54.2\text{ m}$ |
| **East Edge (77.70°E)** | 756 points | $+13.06\text{ m}$ | $+14.18\text{ m}$ | $11.6\text{ m}$ | $[-7.3\text{ m}, +30.1\text{ m}]$ | $-24.5\text{ m} / +37.2\text{ m}$ |
| **Overall Perimeter** | **3,108 points** | **$-0.56\text{ m}$** | **$+1.41\text{ m}$** | **$18.9\text{ m}$** | **$[-33.7\text{ m}, +28.2\text{ m}]$** | **$-80.5\text{ m} / +54.2\text{ m}$** |

#### Blend band (implemented in contract v0.2 as `edge_blend_m`; the engine's ramp may differ from the formula below, see `marsloc/terrain/terrain.py`):
To smooth out local relief differences where 20m CTX resolves scarps that 200m MOLA smooths, the engine supports a transition width $W = 1.5\text{ to }2.0\text{ km}$:
$$w(d) = \frac{1}{2}\left(1 + \cos\left(\pi \frac{W - d}{W}\right)\right) \quad \text{for } 0 \le d \le W$$
$$h(x, y) = w(d) \cdot h_{\text{CTX}}(x, y) + (1 - w(d)) \cdot \left[h_{\text{MOLA}}(x, y) + \Delta_{\text{offset}}\right]$$
Where $d$ is distance inside the CTX boundary. At $d = 0$, $w = 0$ with $C^1$ continuity, completely preventing ray-marching step artifacts.

### 7.3 Ground-Truth Test Photos Dataset (`data/test_photos/`)
One committed list, `data/test_photos/manifest.json` (contract section 4): **24 rover poses, 38 real Perseverance Navcam photos** (sols 17–1700, about 20 m to 11.4 km from the landing site). Per photo: NASA links, SHA-256, CAHVORE calibration, field of view, and a `review` record (`skyline_visible`, `usable`, `notes`). Per pose, kept apart: the truth (`lat`/`lon` from NASA's final waypoint localization, each camera's true heading from its label). No skyline samples are stored; they are regenerated.

| Step | Command (repo root, `backend/.venv` Python) | Writes (git-ignored unless noted) |
|---|---|---|
| Fetch and verify | `data/scripts/fetch_test_photos.py` (`--add <id>` to add a photo) | `data/test_photos/images/`; refreshes the manifest (committed) |
| Build requests | `backend/skyline/scripts/build_test_requests.py --review` | `backend/cache/test_requests/` (one `POST /locate` body per pose), `backend/cache/test_review/index.html` |
| Validate | `backend/skyline/scripts/validate.py --out backend/skyline/out/validation.json --app-copy frontend/public/validation.json` | full report in `backend/skyline/out/`; the `/validate/` copy in `frontend/public/` (committed) |

What the photos show (from the review sheet):
- **Clean far skylines:** 3/1708 (sol 48), 3/1950, 3/2046 (delta front and rim), sols 1300 and 1700 toward the western rim.
- **Hardware in the view, cut at weight 0:** the robotic-arm turret on 3/578 (sol 17) and 3/1416 (sols 45–46); the rover deck below the skyline on many sol 20–33 views.
- **Near skylines (a slope or ridge within about 1–2 km):** sols 175, 700, 1100, 1400. Weak evidence for 20 m terrain.
- **Camera tilted up (+23° to +33°), skyline along the bottom:** sols 85, 100, 1000. Most other early views look down about 30°, with the skyline near the top edge.

### 7.4 Named Martian Landmarks (`data/output/features.geojson`)
Six prominent geological landmarks cataloged with IAU nomenclature and elevations sampled directly from CTX:
1. **Kodiak Butte** (`18.4227°N, 77.3783°E`): Elev $-2521.9\text{ m}$, Prominence $58.2\text{ m}$ (*Science*, Mangold et al. 2021).
2. **Western Delta Front Scarp** (`18.4412°N, 77.3608°E`): Elev $-2470.5\text{ m}$, Prominence $85.0\text{ m}$ (*Space Sci Rev*, Stack et al. 2020).
3. **Santa Cruz Butte** (`18.4681°N, 77.4042°E`): Elev $-2482.7\text{ m}$, Prominence $41.5\text{ m}$ (NASA/JPL).
4. **Jezero Western Rim Crest** (`18.4581°N, 77.2702°E`): Elev $-1805.7\text{ m}$, Prominence $512.0\text{ m}$ (USGS SIM 3464).
5. **Belva Crater Rim** (`18.4800°N, 77.3800°E`): Elev $-2489.3\text{ m}$, Prominence $37.8\text{ m}$ (IAU Feature 15872).
6. **Octavia E. Butler Landing** (`18.4447°N, 77.4508°E`): Elev $-2567.2\text{ m}$ (NASA Mars 2020 Base).

---

## 8. Mathematical Foundations & Physics (For Presentation)

### 8.1 Planetary Curvature & Drop
Because Mars is smaller than Earth ($R_{\text{Mars}} \approx 0.53 R_{\text{Earth}}$), horizon curvature is twice as pronounced. The geometric drop below a horizontal tangent plane is:
$$\Delta h = R \cdot \left(\frac{1}{\cos(d/R)} - 1\right) \approx \frac{d^2}{2R}$$
- At $d = 5\text{ km}$: ground falls $3.7\text{ m}$
- At $d = 20\text{ km}$: ground falls $58.9\text{ m}$
- At $d = 40\text{ km}$: ground falls $235.6\text{ m}$
Failing to account for curvature creates a catastrophic $0.34^\circ$ elevation angle error on distant rim features, completely corrupting candidate matching.

### 8.2 Parallax & Variance Propagation
The matcher accounts for the fact that a candidate position $(x_c, y_c)$ has finite positional uncertainty ($\sigma_{\text{pos}}$) and heading uncertainty ($\sigma_{\text{hdg}}$). The total predicted variance $\sigma_{\text{model}}^2(j)$ for skyline bin $j$ is:
$$\sigma_{\text{model}}^2 = \sigma_{\text{dem}}^2 + \left(\frac{\partial \theta_{\text{elev}}}{\partial \theta_{\text{az}}}\right)^2 \cdot \left[\left(\frac{\sigma_{\text{pos}}}{d}\right)^2 + \sigma_{\text{hdg}}^2\right] + \left(\frac{\theta_{\text{elev}} \cdot \sigma_{\text{pos}}}{d}\right)^2$$
Where:
- $\sigma_{\text{dem}} = \frac{\Delta h_{\text{dem}}}{d}$ is the angular uncertainty of the DEM height error viewed at distance $d$.
- $\frac{\sigma_{\text{pos}}}{d}$ represents the angular parallax shift of terrain features.
- Near-field rule (terrain closer than $1500\text{ m}$ downweighted to $w_{\text{near}} = 0.1$, because 20 m pixels cannot resolve metre-scale rocks): implemented but **default off** until a few-hundred-trial simulation decides it; on 30 trials it looked slightly harmful (50 % vs 60 % within 100 m).

### 8.3 Robust Mixture Likelihood Model
To prevent a nearby 30 cm rock or atmospheric dust haze from invalidating a genuine fix, every observation is modeled with an inlier/outlier mixture:
$$p(\Delta \theta \mid \text{inlier}) = \frac{1}{\sqrt{2\pi \sigma_{\text{tot}}^2}} \exp\left(-\frac{\Delta \theta^2}{2\sigma_{\text{tot}}^2}\right)$$
$$p(\Delta \theta \mid \text{outlier}) = \frac{1}{\Delta \theta_{\text{outlier\_range}}}$$
$$p(\Delta \theta) = \gamma \cdot p(\Delta \theta \mid \text{inlier}) + (1 - \gamma) \cdot p(\Delta \theta \mid \text{outlier})$$
Where $\gamma = (1 - f_{\text{outlier}}) \cdot w_{\text{sample}} \cdot w_{\text{trust}}$.

---

## 9. Algorithmic Complexity & Execution Timings

> [!NOTE]
> The durations below are **targets**, not measurements: there is no `POST /locate` server yet and the matcher is still being fixed. Measured so far: horizon render 55 ms per candidate on one core (68 ms in the HiRISE area); store build for 22,801 candidates about 3 min with 15 workers.

| Pipeline Stage | Algorithm | Computational Complexity | Typical Duration |
|---|---|---|---|
| **Horizon Cache Build** | Ray-march + power-of-two pyramidal DTM sampling | $\mathcal{O}(N_{\text{cand}} \cdot N_{\text{az}} \cdot N_{\text{samples}})$ | One-off offline build (~10 min, parallel) |
| **Pass 1: Prefilter** | Vectorized 2D pooled array circular correlation | $\mathcal{O}(N_{\text{cand}} \cdot N_{\text{hdg\_coarse}} \cdot K_{\text{photo}})$ | **~900 ms** (160,000 candidates scanned) |
| **Pass 2: Likelihood** | Gaussian mixture log-likelihood over survivors | $\mathcal{O}(N_{\text{survivors}} \cdot N_{\text{hdg\_fine}} \cdot K_{\text{photo}})$ | **~400 ms** (~1,500 candidates evaluated) |
| **Mode Clustering** | 2D Spatial Flood-Fill ($>600\text{ m}$ separation) | $\mathcal{O}(N_{\text{grid\_cells}})$ | **~15 ms** |
| **Fine Search** | Multi-level coordinate descent + live ray-march | $\mathcal{O}(M_{\text{modes}} \cdot L_{\text{levels}} \cdot N_{\text{rays}})$ | **~600 ms** (top 3 modes refined to 12.5m) |
| **Summary & Uncertainty**| Radial mass cumulative integration | $\mathcal{O}(N_{\text{cells}} \log N_{\text{cells}})$ | **~25 ms** |
| **Total `POST /locate`** | Complete end-to-end fix | — | **~1.8 – 2.5 seconds** |

---

## 10. Frontend Architecture (`frontend/`)

- **Tech Stack:** Next.js 16 (App Router, static export), React 19, OpenLayers 10, Leaflet, CSS Modules, Vitest 5.
- **Visual System:** "Instrument" cockpit aesthetic (`app/tokens.css`, Barlow Condensed font, monospace numbers).
- **Core Screens:**
  - `/field/`: Phone HUD, heading-rotated map, turn-by-turn nav, growing position uncertainty ring.
  - `/control/`: Plan mode (A* route finder) & Live mode (11:20 delay buffer, sloped comms timeline, hazard rerouting).
  - `/map/`: Jezero viewer with real NASA/USGS overlays (slope, sand, contours, places).
  - `/locate/`: Interactive photo upload, skyline vector editor, and live engine fix presentation.
- **Mission Sync:** Pure event-sourcing over `localStorage` + `BroadcastChannel`. Zero server needed.

---

## 11. Testing & Verification

| Test Suite | Framework | Count | Coverage |
|---|---|---|---|
| **Frontend Unit Tests** | Vitest 5 | **194 passed** (15 Nov) | Geodesy, turn directions, store replay, signal timeline, A* route finding, tile failure fallback, locate/validate models |
| **Backend Engine** (`backend/tests/`) | Pytest | **82 passed, 2 skipped** (commit 7deb150) | Mars sphere math, terrain + blend band, horizon raymarching vs brute force, store quantization, sun angles, seams. The matcher has almost no tests yet |
| **Backend Skyline** (`backend/skyline/tests/`) | Pytest | **22 passed, 6 skipped** | Photo → skyline. `test_api.py` needs `python-multipart` installed in `backend/.venv` |
| **Multi-Resolution Terrain Seams**| `check_terrain.py` | Verified | HiRISE-CTX step −0.31 m, CTX-MOLA step +0.87 m (medians; local differences reach ±30 m, hence the blend band) |
| **Real-photo validation** | `backend/skyline/scripts/validate.py` | Run 15 Nov 00:41 UTC | 24 poses: 2 within 50 m, median 5.3 km; matcher not validated (see §5.4) |
| **Browser Smoke Test** | Playwright | Passing | End-to-end multi-window sync under 11:20 delay simulation |

---

## 12. Presentation & Pitch Talking Points (Why This Wins)

1. **Addresses the True Harsh Realities of Mars:**
   - No GPS constellation exists on Mars. Position drift between satellite passes is an unavoidable operational hazard.
   - Speed-of-light latency (11 min 20 s) cannot be engineered away; our Control interface treats signal latency as a first-class UI element rather than pretending connectivity is instantaneous.
2. **Innovative Computer Vision & Terrain Science:**
   - Matches 1D skyline horizon profiles directly against 3D digital elevation models without requiring pre-mapped landmarks.
   - Designed to be robust to nearby rocks, dust haze and perspective distortion (weights, robust scoring). Only claim accuracy that the latest validation run shows.
3. **Extreme Engineering Optimization:**
   - 99.95% bandwidth savings via cloud-native HTTP range requests over NASA/USGS archives.
   - Target: a localization fix in a few seconds on a laptop, via precomputed quantized horizon stores and coarse-to-fine filtering (not yet measured end to end).
4. **Complete Dual-Tier Operational Demo:**
   - Field Astronaut HUD + Earth Control Station operating simultaneously in two browser windows with genuine simulated orbital comms delays.
