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
│  backend/skyline/         — Person 3's photo→skyline router              │
│  backend/scripts/         — build_horizons.py, check_terrain.py          │
│  backend/data_local/      — Multi-res GeoTIFFs (HiRISE, CTX, MOLA)       │
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
- **`terrain.py`** — Facade over all sources. At each point the **highest-priority** source with data wins; no blending:
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

360° skylines for every candidate on a 200 m grid, quantized and memory-mapped.

| File | Dtype | Shape | Content |
|---|---|---|---|
| `meta.json` | — | — | Grid spec, render config, terrain fingerprint, build time |
| `elev.npy` | int16 | [candidates, azimuths] | Elevation in 0.01° steps; −32768 = none |
| `dist.npy` | uint16 | [candidates, azimuths] | Distance in metres (1 m steps); 0 = none |
| `ground.npy` | float32 | [candidates] | Terrain height under each candidate; NaN = off terrain |

### 5.4 Matcher (`marsloc/match/`)

Coarse-to-fine matching pipeline:
1. **Pass 1: Prefilter:** Pooled 2.0° bins, evaluates all candidates and headings using vectorized capped squared error ($z \le 9 \cdot \text{trust}$). Drops 90% of candidates in ~1.0 s.
2. **Pass 2: Likelihood:** Survivors evaluated in 0.5° bins with full Gaussian + outlier mixture model. Produces the likelihood surface.
3. **Mode Finding:** Flood-fill separates peaks $>600\text{ m}$ apart.
4. **Fine Search:** Hierarchical coordinate descent (100 m $\to$ 50 m $\to$ 25 m $\to$ 12.5 m) with live ray-marching on top modes.
5. **Uncertainty Calculation:** Integrates likelihood mass to find exact 68% and 95% confidence radii.

---

## 6. Contracts (`backend/CONTRACTS.md`)

### §1 — Terrain Input (Person 2 → Engine)
Folder `backend/data_local/terrain/` with `terrain.json`:
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
| **MOLA-HRSC 200m** | ~45 GB (Global) | 80 × 80 km box | **343 KB** | **99.999%** |
| **HiRISE DTM 1m** | ~5.3 GB (Mosaic) | 5 × 5 km box | **20.0 MB** | **99.62%** |
| **Total** | **> 50 GB** | Target Region | **~20.3 MB** | **99.95%** |

### 7.2 Vertical Datum Seam Alignment
Elevation products come from different orbital stereo campaigns and can have vertical offsets. `marsloc/terrain/seams.py` checks boundary overlap using median difference and Median Absolute Deviation ($1.4826 \times \text{MAD}$):
- **HiRISE (1m) vs CTX (20m):** Edge join offset is **-0.36 m** (well within the $\pm 2.0\text{ m}$ tolerance without offset adjustments).
- **CTX (20m) vs MOLA (200m):** Raw median offset was $-2.57\text{ m}$. Applying `vertical_offset_m: -1.2` to `mola_200m` balances both edge join step to **+0.88 m** and median to **-1.37 m** (both well below threshold).

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
- Terrain closer than $1500\text{ m}$ is downweighted ($w_{\text{near}} \to 0.1$) because 20m pixels cannot resolve meters-scale rocks and boulders.

### 8.3 Robust Mixture Likelihood Model
To prevent a nearby 30 cm rock or atmospheric dust haze from invalidating a genuine fix, every observation is modeled with an inlier/outlier mixture:
$$p(\Delta \theta \mid \text{inlier}) = \frac{1}{\sqrt{2\pi \sigma_{\text{tot}}^2}} \exp\left(-\frac{\Delta \theta^2}{2\sigma_{\text{tot}}^2}\right)$$
$$p(\Delta \theta \mid \text{outlier}) = \frac{1}{\Delta \theta_{\text{outlier\_range}}}$$
$$p(\Delta \theta) = \gamma \cdot p(\Delta \theta \mid \text{inlier}) + (1 - \gamma) \cdot p(\Delta \theta \mid \text{outlier})$$
Where $\gamma = (1 - f_{\text{outlier}}) \cdot w_{\text{sample}} \cdot w_{\text{trust}}$.

---

## 9. Algorithmic Complexity & Execution Timings

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
| **Frontend Unit Tests** | Vitest 5 | **133 passed** | Geodesy, turn directions, store replay, signal timeline, A* route finding, tile failure fallback |
| **Backend Geometry & Engine** | Pytest 9 | **76 passed** | Mars sphere math, horizon raymarching, store quantization, sun angles, seam analysis |
| **Multi-Resolution Terrain Seams**| `check_terrain.py` | Verified | HiRISE-CTX seam (-0.36 m), CTX-MOLA seam (+0.88 m) |
| **Browser Smoke Test** | Playwright | Passing | End-to-end multi-window sync under 11:20 delay simulation |

---

## 12. Presentation & Pitch Talking Points (Why This Wins)

1. **Addresses the True Harsh Realities of Mars:**
   - No GPS constellation exists on Mars. Position drift between satellite passes is an unavoidable operational hazard.
   - Speed-of-light latency (11 min 20 s) cannot be engineered away; our Control interface treats signal latency as a first-class UI element rather than pretending connectivity is instantaneous.
2. **Innovative Computer Vision & Terrain Science:**
   - Matches 1D skyline horizon profiles directly against 3D digital elevation models without requiring pre-mapped landmarks.
   - Robust to nearby rocks, dust storms, and perspective distortion.
3. **Extreme Engineering Optimization:**
   - 99.95% bandwidth savings via cloud-native HTTP range requests over NASA/USGS archives.
   - Sub-3-second localization fix on consumer hardware via precomputed quantized horizon stores and coarse-to-fine filtering.
4. **Complete Dual-Tier Operational Demo:**
   - Field Astronaut HUD + Earth Control Station operating simultaneously in two browser windows with genuine simulated orbital comms delays.
