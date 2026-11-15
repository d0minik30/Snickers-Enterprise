# Mars Map — System Architecture & Workflow

This document details the end-to-end data processing and execution pipeline of the **Snickers Enterprise Mars Map** application, following a top-down approach from user inputs to dual synchronized outputs:

---

## 1. Top-Down Flow Overview

```
                      [ User Uploads Surface Photo ]
                     /locate UI or Rover Camera HUD
                                   │
                 ┌─────────────────┴─────────────────┐
                 ▼                                   ▼
    [ Multi-Tier Orbital Terrain ]       [ Skyline Angle Extraction ]
     HiRISE 1m + CTX 20m + MOLA 200m      Edge detection & ray angles
     1.5 km edge blend & calibrated seams (azimuth & elevation)
                 │                                   │
                 └─────────────────┬─────────────────┘
                                   ▼
                    [ MarsLoc Localization Engine ]
                     Pass 1: Vectorized 2° coarse cross-correlation
                     Pass 2: Gaussian + Outlier mixture likelihood
                                   │
                                   ▼
                [ Fine Search & Landmark Identification ]
                 Hierarchical 12.5 m descent + Mars curvature
                 Dominant landmark named via IAU gazetteer
                                   │
                 ┌─────────────────┴─────────────────┐
                 ▼                                   ▼
     [ Interactive Jezero Map ]           [ Synchronized HUD & Control ]
      Fix, 68%/95% uncertainty,            Field HUD & Earth Control Station
      likelihood heatmap, FOV wedge        synced over 11:20 signal delay
```

*(A visual presentation graphic is rendered in [`architecture_workflow.png`](./architecture_workflow.png)).*

---

## 2. Pipeline Breakdown by Layer

### Tier 1: User Interface & Input
- **Action:** An astronaut on EVA or a rover captures surface photos with an optical camera.
- **Input Parameters:** Image file (PNG/JPEG), horizontal/vertical field of view (HFOV/VFOV), estimated eye height (default $1.7\text{ m}$), and camera roll/pitch uncertainty.
- **Interaction:** Uploaded via the `/locate` web UI or fed directly from the rover HUD.

### Tier 2: Dual Data Ingestion (Parallel Tracks)
- **Track A — Multi-Resolution Orbital Terrain (`data/` & `backend/data_local/`):**
  - High-resolution HiRISE DTM ($1\text{ m}$/px) covering the immediate landing site.
  - Controlled MRO CTX DEM ($20\text{ m}$/px) covering the $30 \times 30\text{ km}$ crater floor.
  - Coarse USGS MOLA–HRSC blend ($200\text{ m}$/px) extending regional coverage out to $\pm 100\text{ km}$.
  - Seam-calibrated with a $1.5\text{ km}$ smooth cosine edge blend band.
- **Track B — Computer Vision Skyline Extraction (`backend/skyline/`):**
  - Column-wise luminance gradient analysis to separate the smooth Martian sky from the rugged terrain.
  - Dynamic weight masking: filters out rover chassis hardware, wheels, and foreground rocks ($<2\text{ m}$).
  - Exact pinhole/CAHVORE conversion from pixel coordinates $(x, y)$ to world viewing rays (azimuth $\alpha$, elevation $\theta$).

### Tier 3: Core Localization Engine (`backend/marsloc/`)
- **Pass 1 (Vectorized Prefilter):** Evaluates all $22{,}801$ precomputed candidate positions on a $200\text{ m}$ grid across all $360^\circ$ headings using pooled $2.0^\circ$ circular cross-correlation. Discards the bottom $90\%$ of candidates in under $1\text{ second}$.
- **Pass 2 (Likelihood Evaluation):** Evaluates survivor candidates in $0.5^\circ$ bins using a robust Gaussian inlier + uniform outlier mixture model:
  $$p(\Delta \theta) = \gamma \cdot \mathcal{N}(\Delta \theta; 0, \sigma^2) + (1 - \gamma) \cdot \frac{1}{\Delta \theta_{\text{outlier}}}$$

### Tier 4: Geodesic Refinement & Landmark Identification
- **Fine Coordinate Descent:** Top modes are refined through a $4$-level hierarchical coordinate search ($100\text{ m} \to 50\text{ m} \to 25\text{ m} \to 12.5\text{ m}$) with live ray-marching.
- **Planetary Curvature Correction:** Incorporates Mars drop $\Delta h \approx d^2 / (2R_{\text{Mars}})$, adjusting far terrain angles by up to $235\text{ m}$ at $40\text{ km}$.
- **Landmark Geocoding:** Identifies the highest distant ridge/peak casting the skyline and cross-references `features.geojson` to report official IAU named landmarks (e.g. *Kodiak Butte*, *Belva Crater Rim*).

### Tier 5: Dual Output Visualization
- **Output 1 — Interactive Map (`/map`, `/locate`):**
  - Displays the estimated coordinate with $68\%$ and $95\%$ confidence uncertainty circles.
  - Renders the $2\text{D}$ likelihood probability heatmap and camera field-of-view heading wedge.
  - Draws a vector ray to the detected landmark with distance and elevation angle tags.
- **Output 2 — Field HUD & Earth Control Station (`/field`, `/control`):**
  - Synchronizes astronaut navigation HUD and mission planner view across the real $11\text{ min } 20\text{ s}$ speed-of-light comms latency.
  - Real-time turn-by-turn guidance, hazard flagging, dynamic A* rerouting, and sloped comms timelines.
