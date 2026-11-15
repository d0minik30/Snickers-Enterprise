# Mars Map — Field HUD + Control view

A demo of navigation for a Mars traverse across an **11 min 20 s one-way signal delay**.
It has two screens that stay in sync across two browser windows, plus a standalone Jezero map:

- **Field** (`/field/`) — phone-sized HUD for the astronaut or rover: next move, map turned to face
  the direction of travel, position error, messages from Control.
- **Control** (`/control/`) — laptop-sized view for the planners on Earth: plan a route, send it,
  then watch the traverse with data that is always 11:20 old.
- **Jezero** (`/map/`) — interactive map of Mars that zooms into Jezero Crater and the Perseverance
  landing site, with toggleable **Slope** and **Sand** overlays from the data team's files in `../data/`.
- **Locate** (`/locate/`) — find where photos were taken from their skyline. Add photos (or take
  one in the app, which records the phone's tilt), choose the camera, fix the traced skyline by hand,
  then send it to the engine. Needs the engine server (below).

Field, Control and Jezero run entirely in the browser; map imagery loads live from NASA Mars Trek.
Locate talks to the engine server, which runs the skyline step (`../backend/skyline/`) and the engine.

## The engine server (Locate)

The site is still a static export; Locate calls the engine from the browser. Its address is fixed at
build time:

```bash
NEXT_PUBLIC_ENGINE_URL=https://engine.example.org npm run build
```

Default `http://localhost:8000`. The server must allow the site's address (CORS). Until the main
server exists, `py -3.10 ../backend/skyline/scripts/dev_server.py` serves the skyline part on port
8000; Locate then traces and edits skylines, and says plainly that the engine has no `/locate` yet.
The in-app camera needs a secure page: `https://`, or `localhost` on the same computer.

`/locate/?result=saved` shows a saved, real answer of the engine (six Perseverance Navcam photos from
sols 17–18), marked as saved, so the result view can be seen without the engine running. It is made by
`../backend/skyline/scripts/engine_result.py` (see `../backend/skyline/README.md`).

## Run it

You need Node.js 20 or newer.

```bash
npm install
```

```bash
npm run dev
```

Then open http://localhost:3000.

| Command | What it does |
|---|---|
| `npm run dev` | Dev server on port 3000 |
| `npm test` | Unit tests (Vitest) |
| `npm run typecheck` | TypeScript check |
| `npm run smoke` | End-to-end check in a real browser. Needs the dev server running and Edge or Chrome installed. On a machine with neither, set `BROWSER_PATH` to a Chromium binary. Screenshots land in `.smoke/`. |
| `npm run build` | Static site in `out/` |

## Hosting (Vercel or Netlify)

- Project folder: `frontend`
- Build command: `npm run build`
- Output folder: `out`

It is a static export, so any static host works.

## How to present the demo

1. Open **Control** in a wide window and **Field** in a narrow one, side by side.
2. In Control (Plan): pick astronaut or rover, pick a route (A is recommended), press
   **SEND ROUTE TO FIELD**. Point at "Arrives in 11:20".
3. Wait for the route to land in Field (about 23 s at 30× speed), then press **START TRAVERSE** in Field.
4. Back in Control (Live), point at:
   - the amber bar **FIELD DATA IS 11:20 OLD**,
   - the two markers on the map: **LAST RECEIVED** (solid) and **ESTIMATED NOW** (dashed),
   - the **signal timeline** at the bottom: every signal is a sloped line between Earth and Mars.
5. Send **HOLD**, then **PROCEED**, or type a message. Each one shows as in transit, then delivered.
   Tap the amber strip in Field to acknowledge a message; Control sees the acknowledgement 11:20 later.
6. Press **FLAG HAZARD ON MAP** and click on the route ahead. The new route is drawn dashed and marked
   "not yet at field" until the signal lands. Field keeps the old route until then.
   Late in the traverse Control says it is too late to reroute. That is on purpose.

**Demo controls** (top right in Control): speed 1× / 10× / 30× / 60×, pause, and reset.
All times on screen are mission times, so the numbers stay realistic at any speed.
Reset clears both windows.

If the venue has no internet, the map shows "MAP IMAGERY UNAVAILABLE" and the routes still work.

## Where to change things

| What | Where |
|---|---|
| Colours | `app/tokens.css` |
| Typeface | `app/layout.tsx` |
| Signal delay, walking and driving pace, clock speeds | `lib/mission/types.ts` |
| Control layout and type sizes | `components/control/control.module.css` |
| Field layout and type sizes | `components/field/field.module.css` |
| NASA map layers (Field, Control) | `lib/mars/tiles.ts` |
| Jezero map (Leaflet), overlays, legend | `components/jezero/` |
| Locate screen | `components/locate/`; logic in `lib/locate/` |
| Camera presets (keep in step with `backend/skyline/metadata.py`) | `lib/locate/presets.ts` |
| Engine address | `NEXT_PUBLIC_ENGINE_URL` at build time; `lib/locate/engine.ts` |

## Where the data comes from

Everything on screen comes from real data, except the simulated traveller and the few model numbers listed below.

| What | Source |
|---|---|
| Start and destination | `data/output/places.geojson`: the base (Perseverance landing site) and the Western Delta Deposit |
| Elevation, slope, sand | the data team's 40 m grids (`cost_grid.json`, `elevation_grid.bin`; MRO CTX Jezero DEM, USGS SIM 3464), cut to the demo area by `scripts/extract-terrain.mjs` on every `dev` and `build` |
| Hazard circles | found in the same grids: steep cores over 25° and deep pits (`terrain_features.geojson`) |
| Waypoint names | the ground under each waypoint: crater floor, steep ground, delta front, delta top, sand |
| Earth and Mars clocks | real UTC from the moment the mission starts; real local mean solar time at Jezero and Perseverance's sol (Mars24 algorithm, `lib/mission/marsTime.ts`) |
| Map imagery | live NASA Mars Trek tiles |
| Field readouts | elevation, slope underfoot and climb left, from the terrain grids |

**Model assumptions** (no real data exists for these; tune them in one place): walking and driving pace
(`lib/mission/types.ts`); the signal delay (11:20, a typical value); position drift between fixes, 2 % of
distance walked, and the accuracy of a photo fix, 15 m (`lib/planner/drift.ts`).

**Position fixes.** There is no GPS on Mars. Field's **PHOTO FIX** button stands for sending skyline photos to
the localization engine (`backend/marsloc`, the `/locate` screen): position error drops back to the fix's
accuracy and grows again with distance. Control's Plan view says how often a fix is needed to stay within ±25 m.

All terrain and route data reaches the app through one file, `lib/planner/index.ts`. To swap in other data,
replace what is behind it and keep the function names and types (`planRoutes`, `replan`, `spliceRoute`,
`elevationAt`, `slopeAt`, `positionErrorM`, `PRESET_HAZARDS`, `DEMO_BOUNDS`; types in `lib/planner/types.ts`).

## How it works, briefly

- Both windows share one append-only log of mission events, kept in `localStorage` and announced over
  `BroadcastChannel`, plus a shared mission clock (`lib/mission/store.ts`).
- Pure functions turn (log, time) into what each side may see. Field applies Control's events 11:20
  after they were sent (`lib/mission/field.ts`). Control sees Field as it was 11:20 ago
  (`lib/mission/control.ts`).
- A window opened or reloaded mid-mission rebuilds the same state from the stored log.

- Map labels sit on their own decluttered layer (`components/map/MarsMap.tsx`): two labels never overlap. When
  they would, the traveller and route labels win, then start and end, then hazards, then sand; hidden labels come
  back as you zoom in.

The design and build plan are in `docs/superpowers/`. What changed from the first demo, and why, is in
[`docs/CHANGES.md`](docs/CHANGES.md).

## Credits

Imagery: NASA / JPL-Caltech / USGS, via [NASA Mars Trek](https://trek.nasa.gov/mars/).
Sand: Sun & Stack (2020), USGS SIM 3464, https://doi.org/10.3133/sim3464. Slope: MRO CTX Jezero DEM (20 m).
Map libraries: [OpenLayers](https://openlayers.org/) (Field, Control), [Leaflet](https://leafletjs.com/) (Jezero).

## Map data

`npm run dev` and `npm run build` first run `scripts/copy-data.mjs`, which copies `../data/map_layers.json`
and every file in `../data/output/` into `public/data/` (git-ignored, emptied and refilled every time), so the
app can fetch them from `/data/...`. Never edit `../data/` from here; it belongs to the data team.

| File | Used by |
|---|---|
| `map_layers.json`, `slope.png`, `slope_bounds.json`, `sand.geojson` | Jezero map (fetched at run time) |
| `cost_grid.json`, `elevation_grid.json` + `.bin`, `places.geojson`, `terrain_features.geojson` | route planner, Control and Field maps, via `scripts/extract-terrain.mjs` |

**`scripts/extract-terrain.mjs`** runs after the copy (also on `dev` and `build`). It cuts the demo area (the base
to the Western Delta Deposit, `DEMO_BOUNDS` in `lib/planner/terrain.ts`) out of the 40 m grids and writes
`lib/planner/jezeroTerrain.json`: elevation, slope and sand per cell, the start and destination from
`places.geojson`, and the survey hazards it finds (steep cores over 25°, pits from `terrain_features.geojson`).
That file is committed, so `npm test` works without the data step. If the data team updates its outputs, run
`npm run dev` or `npm run build` once and commit the regenerated file.

**Validation run** (`/validate`): `backend/skyline/scripts/validate.py --app-copy frontend/public/validation.json`
saves a run where the screen fetches it. The screen loads it at run time, so the app still builds when no run
has been saved yet.

**Mars radius:** all coordinates are degrees on the Mars 2000 sphere, R = 3 396 190 m (the sphere the
data scripts and the cost grid's 40 m cells use). The frontend has one constant for it, `MARS_RADIUS_M`
in `lib/nav/geo.ts`, used for distances, the Leaflet CRS and the scale bar.
