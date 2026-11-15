# Backend — localization engine

Finds where an astronaut is standing in Jezero Crater from the skyline in their photos, by
matching it against the skyline the terrain would produce from candidate positions.

**Status:** the terrain layer, the horizon renderer, the precomputed horizons and the matcher are
built and tested. The matcher's verdicts are calibrated in simulation; on real photos it finds the
right place for about 9 of 24 rover poses and reports most of the rest as `ambiguous`. Measured
numbers and what is next: [`STATUS.md`](STATUS.md). The dominant-feature step and the HTTP server
(`POST /locate`, `GET /health`, plus the skyline step's `/skyline` routes) are built and tested.
The file formats are in [`CONTRACTS.md`](CONTRACTS.md) (a draft until the team agrees).

## Set up

You need Python 3.11 or newer.

```bash
cd backend
```

```bash
python -m venv .venv
```

Windows:

```bash
.venv\Scripts\python -m pip install -r requirements.txt
```

macOS, Linux:

```bash
.venv/bin/python -m pip install -r requirements.txt
```

**Terrain.** Elevation data is too big for git. The data team's terrain folder (`terrain.json`
plus the HiRISE 1 m, CTX 20 m and 200 m tiles, see `CONTRACTS.md` section 1) goes in
`backend/data_local/terrain/`. With only `jezero_ctx_dem_20m.tif` at
`backend/data_local/terrain/ctx_20m/` and no `terrain.json`, the engine runs on that one file. To
keep the terrain elsewhere, set the environment variable `MARS_TERRAIN_DIR` to that folder.
`data_local/` is git-ignored.

## Commands

Run them from `backend/`. On macOS and Linux use `.venv/bin/python` instead of `.venv\Scripts\python`.

| Command | What it does |
|---|---|
| `.venv\Scripts\python -m uvicorn marsloc.api:app --port 8000` | **The server.** The app reaches it at `NEXT_PUBLIC_ENGINE_URL` (default `http://localhost:8000`). It loads the terrain and the precomputed horizons at start (about 2 s). CORS allows `http://localhost:3000`; add the hosted site with the environment variable `MARS_CORS_ORIGINS` (comma-separated). Open `/health` to see whether it is ready |
| `.venv\Scripts\python -m pytest` | All tests. Tests that need the real DEM or the precomputed horizons are skipped when those are missing |
| `.venv\Scripts\python scripts\check_terrain.py` | Lists the terrain sources, and reports tile problems and height steps where sources join |
| `.venv\Scripts\python scripts\validate_sim.py --trials 300` | Locates simulated photos at random positions on the real terrain and reports errors, verdicts and whether the uncertainty circles hold. Table, per-trial JSON and an error map go to `reports/` (git-ignored). About 5 minutes with 8 workers |
| `.venv\Scripts\python scripts\build_horizons.py` | Precomputes the horizon of every candidate position (200 m grid over the CTX extent) into `cache/`: about 3 minutes and 66 MB. Rerun it whenever the terrain or its blend bands change |

## What is where

| Path | What it is |
|---|---|
| `CONTRACTS.md` | The three file formats: terrain input, skyline input, result |
| `marsloc/constants.py`, `marsloc/geo.py` | Mars radius, landing site; distances, bearings, the east/north frame, elevation angles with curvature |
| `marsloc/terrain/` | Height lookup from tiled grids at several resolutions: the finest source wins and is blended into the one beneath along its edge; tiles load on first use. The only code that knows about files |
| `marsloc/horizon/render.py` | The horizon the terrain produces from a position: elevation angle and source point per azimuth |
| `marsloc/horizon/store.py` | Precomputed horizons for a grid of candidate positions: build, quantize, load |
| `marsloc/match/` | The matcher: photo binning, scoring, coarse and fine search, likelihood map, verdict, sun heading |
| `marsloc/feature.py` | The dominant distant feature of a matched skyline: location, distance, and the distance cross-check with curvature |
| `marsloc/contracts.py`, `marsloc/engine.py` | The `POST /locate` body as checked models; request in, result in the contract's format out |
| `marsloc/api.py` | The HTTP server |
| `marsloc/simulate.py` | Simulated photos on the real terrain, for testing the matcher |
| `scripts/` | The commands above |
| `tests/` | pytest |
| `data_local/`, `cache/`, `.venv/` | Terrain, precomputed horizons, Python packages. All git-ignored |

`marsloc/horizon/` is named that way so it isn't confused with `backend/skyline/`, the photo → skyline
code. A *horizon* here is always computed from elevation data; a *skyline* is traced from a photo.

## Conventions

Degrees on the Mars 2000 sphere (R = 3 396 190 m), east-positive longitude. Azimuths and headings
are degrees clockwise from north. Elevation angles are degrees above the camera's local horizontal
and include Mars's curvature. Heights are metres above the Mars areoid. Details in
[`CONTRACTS.md`](CONTRACTS.md), section 0.
