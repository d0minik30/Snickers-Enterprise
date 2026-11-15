# Mars Map — System Architecture & Workflow

This document follows one position fix of the **Snickers Enterprise Mars Map** from the photo to the screens that show it. It was checked against the code on 2026-11-15; `backend/STATUS.md` holds the measured accuracy and timings.

---

## 1. Top-Down Flow Overview

```
   PREPARED ONCE (offline)                      PER REQUEST (POST /skyline, POST /locate)

                                         [ Surface Photo ]
                                    /locate screen or Jezero map
                                                 │
                                                 ▼
                                      [ Skyline Extraction ]
                                   trace, per-column trust, pixels
                                   → azimuth & elevation angles
                                                 │
 [ Orbital Terrain ]                             ▼
  HiRISE 1 m + CTX 20 m + MOLA 200 m     [ Coarse Search ]
          │                         ┌──▶  pass 1: cheap cost, all candidates, all headings
          ▼                         │     pass 2: full likelihood of the best 20 %
 [ Precomputed Horizons ] ──────────┘            │
  22,801 positions, 200 m grid, 0.5° bins        ▼
          ·                              [ Fine Search ]
          · terrain, rendered live ─────▶ top 3 places, 200 m → 3 m pattern search
                                                 │
                                                 ▼
                                    [ Position Fix & Uncertainty ]
                                   verdict, 68 % / 95 % circles,
                                   dominant landmark
                                                 │
                         ┌───────────────────────┴───────────────────────┐
                         ▼                                               ▼
               [ Locate Screen & Map ]                         [ Field HUD & Control ]
           fix, circles, heat map, view wedge              photo fix resets the drift ring;
                                                           Control sees it 11 min 20 s later
```

*(A slide-ready graphic is rendered in [`architecture_workflow.png`](./architecture_workflow.png) by `backend/scripts/generate_workflow_diagram.py`.)*

---

## 2. Pipeline Breakdown by Stage

### Stage 1: Surface Photo
- **Action:** An astronaut or rover takes one or more photos with the skyline in view.
- **Inputs:** The image, plus what is known about the camera: field of view (from EXIF, a Perseverance label file, or chosen by hand), eye height (default 1.7 m), and how far the camera's level may be off (`horizon_uncertainty_deg`).
- **Where:** The `/locate` screen and the "find me" panel of the Jezero map send the photo to the engine server (default `http://localhost:8000`).

### Stage 2: Skyline Extraction (`backend/skyline/`, `POST /skyline`)
- Traces the line between sky and ground in every column of the photo.
- Gives every column a trust weight from 0 to 1. Columns where something near rises into the sky (a rock, the rover's arm, a person) get weight 0; haze, glare, image edges and a jumping line lower the weight.
- Converts pixels to world angles (azimuth offset and elevation above the local horizontal) with a rectilinear or JPL CAHVORE camera model.
- Reads the sun from the photo when it can; with the capture time this gives a heading hint.
- A line the user edited in the app is converted the same way (`POST /skyline/convert`).

### Stage 3: Orbital Terrain (prepared once, `backend/data_local/terrain/`)
- HiRISE DTM, 1 m: 5 × 5 km around the landing site.
- CTX DEM, 20 m: 30 × 30 km crater floor and rim.
- MOLA–HRSC blend, 200 m: the regional horizon out to about 40 km.
- Where a finer source ends, it is blended into the coarser one over a band: 150 m (HiRISE → CTX) and 1.5 km (CTX → MOLA).

### Stage 4: Precomputed Horizons (prepared once, `backend/marsloc/horizon/`)
- For every candidate position on a 200 m grid over the CTX area (22,801 positions), the 360° horizon is rendered by ray marching in 0.5° bins, with Mars's curvature (ground 40 km away sits 235 m below a flat tangent plane).
- Stored quantized and memory-mapped: 66 MB, built in about 4 minutes on 15 cores.

### Stage 5: Coarse Search (`backend/marsloc/match/coarse.py`)
- **Pass 1 (prefilter):** a cheap capped squared error of every candidate at every heading, in 2° bins. The best 20 % go on (at least 1,500; fewer when the photos cover more than 75° of skyline).
- **Pass 2 (likelihood):** the survivors in 0.5° bins with a robust inlier/outlier mixture, so a nearby rock or haze cannot wreck a true match:
  $$p(\Delta \theta) = \gamma \cdot \mathcal{N}(\Delta \theta; 0, \sigma^2) + (1 - \gamma) \cdot p_{\text{outlier}}$$
  where $\gamma$ is 0.9 times the sample's trust and an outlier costs as much as a 3σ miss. The result is a likelihood map over the whole area.
- **Modes:** the map is split into separate places (peaks more than 600 m apart).

### Stage 6: Fine Search (`backend/marsloc/match/fine.py`)
- The three most likely places are refined with horizons rendered live from the terrain: a 3 × 3 pattern search whose step halves 7 times (200 m → 3.1 m), with the heading searched continuously.
- The refined fits decide how the likelihood is shared: a look-alike place that fits on the 200 m grid but not at a few metres loses its share.

### Stage 7: Position Fix & Uncertainty (`backend/marsloc/match/matcher.py`, `feature.py`)
- **Verdict:** `ok`, `ambiguous` (another place holds a real share, or the fit is only fair) or `no_match` (the best place does not fit).
- **Uncertainty:** the radius around the fix that holds 68 % and 95 % of the likelihood.
- **Dominant landmark:** the most prominent peak of the matched skyline formed by terrain at least 1 km away, with its distance and direction; it is named when a place in `data/output/places.geojson` lies within 2.5 km of it.

### Stage 8: Outputs (`frontend/`)
- **Locate screen & Jezero map (`/locate`, `/map`):** the fix with its 68 % / 95 % circles, the likelihood heat map, the camera's view wedge, the other candidate places and the dominant landmark.
- **Field HUD & Earth Control (`/field`, `/control`):** a photo fix is a mission event. On the field HUD it resets the position-uncertainty ring that grows while walking; Earth Control receives it after the 11 min 20 s one-way signal delay. Both screens stay in sync through the browser (`localStorage` + `BroadcastChannel`), no server needed.

---

## 3. What is measured (15 Nov)

- Simulated photos: verdicts calibrated; the 95 % circles are too small with several photos (hold 82–84 %).
- Real Perseverance photos: 16 of 24 poses not found yet; the skyline trace on near ridges is the main blocker.
- One request with one photo takes about 4–6 s on a laptop; the second coarse pass is the slowest part.
