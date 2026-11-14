# Backend — localization engine

Finds where an astronaut is standing in Jezero Crater from the skyline in their photos, by
matching it against the skyline the terrain would produce from candidate positions.

**Status:** the terrain layer, the horizon renderer and the precomputed horizons are built and
tested. The matcher, the dominant-feature step, the HTTP API and the validation report are not
built yet. The file formats are in [`CONTRACTS.md`](CONTRACTS.md) (a draft until the team agrees).

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

**Terrain.** Elevation data is too big for git. Get `jezero_ctx_dem_20m.tif` ("MRO CTX, Jezero
DEM, Controlled", from NASA Mars Trek) from the data team and put it at
`backend/data_local/terrain/ctx_20m/jezero_ctx_dem_20m.tif`. To keep the terrain elsewhere, set the
environment variable `MARS_TERRAIN_DIR` to that folder. `data_local/` is git-ignored.

## Commands

Run them from `backend/`. On macOS and Linux use `.venv/bin/python` instead of `.venv\Scripts\python`.

| Command | What it does |
|---|---|
| `.venv\Scripts\python -m pytest` | All tests. Tests that need the real DEM or the precomputed horizons are skipped when those are missing |
| `.venv\Scripts\python scripts\check_terrain.py` | Lists the terrain sources, and reports tile problems and height steps where sources join |
| `.venv\Scripts\python scripts\build_horizons.py` | Precomputes the horizon of every candidate position (200 m grid) into `cache/`. Rerun it whenever the terrain changes |

## What is where

| Path | What it is |
|---|---|
| `CONTRACTS.md` | The three file formats: terrain input, skyline input, result |
| `marsloc/constants.py`, `marsloc/geo.py` | Mars radius, landing site; distances, bearings, the east/north frame, elevation angles with curvature |
| `marsloc/terrain/` | Height lookup from tiled grids at several resolutions: the finest source wins, tiles load on first use. The only code that knows about files |
| `marsloc/horizon/render.py` | The horizon the terrain produces from a position: elevation angle and source point per azimuth |
| `marsloc/horizon/store.py` | Precomputed horizons for a grid of candidate positions: build, quantize, load |
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
