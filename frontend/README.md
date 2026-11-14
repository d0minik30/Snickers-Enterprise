# Mars Map — Field HUD + Control view

A demo of navigation for a Mars traverse across an **11 min 20 s one-way signal delay**.
It has two screens that stay in sync across two browser windows, plus a standalone Jezero map:

- **Field** (`/field/`) — phone-sized HUD for the astronaut or rover: next move, map turned to face
  the direction of travel, position error, messages from Control.
- **Control** (`/control/`) — laptop-sized view for the planners on Earth: plan a route, send it,
  then watch the traverse with data that is always 11:20 old.
- **Jezero** (`/map/`) — interactive map of Mars that zooms into Jezero Crater and the Perseverance
  landing site, with toggleable **Slope** and **Sand** overlays from the data team's files in `../data/`.

Everything runs in the browser. There is no server. Map imagery loads live from NASA Mars Trek.

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

## How to plug in real data

Terrain is **real**: elevation, slope and sand for Jezero come from the data team's grids (`data/output/`), cut to the demo area by `scripts/extract-terrain.mjs` on every `dev` and `build`. Hazard circles are found in the same data (steep cores over 25° and deep pits). Waypoints are named from the ground under them (crater floor, steep ground, delta front, delta top, sand). Satellite passes are still **made up** for the demo. They all sit behind one
file: `lib/planner/index.ts`. The rest of the app imports only from there.

To use real data, replace what is behind that file and keep the function names and types the same
(`planRoutes`, `replan`, `spliceRoute`, `elevationAt`, `satellitePasses`, `positionErrorM`,
`PRESET_HAZARDS`, `DEMO_BOUNDS` and so on; the types are in `lib/planner/types.ts`).
`lib/planner/planner.test.ts` says what the app expects from them.

## How it works, briefly

- Both windows share one append-only log of mission events, kept in `localStorage` and announced over
  `BroadcastChannel`, plus a shared mission clock (`lib/mission/store.ts`).
- Pure functions turn (log, time) into what each side may see. Field applies Control's events 11:20
  after they were sent (`lib/mission/field.ts`). Control sees Field as it was 11:20 ago
  (`lib/mission/control.ts`).
- A window opened or reloaded mid-mission rebuilds the same state from the stored log.

The design and build plan are in `docs/superpowers/`.

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
| `map_layers.json`, `slope.png`, `slope_bounds.json`, `sand.geojson` | Jezero map |
| `places.geojson`, `cost_grid.json` | not yet (planned: real places and route finding) |

**Mars radius:** all coordinates are degrees on the Mars 2000 sphere, R = 3 396 190 m (the sphere the
data scripts and the cost grid's 40 m cells use). The frontend has one constant for it, `MARS_RADIUS_M`
in `lib/nav/geo.ts`, used for distances, the Leaflet CRS and the scale bar.
