# Changes: from a mock demo to real data

The first version of the Field and Control screens ran on made-up terrain, hazards, places, clocks and
satellite passes. This page records what replaced each one, and the few model numbers that remain.

## Real data now in use

| Was | Now | Where |
|---|---|---|
| Terrain from a formula of sines | Elevation, slope and sand from the data team's 40 m grids (MRO CTX Jezero DEM, USGS SIM 3464) | `scripts/extract-terrain.mjs` → `lib/planner/jezeroTerrain.json`, read by `lib/planner/terrain.ts` |
| Five invented hazard circles ("Dune field", "Crater rim"…) | Steep cores over 25° and pits from `terrain_features.geojson`, found by the extract script | `PRESET_HAZARDS`, `lib/planner/routes.ts` |
| A made-up end point 3.6 km away | The Western Delta Deposit from `places.geojson` (about 6 km by route); the start is the Perseverance landing site | `DEFAULT_START`, `DEFAULT_END`, `DESTINATION` |
| A fixed list of waypoint names | Named from the ground under each waypoint: crater floor, steep ground, delta front, delta top, sand | `groundName`, `lib/planner/routes.ts` |
| Clocks starting at 14:01 UTC, Sol 1284 | Real UTC from the moment the mission starts; real local mean solar time at Jezero and Perseverance's sol (Mars24) | `lib/mission/marsTime.ts`, `setClockEpoch` in `components/control/controlModel.ts` |
| "TRAVERSE 07 · JEZERO WEST" | "BASE → WESTERN DELTA DEPOSIT", or "CHOSEN POINT" if the planner moved the end | `components/control/TopBar.tsx` |
| A made-up satellite pass schedule that reset position error | **Photo fixes**: Field's PHOTO FIX button stands for skyline photos matched by the localization engine | `photo-fix` event (`lib/mission/types.ts`), `lib/mission/field.ts` |
| Suit O₂, suit power and rover battery bars with invented drain rates | Elevation, slope underfoot (amber above 12°) and climb left, from the terrain | `fieldCells`, `fieldBars`, `components/field/fieldModel.ts` |
| Sand not shown on Control or Field | Real sand patches drawn on all three maps | `sandAreas` (`lib/planner/terrain.ts`), `sandOverlays` (`components/map/overlays.ts`) |
| `/map` slope overlay painting the whole floor green | Only 10–25° and over 25° areas are shaded; the published `slope.png` is unchanged | `steepOnly`, `components/jezero/mapData.ts` |

Checks against known facts, in the tests: the landing site reads −2,567 m (`places.geojson` gives −2,567.2 m);
Perseverance's touchdown comes out at about 15:53 local mean solar time on sol 0, as NASA reports.

## Model numbers that remain (no real data exists)

Kept in one place each, so the team can tune them:

- Walking pace 3.9 km/h, rover 4.3 km/h — `lib/mission/types.ts`
- Signal delay 11 min 20 s (a typical value; the real range is about 4–22 min) — `lib/mission/types.ts`
- Position drift between fixes, 2 % of distance walked; error at the base 1 m; error after a photo fix 15 m
  (the engine's fine search works down to 12.5 m steps) — `lib/planner/drift.ts`
- The crew aims to stay within ±25 m, so a photo fix is due every 500 m — `FIX_TARGET_M` in `components/control/controlModel.ts`

The traveller walking the route is simulated; that is the demo.

## Route planning on real terrain

- The A* search costs real slope, with steep cells (over 12°) costing quadratically more, and real sand
  (×4 on the safest route, ×1.5 on the flattest, ignored on the shortest).
- **Flattest** finds the lowest slope limit that still connects start and end (a breadth-first search over the
  grid) and plans under it, so it really is the flattest by its steepest spot. On the default traverse:
  safest 6.19 km, steepest 14°; shortest 6.04 km, 30° (it climbs a steep core onto the delta); flattest 8.89 km, 10°.
- Sand on a route, or a slope over 12°, makes it medium risk; entering a hazard makes it high risk.

## Interface

- One navigation row for every screen (`components/shared/SiteNav.tsx`, list in `components/shared/views.ts`).
- A landing page that explains the project, links each screen with where to open it, gives a six-step
  presenting script and lists the data sources.
- Map labels on Control and Field sit on a decluttered layer, so they never overlap; priority in
  `labelPriority`, `components/map/MarsMap.tsx`.
- Field: a large PHOTO FIX button; the FIX ACQUIRED cue sits over its own label, never over the number.

## Fixes

- `/validate` imported a file that only exists after `validate.py` has been run, which broke `npm run build`
  for everyone. It now fetches `frontend/public/validation.json` at run time and says so when there is none.
