# Mars Map Field HUD + Control View Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the plain HTML map in `frontend/` with a Next.js demo that has a phone-sized Field HUD (`/field`) and a laptop-sized Control view (`/control`) which stay in sync across two browser windows, with the Earth-Mars signal delay visible.

**Architecture:** Both windows hold the same append-only log of mission events (in `localStorage`, announced over `BroadcastChannel`) plus a shared mission clock. Pure functions turn (log, mission time) into what each side may see: Field applies Control's events 11 min 20 s after they were sent, Control sees Field as it was 11 min 20 s ago. Routes come from a small A* route-finder on made-up terrain behind `lib/planner/index.ts`, the only part the data team later replaces. The map is OpenLayers on live NASA Mars Trek tiles.

**Tech Stack:** Next.js 16 (App Router, TypeScript, static export), React 19, OpenLayers 10 (`ol`), CSS Modules, Vitest 5, playwright-core (smoke test only, driving the installed Edge or Chrome).

**Spec:** `frontend/docs/superpowers/specs/2026-11-14-mars-nav-field-control-design.md`. Approved mockups (layout and style reference, set in an earlier typeface): `nasa hackathon/.superpowers/brainstorm/2023-1794664748/content/field-look-v2.html` (option B) and `control-layout-v2.html`.

## Global Constraints

- Create, change or delete files **only inside `Snickers-Enterprise/frontend/`**. All commands run from that folder.
- **No git commits, no branch changes.** The team handles git. There are no commit steps in this plan.
- No raster images and no `.geojson` files (the repo `.gitignore` blocks them). Icons are inline SVG; mock data lives in `.ts` files.
- Static export only: `output: 'export'`, no API routes, no server code.
- Hand-written CSS (CSS Modules + tokens in `app/tokens.css`). No Tailwind, no component library.
- Visual language "Instrument": square corners, 1 px rules, no blur, no shadows, no gradients. Colour tokens, exact: surface `#0A0A0B`, rule `#34343A`, text `#FFFFFF`, muted `#8D8D96`, route `#FF5CE1`, caution `#FFB000`, nominal `#5BE37D`, danger `#FF5A4F`.
- Typeface: Barlow Condensed, weights 500, 600, 700, for everything. Changing numbers must not make the layout jiggle.
- One-way signal delay `SIGNAL_DELAY_MS = 680_000` (11 min 20 s). Mission clock rates 1×, 10×, 30×, 60×; default 30×. Every time shown on screen is mission time.
- Control never shows field data as current: anything from Field is shown only once `sent + delay <= now`.
- Map tiles load live from NASA Mars Trek; none are stored in the repo.
- Motion is restrained and switched off under `prefers-reduced-motion: reduce`.
- Package floors: `next ^16.4`, `react ^19.3`, `ol ^10.11`, `vitest ^5.1`. Use the newest TypeScript that `next build` accepts (fall back to `typescript@5` if 7 is rejected).

## Review Focus

Conditions the spec implies but does not spell out, most likely first. Each has a test in the task named.

1. **A window is opened or reloaded mid-mission.** It must show the correct current state from the stored log, not "awaiting route". (Task 5, store reload test.)
2. **NASA tiles do not load (venue offline).** A message strip appears and routes and markers still draw. (Task 6, tile-health test; Task 10 smoke check.)
3. **Start or end is clicked inside a hazard, or start and end are almost the same point.** Planning returns routes or an empty list with a reason on screen; it never throws or hangs. (Task 3.)
4. **A hazard is flagged when the traveller is about to arrive.** Control says it is too late to reroute instead of sending a broken route. (Task 4, `predictBranchDistM` / `canReroute` test.)
5. **`localStorage` holds broken or old-format data.** The app starts a fresh mission instead of crashing. (Task 5.)

## File Structure

```
frontend/
  package.json  next.config.ts  tsconfig.json  vitest.config.ts  .gitignore  README.md
  app/
    layout.tsx  tokens.css  globals.css  icon.svg
    page.tsx  page.module.css                      landing: explains the two windows, links to both
    field/page.tsx      control/page.tsx
  lib/
    nav/geo.ts  nav/format.ts  nav/instructions.ts  distances, bearings, text, next-move logic
    planner/types.ts                                Route, Waypoint, Hazard, SatellitePass
    planner/terrain.ts  planner/astar.ts  planner/routes.ts  planner/passes.ts
    planner/index.ts                                THE SWAPPABLE INTERFACE (re-exports only)
    mission/types.ts  mission/clock.ts  mission/field.ts  mission/control.ts
    mission/store.ts  mission/useMission.ts
    mars/tiles.ts  mars/tileHealth.ts               NASA tile grid, layer list, failure counter
    testing/fixtures.ts                             shared test helpers
  components/
    map/MarsMap.tsx  map/overlays.ts  map/styles.ts  map/MarsMap.module.css
    shared/Readout.tsx  shared/Bar.tsx  shared/TurnArrow.tsx  shared/shared.module.css
    field/FieldScreen.tsx  field/fieldModel.ts  field/NextMoveBand.tsx  field/MessageStrip.tsx
    field/ReadoutBand.tsx  field/StatusPanel.tsx  field/field.module.css
    control/ControlScreen.tsx  control/TopBar.tsx  control/usePlanDraft.ts
    control/PlanRail.tsx  control/PlanDetailRail.tsx  control/ElevationProfile.tsx
    control/LiveRail.tsx  control/CommsRail.tsx  control/SignalTimeline.tsx
    control/timelineModel.ts  control/controlModel.ts  control/control.module.css
  scripts/smoke.mjs                                 end-to-end demo check in a real browser
```

Tests sit next to the file they test as `*.test.ts`.

---

### Task 1: Scaffold the Next.js app

**Files:**
- Delete: `app.js`, `index.html`, `style.css`
- Create: `package.json`, `next.config.ts`, `tsconfig.json`, `vitest.config.ts`, `.gitignore`, `app/layout.tsx`, `app/tokens.css`, `app/globals.css`, `app/icon.svg`, `app/page.tsx`, `app/page.module.css`, `app/field/page.tsx`, `app/control/page.tsx`, `lib/smoke.test.ts`

**Interfaces:**
- Produces: `npm run dev` (port 3000), `npm run build` (static site in `out/`), `npm test` (`vitest run`), `npm run typecheck` (`tsc --noEmit`); import alias `@/*` → `frontend/*`; CSS custom properties `--surface --rule --text --muted --route --caution --nominal --danger --font-barlow`.

- [ ] **Step 1:** Before deleting, copy the NASA layer ids, bounds and zoom limits out of `app.js` lines 19-45 into your notes for Task 6 (they are also repeated there). Delete the three old files.
- [ ] **Step 2:** Write `package.json` (name `mars-map`, private, scripts above) and install: `npm install next react react-dom ol` and `npm install -D typescript @types/node @types/react @types/react-dom vitest`.
- [ ] **Step 3:** Write `next.config.ts` with `output: 'export'`, `trailingSlash: true`, `images: { unoptimized: true }`. Write `tsconfig.json` with `strict: true` and `paths: { "@/*": ["./*"] }`. Write `vitest.config.ts` with `environment: 'node'`, `include: ['**/*.test.ts']`, and the same `@` alias. Write `.gitignore` with `node_modules/`, `.next/`, `out/`, `next-env.d.ts`, `*.tsbuildinfo`, `.smoke/`.
- [ ] **Step 4:** `app/tokens.css`: the eight colour tokens from Global Constraints, exact values. `app/layout.tsx`: load `Barlow_Condensed` from `next/font/google` (weights 500, 600, 700, `variable: '--font-barlow'`), set it on `<html>`, metadata title "Mars Map", viewport `width=device-width, initial-scale=1, viewport-fit=cover`, theme colour `#0A0A0B`. `app/globals.css`: reset, `body` on `--surface` in `--text`, `font-variant-numeric: tabular-nums`, a `prefers-reduced-motion` rule that removes animations and transitions. `app/icon.svg`: a magenta diamond on near-black.
- [ ] **Step 5:** `app/page.tsx`: landing page in the Instrument look. Title "MARS MAP", one sentence on what it is, two large link cells "FIELD" (`/field/`, "Open in a narrow window") and "CONTROL" (`/control/`, "Open in a wide window"), and a three-line "How to present" note (open both, plan and send in Control, press Start in Field). `app/field/page.tsx` and `app/control/page.tsx`: placeholder headings for now.
- [ ] **Step 6:** `lib/smoke.test.ts` with one test `expect(1 + 1).toBe(2)` so the test runner is proven.
- [ ] **Step 7: Verify.** Run `npm test` → 1 passed. Run `npm run typecheck` → no errors. Run `npm run build` → "Exporting" completes and `out/index.html`, `out/field/index.html`, `out/control/index.html` exist. Then delete `lib/smoke.test.ts`.

---

### Task 2: Distances, formatting and next-move logic (`lib/nav`)

**Files:**
- Create: `lib/planner/types.ts`, `lib/nav/geo.ts`, `lib/nav/format.ts`, `lib/nav/instructions.ts`, `lib/testing/fixtures.ts`
- Test: `lib/nav/geo.test.ts`, `lib/nav/format.test.ts`, `lib/nav/instructions.test.ts`

**Interfaces:**
- Produces, `lib/planner/types.ts`:
  ```ts
  export type LatLon = { lat: number; lon: number };            // degrees, lon -180..180, east positive
  export type RouteProfile = 'safest' | 'shortest' | 'flattest';
  export type Risk = 'low' | 'medium' | 'high';
  export type Hazard = { id: string; center: LatLon; radiusM: number; label: string; source: 'survey' | 'control' };
  export type Waypoint = { name: string; distM: number; pos: LatLon };   // distM = distance along the route
  export type Route = { id: string; profile: RouteProfile; points: LatLon[]; elevationM: number[];
                        waypoints: Waypoint[]; lengthM: number; maxSlopeDeg: number; risk: Risk };
  export type SatellitePass = { satellite: string; tMs: number; quality: 'overhead' | 'low' };
  ```
  The last waypoint of every route is named `'End'` with `distM === lengthM`.
- Produces, `lib/nav/geo.ts`: `MARS_RADIUS_M = 3389500`; `distanceM(a, b): number` (haversine); `bearingDeg(a, b): number` (0..360, 0 = north, clockwise); `destination(from, bearingDeg, distM): LatLon`; `cumulativeM(points): number[]` (starts at 0); `pointAlong(points, distM): { pos: LatLon; bearingDeg: number }` (clamped to the ends); `slicePath(points, fromM, toM): LatLon[]` (exact interpolated end points).
- Produces, `lib/nav/format.ts`: `formatDistance(m)` → `{ value: string; unit: 'm' | 'km' }` (below 1000 m: whole metres; else km with 2 decimals); `formatClock(ms)` → `'MM:SS'` below one hour, `'H:MM:SS'` above; `formatLat(lat)` → `'18.4446° N'`; `formatLon(lon)` → `'77.4509° E'` using 0-360° east (so -133.8 → `'226.2000° E'`).
- Produces, `lib/nav/instructions.ts`: `type Maneuver = 'continue' | 'bear-left' | 'bear-right' | 'turn-left' | 'turn-right' | 'arrive'`; `type NextMove = { maneuver: Maneuver; distanceM: number; waypointIndex: number; waypointName: string }`; `classifyTurn(deltaDeg: number): Maneuver`; `nextMove(route: Route, distAlongM: number): NextMove`; `MANEUVER_TEXT: Record<Maneuver, string>` = `Continue`, `Bear left`, `Bear right`, `Turn left`, `Turn right`, `Arrive`.
- Produces, `lib/testing/fixtures.ts`: `ORIGIN: LatLon = { lat: 18.4446, lon: 77.4509 }`; `straightRoute(lengthM = 2000, stepM = 500, bearing = 0): Route` (waypoints `'WP 1'…` every 500 m, last `'End'`); `cornerRoute(): Route` (300 m north then 300 m west from `ORIGIN`, points every 10 m, one waypoint `'End'`).

- [ ] **Step 1: Write the failing tests**

```ts
// geo.test.ts
it('measures one degree of latitude on Mars', () =>
  expect(distanceM({ lat: 0, lon: 0 }, { lat: 1, lon: 0 })).toBeCloseTo(59157.9, 0));
it('bearing is 0 north, 90 east, 270 west', () => {
  expect(bearingDeg(ORIGIN, destination(ORIGIN, 0, 100))).toBeCloseTo(0, 1);
  expect(bearingDeg(ORIGIN, destination(ORIGIN, 90, 100))).toBeCloseTo(90, 1);
  expect(bearingDeg(ORIGIN, destination(ORIGIN, 270, 100))).toBeCloseTo(270, 1);
});
it('destination then distance round-trips', () =>
  expect(distanceM(ORIGIN, destination(ORIGIN, 37, 1234))).toBeCloseTo(1234, 1));
it('pointAlong interpolates and clamps', () => {
  const r = straightRoute(2000);
  expect(distanceM(ORIGIN, pointAlong(r.points, 750).pos)).toBeCloseTo(750, 0);
  expect(distanceM(ORIGIN, pointAlong(r.points, 9999).pos)).toBeCloseTo(2000, 0);
  expect(pointAlong(r.points, -5).pos).toEqual(r.points[0]);
});
it('slicePath keeps exact ends', () => {
  const s = slicePath(straightRoute(2000).points, 250, 1250);
  expect(cumulativeM(s).at(-1)).toBeCloseTo(1000, 0);
});

// format.test.ts
expect(formatDistance(140.4)).toEqual({ value: '140', unit: 'm' });
expect(formatDistance(1840)).toEqual({ value: '1.84', unit: 'km' });
expect(formatClock(252_000)).toBe('04:12');
expect(formatClock(680_000)).toBe('11:20');
expect(formatClock(3_725_000)).toBe('1:02:05');
expect(formatLat(18.4446)).toBe('18.4446° N');
expect(formatLat(-4.5895)).toBe('4.5895° S');
expect(formatLon(-133.8)).toBe('226.2000° E');

// instructions.test.ts
expect(classifyTurn(4)).toBe('continue');
expect(classifyTurn(-30)).toBe('bear-left');
expect(classifyTurn(30)).toBe('bear-right');
expect(classifyTurn(-90)).toBe('turn-left');
expect(classifyTurn(75)).toBe('turn-right');
it('announces the corner ahead', () => {
  const m = nextMove(cornerRoute(), 100);
  expect(m.maneuver).toBe('turn-left');
  expect(Math.abs(m.distanceM - 200)).toBeLessThan(25);
});
it('says continue to the next waypoint on a straight leg', () => {
  const m = nextMove(straightRoute(2000), 100);
  expect(m).toMatchObject({ maneuver: 'continue', waypointIndex: 0, waypointName: 'WP 1' });
  expect(m.distanceM).toBeCloseTo(400, 0);
});
it('says arrive on the last leg', () => {
  const m = nextMove(straightRoute(2000), 1700);
  expect(m).toMatchObject({ maneuver: 'arrive', waypointName: 'End' });
  expect(m.distanceM).toBeCloseTo(300, 0);
});
```

- [ ] **Step 2:** Run `npm test` → the three files fail (modules not found).
- [ ] **Step 3:** Implement the types, `geo.ts`, `format.ts` and the fixtures.
- [ ] **Step 4:** Implement `instructions.ts`. `classifyTurn`: `|Δ| < 15` → continue; `15..60` → bear; `> 60` → turn; negative Δ is left. Routes are smoothed, so a bend is spread over many small angles; `nextMove` therefore compares headings across a window:

```ts
const WINDOW_M = 40, STEP_M = 10;
// wp = first waypoint with distM > d. Scan s = d, d+10, ... while s + WINDOW_M <= wp.distM:
//   delta(s) = signed smallest angle from bearing at s to bearing at s + WINDOW_M
//   first s0 with |delta(s0)| >= 15: take the delta with the largest magnitude over s in [s0, s0 + WINDOW_M],
//   return { maneuver: classifyTurn(thatDelta), distanceM: s0 + WINDOW_M / 2 - d, ...wp }
// nothing found: wp is the last waypoint ? 'arrive' : 'continue', distanceM = wp.distM - d
```

- [ ] **Step 5:** Run `npm test` → all pass. Run `npm run typecheck` → clean.

---

### Task 3: Mock planner (`lib/planner`), the swappable part

**Files:**
- Create: `lib/planner/terrain.ts`, `lib/planner/astar.ts`, `lib/planner/routes.ts`, `lib/planner/passes.ts`, `lib/planner/index.ts`
- Test: `lib/planner/planner.test.ts`

**Interfaces:**
- Consumes: Task 2 types and `lib/nav/geo.ts`.
- Why the demo area is this big: in the 22 min 40 s it takes Control to see something and get a new route back, an astronaut walks about 1.5 km. A reroute can only change what lies beyond that, so default routes are about 4 km long.
- Produces (everything is imported by the rest of the app **only** through `lib/planner/index.ts`):
  ```ts
  export const DEMO_BOUNDS = { south: 18.415, west: 77.380, north: 18.500, east: 77.480 };   // about 5.0 x 5.6 km
  export const DEFAULT_START: LatLon = { lat: 18.4446, lon: 77.4509 };                       // Perseverance landing site
  export const DEFAULT_END: LatLon   = { lat: 18.4890, lon: 77.4080 };                       // about 3.56 km away in a straight line
  export const MIN_ROUTE_M = 40;
  export const FLAG_RADIUS_M = 60;
  export const PRESET_HAZARDS: Hazard[];   // source 'survey'; must include
     // { id: 'dune-1', center: { lat: 18.4668, lon: 77.4295 }, radiusM: 150, label: 'Dune field' }  (on the straight line)
     // plus three or four more inside DEMO_BOUNDS, none within 200 m of DEFAULT_START or DEFAULT_END
  export function elevationAt(p: LatLon): number;                         // metres, deterministic, about -2540..-2490
  export function planRoutes(start: LatLon, end: LatLon, hazards: Hazard[]): Route[];
     // [] if start and end are closer than MIN_ROUTE_M; otherwise exactly [safest, shortest, flattest]
  export function replan(from: LatLon, end: LatLon, hazards: Hazard[], profile: RouteProfile): Route | null;
  export function spliceRoute(old: Route, branchDistM: number, tail: Route): Route;
     // old's path up to branchDistM, then tail (whose first point is that same position)
  export function satellitePasses(): SatellitePass[];                     // sorted by tMs
  export function positionErrorM(distSinceFixM: number): number;          // 1 + 0.02 * distSinceFixM
  export function isInsideHazard(p: LatLon, h: Hazard): boolean;
  ```

- [ ] **Step 1: Write the failing tests** (`planner.test.ts`)

```ts
const routes = planRoutes(DEFAULT_START, DEFAULT_END, PRESET_HAZARDS);
const [safest, shortest, flattest] = routes;
const enters = (r: Route, hs: Hazard[]) => r.points.some(p => hs.some(h => isInsideHazard(p, h)));

it('returns safest, shortest, flattest in that order', () =>
  expect(routes.map(r => r.profile)).toEqual(['safest', 'shortest', 'flattest']));
it('every route starts and ends exactly on the requested points', () => routes.forEach(r => {
  expect(r.points[0]).toEqual(DEFAULT_START); expect(r.points.at(-1)).toEqual(DEFAULT_END);
  expect(r.elevationM).toHaveLength(r.points.length);
  expect(r.waypoints.at(-1)).toMatchObject({ name: 'End' });
  expect(r.waypoints.at(-1)!.distM).toBeCloseTo(r.lengthM, 0);
  expect(r.waypoints.length).toBeGreaterThanOrEqual(3); expect(r.waypoints.length).toBeLessThanOrEqual(7);
}));
it('shortest is the shortest and crosses the dune field', () => {
  expect(shortest.lengthM).toBeLessThanOrEqual(safest.lengthM);
  expect(shortest.lengthM).toBeLessThanOrEqual(flattest.lengthM);
  expect(shortest.risk).toBe('high');
});
it('safest avoids every hazard and is not high risk', () => {
  expect(enters(safest, PRESET_HAZARDS)).toBe(false); expect(safest.risk).not.toBe('high');
});
it('flattest is no steeper than shortest', () =>
  expect(flattest.maxSlopeDeg).toBeLessThanOrEqual(shortest.maxSlopeDeg));
it('slopes are believable', () => routes.forEach(r => {
  expect(r.maxSlopeDeg).toBeGreaterThan(0); expect(r.maxSlopeDeg).toBeLessThan(30); }));
it('all three avoid a hazard flagged by Control', () => {
  const flagged: Hazard = { id: 'c1', center: pointAlong(shortest.points, shortest.lengthM / 3).pos,
                            radiusM: FLAG_RADIUS_M, label: 'Flagged', source: 'control' };
  planRoutes(DEFAULT_START, DEFAULT_END, [...PRESET_HAZARDS, flagged])
    .forEach(r => expect(enters(r, [flagged])).toBe(false));
});
it('is deterministic', () =>
  expect(planRoutes(DEFAULT_START, DEFAULT_END, PRESET_HAZARDS)).toEqual(routes));
it('still plans when the start is inside a hazard', () => {       // Review Focus 3
  const r = planRoutes(PRESET_HAZARDS[0].center, DEFAULT_END, PRESET_HAZARDS);
  expect(r).toHaveLength(3); r.forEach(x => expect(x.points.length).toBeGreaterThanOrEqual(2));
});
it('returns no routes when start and end are almost the same point', () =>   // Review Focus 3
  expect(planRoutes(DEFAULT_START, destination(DEFAULT_START, 90, 20), PRESET_HAZARDS)).toEqual([]));
it('plans the default pair quickly', () => {
  const t = performance.now(); planRoutes(DEFAULT_START, DEFAULT_END, PRESET_HAZARDS);
  expect(performance.now() - t).toBeLessThan(1500);
});
it('spliceRoute keeps the walked part and joins the tail', () => {
  const old = straightRoute(2000);
  const at = pointAlong(old.points, 1000).pos;
  const tailPts = [at, destination(at, 90, 250), destination(at, 90, 500)];
  const tail: Route = { ...old, id: 't', points: tailPts, elevationM: [0, 0, 0], lengthM: 500,
                        waypoints: [{ name: 'End', distM: 500, pos: tailPts[2] }] };
  const s = spliceRoute(old, 1000, tail);
  expect(s.lengthM).toBeCloseTo(1500, 0);
  expect(pointAlong(s.points, 400).pos.lat).toBeCloseTo(pointAlong(old.points, 400).pos.lat, 6);
  expect(s.waypoints.map(w => w.name)).toEqual(['WP 1', 'End']);   // WP 1 at 500 m kept, later ones replaced
  expect(s.waypoints.at(-1)!.distM).toBeCloseTo(1500, 0);
});
it('position error grows 2 % of distance from a 1 m base', () => {
  expect(positionErrorM(0)).toBe(1); expect(positionErrorM(250)).toBeCloseTo(6, 5);
});
it('satellite passes are sorted and irregular', () => {
  const p = satellitePasses(); expect(p.length).toBeGreaterThanOrEqual(10);
  expect(p[0].tMs).toBe(6 * 60_000);
  expect([...p].sort((a, b) => a.tMs - b.tMs)).toEqual(p);
});
```

- [ ] **Step 2:** Run `npm test` → `planner.test.ts` fails (module not found).
- [ ] **Step 3:** `terrain.ts`: `elevationAt` as a fixed sum of sines over metres east/north of `DEMO_BOUNDS`' south-west corner (a regional tilt plus two or three wave terms, no randomness), tuned so slopes between neighbouring 20 m cells peak around 15-20°.
- [ ] **Step 4:** `astar.ts`: 8-neighbour A* over a 20 m grid covering `DEMO_BOUNDS`. Step cost = `stepLengthM * (1 + slopeWeight * slopeDeg / 10) * hazardFactor`, where `hazardFactor` is 50 inside an avoided hazard and 1 otherwise. Using a large factor instead of a wall guarantees a path always exists.
- [ ] **Step 5:** `routes.ts`: `planRoutes` and `replan` run A* with these weightings, then simplify the cell path (Douglas-Peucker, 15 m), smooth it (Chaikin, 2 passes), and force the first and last points to the exact requested positions.

  | profile | slopeWeight | avoids `survey` hazards | avoids `control` hazards | margin added to hazard radius |
  |---|---|---|---|---|
  | safest | 1.5 | yes | yes | 30 m |
  | shortest | 0 | no | yes | 10 m |
  | flattest | 6 | yes | yes | 10 m |

  `risk`: `'high'` if any point is inside any hazard, else `'medium'` if `maxSlopeDeg > 12`, else `'low'`. Waypoints: `clamp(round(lengthM / 500), 2, 6)` evenly spaced interior waypoints named from a fixed list (`Landing flats`, `South ridge`, `Boulder gap`, `Delta scarp`, `Sand ripples`, `North terrace`), then `'End'`. Route `id` is `profile + ':' + a hash of the rounded start, end and hazard ids`, so equal inputs give equal ids.
- [ ] **Step 6:** `passes.ts`: passes at mission minutes `6, 19, 31, 47, 58, 76, 95, 121, 138, 160, 171, 190`, satellites cycling `MRO`, `MAVEN`, `TGO`, quality `'low'` for every `MAVEN` pass and `'overhead'` otherwise. `index.ts` re-exports the public names above and nothing else.
- [ ] **Step 7:** Run `npm test` → all pass. Run `npm run typecheck` → clean.

---

### Task 4: Mission logic with the signal delay (`lib/mission`)

**Files:**
- Create: `lib/mission/types.ts`, `lib/mission/clock.ts`, `lib/mission/field.ts`, `lib/mission/control.ts`
- Modify: `lib/testing/fixtures.ts` — add `divertedRoute(old: Route, branchDistM: number): Route`, which is `spliceRoute(old, branchDistM, tail)` with a two-point tail running 400 m due east from the branch position (one waypoint `'End'`)
- Test: `lib/mission/clock.test.ts`, `lib/mission/field.test.ts`, `lib/mission/control.test.ts`

**Interfaces:**
- Consumes: Task 2 and `positionErrorM`, `satellitePasses` from `@/lib/planner`.
- Produces, `types.ts`:
  ```ts
  export type TravellerKind = 'astronaut' | 'rover';
  export const SIGNAL_DELAY_MS = 680_000;
  export const PACE_MPS: Record<TravellerKind, number> = { astronaut: 3.9 / 3.6, rover: 1.2 };   // 3.9 km/h on foot, 4.3 km/h driving
  export const RATES = [1, 10, 30, 60] as const;  export const DEFAULT_RATE = 30;
  type Base = { id: string; tMs: number };                    // tMs = mission time the event was SENT
  export type MissionEvent =
    | (Base & { type: 'route-sent';    origin: 'control'; traveller: TravellerKind; route: Route; hazards: Hazard[] })
    | (Base & { type: 'route-changed'; origin: 'control'; route: Route; hazards: Hazard[]; reason: 'hazard' | 'replan' })
    | (Base & { type: 'message';       origin: 'control'; text: string; order?: 'hold' | 'proceed' })
    | (Base & { type: 'ack';              origin: 'field'; targetId: string })
    | (Base & { type: 'traverse-started'; origin: 'field' });
  ```
  A `route-changed` route is always the **full spliced route** (`spliceRoute` output), so it shares its beginning with the route before it and the traveller's distance along the route carries over unchanged.
- Produces, `clock.ts`: `type ClockState = { anchorRealMs: number; anchorMissionMs: number; rate: number; paused: boolean; rev: number }`; `newClock(realNowMs): ClockState` (mission 0, `DEFAULT_RATE`, running, rev 0); `missionTimeAt(clock, realNowMs): number`; `withRate(clock, rate, realNowMs): ClockState`; `withPaused(clock, paused, realNowMs): ClockState` (both re-anchor so mission time is continuous, and increase `rev`).
- Produces, `field.ts`:
  ```ts
  export type FieldStatus = 'awaiting-route' | 'ready' | 'moving' | 'holding' | 'arrived';
  export type FieldNotice = { id: string; kind: 'message' | 'route-changed'; text: string;
                              sentMs: number; arrivedMs: number; acked: boolean };
  export type FieldState = { tMs: number; status: FieldStatus; traveller: TravellerKind | null;
    route: Route | null; hazards: Hazard[]; distM: number; pos: LatLon | null; headingDeg: number;
    paceMps: number; startedMs: number | null; lastFixMs: number | null; nextPassMs: number | null;
    posErrorM: number; notices: FieldNotice[] };
  export function fieldStateAt(log: MissionEvent[], tMs: number, passes?: SatellitePass[]): FieldState;
  ```
  `passes` defaults to `satellitePasses()`. Notice text for `route-changed`: `'Hazard ahead. Route changed by Control.'` (reason `hazard`) or `'Route changed by Control.'` (reason `replan`). `lastFixMs` is the later of the traverse start and the latest pass at or before `tMs`. `paceMps` is 0 unless status is `moving`.
- Produces, `control.ts`:
  ```ts
  export type UplinkStatus = 'in-transit' | 'delivered' | 'acknowledged';
  export type Uplink = { event: Extract<MissionEvent, { origin: 'control' }>; sentMs: number;
                         arrivesMs: number; status: UplinkStatus; progress: number };   // progress 0..1
  export type Downlink = { id: string; kind: 'traverse-started' | 'ack'; sentMs: number; receivedMs: number };
  export type ControlHazard = Hazard & { atField: boolean };
  export type ControlView = { tMs: number; dataAgeMs: number; traveller: TravellerKind | null; received: FieldState;
    estimatedNow: { distM: number; pos: LatLon } | null; activeRoute: Route | null; pendingRoute: Route | null;
    hazards: ControlHazard[]; uplinks: Uplink[]; downlinks: Downlink[] };
  export function controlViewAt(log: MissionEvent[], tMs: number, passes?: SatellitePass[]): ControlView;
  export function predictBranchDistM(view: ControlView): number;
  export function canReroute(view: ControlView): boolean;
  ```
  `traveller` comes from the `route-sent` event as soon as Control has sent it (Control knows what it sent), and it sets the pace used below. `received = fieldStateAt(log, tMs - SIGNAL_DELAY_MS)`. `activeRoute` = newest sent route with `arrivesMs <= tMs`; `pendingRoute` = newest sent route still in transit, else `null`. `estimatedNow` = `received` moved forward by `pace * SIGNAL_DELAY_MS` when `received.status === 'moving'` (clamped to the route end), the received position unchanged for other statuses, `null` when no position is known. `downlinks` lists only field events with `tMs + SIGNAL_DELAY_MS <= tMs(now)`. `predictBranchDistM` = `min(latestRoute.lengthM, received.distM + pace * 2 * SIGNAL_DELAY_MS / 1000)`, an upper bound on where the traveller can be when a new signal lands. `canReroute` = that value is more than 20 m short of the route end.

- [ ] **Step 1: Write the failing tests**

```ts
// clock.test.ts
const c = newClock(1_000);
expect(missionTimeAt(c, 2_000)).toBe(30_000);                       // 1 s real at 30x
const c2 = withRate(c, 60, 2_000);
expect(missionTimeAt(c2, 2_000)).toBe(30_000);                      // continuous at the change
expect(missionTimeAt(c2, 3_000)).toBe(90_000);
const c3 = withPaused(c2, true, 3_000);
expect(missionTimeAt(c3, 9_000)).toBe(90_000);
expect(c3.rev).toBeGreaterThan(c.rev);

// field.test.ts   (R = straightRoute(2000); PACE = PACE_MPS.astronaut; NO = [] as SatellitePass[])
const sent: MissionEvent = { id: 'r1', tMs: 0, type: 'route-sent', origin: 'control', traveller: 'astronaut', route: R, hazards: [] };
const start: MissionEvent = { id: 's1', tMs: 700_000, type: 'traverse-started', origin: 'field' };
it('does not have the route until the signal arrives', () => {
  expect(fieldStateAt([sent], 679_999, NO).status).toBe('awaiting-route');
  expect(fieldStateAt([sent], 679_999, NO).route).toBeNull();
  expect(fieldStateAt([sent], 680_000, NO).status).toBe('ready');
});
it('walks at the traveller pace after Start', () => {
  const s = fieldStateAt([sent, start], 1_300_000, NO);
  expect(s.status).toBe('moving'); expect(s.distM).toBeCloseTo(PACE * 600, 1); expect(s.headingDeg).toBeCloseTo(0, 0);
});
it('a hold order stops the traveller only when it arrives, and proceed restarts it', () => {
  const hold: MissionEvent = { id: 'h', tMs: 800_000, type: 'message', origin: 'control', text: 'Hold position', order: 'hold' };
  const go:   MissionEvent = { id: 'g', tMs: 1_000_000, type: 'message', origin: 'control', text: 'Proceed', order: 'proceed' };
  const log = [sent, start, hold, go];
  expect(fieldStateAt(log, 1_400_000, NO).status).toBe('moving');                 // hold still in transit
  expect(fieldStateAt(log, 1_600_000, NO)).toMatchObject({ status: 'holding', paceMps: 0 });
  expect(fieldStateAt(log, 1_600_000, NO).distM).toBeCloseTo(PACE * 780, 1);      // stopped at 1_480_000
  expect(fieldStateAt(log, 1_780_000, NO).distM).toBeCloseTo(PACE * 880, 1);      // moving again from 1_680_000
});
it('arrives and stays at the end', () => {
  const s = fieldStateAt([sent, start], 9_000_000, NO);
  expect(s.status).toBe('arrived'); expect(s.distM).toBeCloseTo(R.lengthM, 6); expect(s.paceMps).toBe(0);
});
it('position error grows since the last fix and resets at a pass', () => {
  const passes = [{ satellite: 'MRO', tMs: 900_000, quality: 'overhead' as const }];
  const before = fieldStateAt([sent, start], 899_000, passes);
  expect(before.lastFixMs).toBe(700_000); expect(before.posErrorM).toBeCloseTo(1 + 0.02 * PACE * 199, 2);
  const after = fieldStateAt([sent, start], 1_000_000, passes);
  expect(after.lastFixMs).toBe(900_000); expect(after.posErrorM).toBeCloseTo(1 + 0.02 * PACE * 100, 2);
  expect(before.nextPassMs).toBe(900_000); expect(after.nextPassMs).toBeNull();
});
it('a changed route keeps the distance already walked', () => {
  const change: MissionEvent = { id: 'c', tMs: 800_000, type: 'route-changed', origin: 'control', route: divertedRoute(R, 1500), hazards: [], reason: 'hazard' };
  const s = fieldStateAt([sent, start, change], 1_500_000, NO);
  expect(s.route!.lengthM).toBeCloseTo(1900, 0); expect(s.distM).toBeCloseTo(PACE * 800, 1);
  expect(s.notices.at(-1)).toMatchObject({ kind: 'route-changed', text: 'Hazard ahead. Route changed by Control.', acked: false });
});
it('acknowledging marks the notice', () => {
  const msg: MissionEvent = { id: 'm', tMs: 800_000, type: 'message', origin: 'control', text: 'Sample at WP 2' };
  const ack: MissionEvent = { id: 'a', tMs: 1_500_000, type: 'ack', origin: 'field', targetId: 'm' };
  expect(fieldStateAt([sent, start, msg, ack], 1_500_000, NO).notices[0].acked).toBe(true);
});
it('gives the same answer whatever order the log is in', () =>
  expect(fieldStateAt([start, sent], 1_300_000, NO)).toEqual(fieldStateAt([sent, start], 1_300_000, NO)));

// control.test.ts
it('sees the field as it was one delay ago and estimates now', () => {
  const v = controlViewAt([sent, start], 1_380_000, NO);
  expect(v.dataAgeMs).toBe(680_000);
  expect(v.received).toMatchObject({ status: 'moving', distM: 0 });
  expect(v.estimatedNow!.distM).toBeCloseTo(PACE * 680, 1);               // about 737 m ahead
});
it('does not know the traverse has started until the news arrives', () => {
  expect(controlViewAt([sent, start], 1_379_999, NO).received.status).toBe('ready');
  expect(controlViewAt([sent, start], 1_379_999, NO).downlinks).toEqual([]);
  expect(controlViewAt([sent, start], 1_380_000, NO).downlinks[0]).toMatchObject({ kind: 'traverse-started', sentMs: 700_000, receivedMs: 1_380_000 });
});
it('tracks an uplink from in transit to delivered to acknowledged', () => {
  const msg: MissionEvent = { id: 'm', tMs: 800_000, type: 'message', origin: 'control', text: 'Sample at WP 2' };
  const ack: MissionEvent = { id: 'a', tMs: 1_500_000, type: 'ack', origin: 'field', targetId: 'm' };
  const log = [sent, start, msg, ack];
  const up = (t: number) => controlViewAt(log, t, NO).uplinks.find(u => u.event.id === 'm')!;
  expect(up(1_140_000)).toMatchObject({ status: 'in-transit', arrivesMs: 1_480_000 });
  expect(up(1_140_000).progress).toBeCloseTo(0.5, 2);
  expect(up(1_480_000).status).toBe('delivered');
  expect(up(2_179_999).status).toBe('delivered');
  expect(up(2_180_000).status).toBe('acknowledged');
});
it('shows a changed route as pending until it lands', () => {
  const r2 = divertedRoute(R, 1500);
  const change: MissionEvent = { id: 'c', tMs: 1_400_000, type: 'route-changed', origin: 'control', route: r2, reason: 'hazard',
    hazards: [{ id: 'hz', center: ORIGIN, radiusM: 60, label: 'Flagged', source: 'control' }] };
  const mid = controlViewAt([sent, start, change], 1_500_000, NO);
  expect(mid.traveller).toBe('astronaut');
  expect(mid.activeRoute!.id).toBe(R.id); expect(mid.pendingRoute!.id).toBe(r2.id); expect(r2.id).not.toBe(R.id);
  expect(mid.hazards.find(h => h.id === 'hz')!.atField).toBe(false);
  const done = controlViewAt([sent, start, change], 2_080_000, NO);
  expect(done.activeRoute!.id).toBe(r2.id); expect(done.pendingRoute).toBeNull();
  expect(done.hazards.find(h => h.id === 'hz')!.atField).toBe(true);
});
it('predicts the furthest the traveller can be when a new signal lands', () => {
  const v = controlViewAt([sent, start], 1_380_000, NO);
  expect(predictBranchDistM(v)).toBeCloseTo(PACE * 1360, 1); expect(canReroute(v)).toBe(true);
});
it('refuses to reroute when the traveller is about to arrive', () => {      // Review Focus 4
  const v = controlViewAt([sent, start], 700_000 + 680_000 + 1_000_000, NO);  // received dist about 1083 m, + 1473 m > 2000 m
  expect(predictBranchDistM(v)).toBeCloseTo(R.lengthM, 6); expect(canReroute(v)).toBe(false);
});
```

- [ ] **Step 2:** Run `npm test` → the three files fail.
- [ ] **Step 3:** Implement `types.ts` and `clock.ts`.
- [ ] **Step 4:** Implement `field.ts`. Sort a copy of the log by `(tMs, id)` first. Build the list of moments that matter to Field: its own events at `tMs`, Control's events at `tMs + SIGNAL_DELAY_MS`; walk them in time order up to the requested time, adding `pace * elapsed` to the distance while the status is `moving` and clamping at the route length (which sets `arrived`). Use the same walker to get the distance at the last fix for `posErrorM`.
- [ ] **Step 5:** Implement `control.ts` on top of `fieldStateAt`.
- [ ] **Step 6:** Run `npm test` → all pass. Run `npm run typecheck` → clean.

---

### Task 5: Shared store, two-window sync and React hooks

**Files:**
- Create: `lib/mission/store.ts`, `lib/mission/useMission.ts`
- Test: `lib/mission/store.test.ts`

**Interfaces:**
- Consumes: Task 4 types and clock.
- Produces, `store.ts`:
  ```ts
  export const STORAGE_KEY = 'marsmap.mission.v1';  export const CHANNEL_NAME = 'marsmap.mission';
  export type MissionSnapshot = { epoch: number; log: MissionEvent[]; clock: ClockState };
  export type StorageLike = Pick<Storage, 'getItem' | 'setItem'>;
  export type ChannelLike = { postMessage(data: unknown): void; onmessage: ((e: { data: unknown }) => void) | null };
  type NewEvent = MissionEvent extends infer E ? E extends MissionEvent ? Omit<E, 'id' | 'tMs'> : never : never;
  export function freshSnapshot(realNowMs: number): MissionSnapshot;          // epoch = realNowMs, empty log, newClock
  export function loadSnapshot(storage: StorageLike, realNowMs: number): MissionSnapshot;   // fresh if missing or malformed
  export function mergeSnapshots(a: MissionSnapshot, b: MissionSnapshot): MissionSnapshot;
  export type MissionStore = { getSnapshot(): MissionSnapshot; subscribe(cb: () => void): () => void;
    now(): number;                                   // current mission time
    append(e: NewEvent): MissionEvent;               // stamps id (crypto.randomUUID) and tMs = now()
    setRate(rate: number): void; setPaused(paused: boolean): void; reset(): void };
  export function createMissionStore(storage: StorageLike, channel: ChannelLike, realNow?: () => number): MissionStore;
  ```
  `mergeSnapshots`: the higher `epoch` wins outright; with equal epochs, the logs are joined by event `id` and sorted by `(tMs, id)`, and the clock with the higher `rev` is kept. Every change writes the whole snapshot to storage and posts it on the channel; an incoming snapshot is merged and subscribers are told. `reset()` installs `freshSnapshot` (a higher epoch, so the other window drops its old log).
- Produces, `useMission.ts` (`'use client'`): `getMissionStore(): MissionStore` (one per page, built from `window.localStorage` and `new BroadcastChannel(CHANNEL_NAME)`, also assigned to `window.__marsMission` for the smoke test and for debugging); `useMissionSnapshot(): MissionSnapshot` (via `useSyncExternalStore`, with a server snapshot of an empty mission so the static export renders); `useMissionTime(fps = 10): number` (re-renders at that rate with `store.now()`).

- [ ] **Step 1: Write the failing tests** (`store.test.ts`; `fakeStorage()` is a `Map`-backed `StorageLike`; `fakeBus()` returns `connect()` which makes a `ChannelLike` that delivers each post to every *other* connected channel)

```ts
const ev = { type: 'traverse-started', origin: 'field' } as const;
it('a second window sees an event appended in the first', () => {
  const storage = fakeStorage(), bus = fakeBus();
  const a = createMissionStore(storage, bus.connect(), () => 1_000);
  const b = createMissionStore(storage, bus.connect(), () => 1_000);
  let told = 0; b.subscribe(() => told++);
  const e = a.append(ev);
  expect(told).toBe(1); expect(b.getSnapshot().log).toEqual([e]);
});
it('stamps events with mission time', () => {
  let real = 1_000; const s = createMissionStore(fakeStorage(), fakeBus().connect(), () => real);
  real = 3_000; expect(s.append(ev).tMs).toBe(60_000);            // 2 s real at 30x
});
it('a window opened later rebuilds the same state from storage', () => {      // Review Focus 1
  const storage = fakeStorage(), bus = fakeBus();
  const a = createMissionStore(storage, bus.connect(), () => 1_000);
  a.append({ type: 'route-sent', origin: 'control', traveller: 'astronaut', route: straightRoute(2000), hazards: [] });
  a.append(ev);
  const late = createMissionStore(storage, bus.connect(), () => 50_000);
  expect(late.getSnapshot()).toEqual(a.getSnapshot());
  expect(fieldStateAt(late.getSnapshot().log, 1_000_000, [])).toEqual(fieldStateAt(a.getSnapshot().log, 1_000_000, []));
});
it('keeps both events when two windows append at once', () => {
  const base = freshSnapshot(5);
  const e1 = { id: 'b', tMs: 10, ...ev }, e2 = { id: 'a', tMs: 10, ...ev };
  const m = mergeSnapshots({ ...base, log: [e1] }, { ...base, log: [e2] });
  expect(m.log.map(e => e.id)).toEqual(['a', 'b']);
});
it('a reset in one window clears the other', () => {
  const storage = fakeStorage(), bus = fakeBus(); let real = 1_000;
  const a = createMissionStore(storage, bus.connect(), () => real), b = createMissionStore(storage, bus.connect(), () => real);
  a.append(ev); real = 2_000; b.reset();
  expect(a.getSnapshot().log).toEqual([]); expect(a.getSnapshot().epoch).toBe(2_000);
});
it('a speed change reaches the other window and keeps time continuous', () => {
  const storage = fakeStorage(), bus = fakeBus(); let real = 1_000;
  const a = createMissionStore(storage, bus.connect(), () => real), b = createMissionStore(storage, bus.connect(), () => real);
  real = 2_000; a.setRate(60); real = 3_000;
  expect(b.now()).toBe(90_000);
});
it.each(['not json', '{"epoch":"x"}', '{"epoch":1,"log":"nope","clock":{}}', 'null'])   // Review Focus 5
  ('starts fresh when storage holds %s', (bad) => {
    const storage = fakeStorage(); storage.setItem(STORAGE_KEY, bad);
    const s = loadSnapshot(storage, 7_000);
    expect(s).toEqual(freshSnapshot(7_000));
  });
```

- [ ] **Step 2:** Run `npm test` → `store.test.ts` fails.
- [ ] **Step 3:** Implement `store.ts`. `loadSnapshot` validates the shape (number `epoch`, array `log`, clock with numeric fields) and returns `freshSnapshot` on any doubt; it never throws, including when `getItem` itself throws.
- [ ] **Step 4:** Implement `useMission.ts`.
- [ ] **Step 5:** Run `npm test` → all pass. Run `npm run typecheck` → clean. Run `npm run build` → export still succeeds.

---

### Task 6: The Mars map component

**Files:**
- Create: `lib/mars/tiles.ts`, `lib/mars/tileHealth.ts`, `components/map/overlays.ts`, `components/map/styles.ts`, `components/map/MarsMap.tsx`, `components/map/MarsMap.module.css`
- Test: `lib/mars/tiles.test.ts`, `lib/mars/tileHealth.test.ts`
- Modify (temporarily): `app/control/page.tsx` to show the map for the visual check

**Interfaces:**
- Consumes: `LatLon`, `Hazard`; `destination` from `lib/nav/geo.ts`; `DEMO_BOUNDS`.
- Produces, `tiles.ts`:
  ```ts
  export const TREK_BASE = 'https://trek.nasa.gov/tiles/Mars/EQ';
  export const MARS_RESOLUTIONS: number[];     // 18 entries, [z] = 180 / 256 / 2 ** z  (degrees per pixel)
  export type TrekLayer = { id: string; ext: 'jpg' | 'png'; minZoom: number; maxNativeZoom: number;
                            bounds?: { south: number; west: number; north: number; east: number } };
  export const TREK_LAYERS: TrekLayer[];       // bottom to top, values below
  export function tileCoordFor(p: LatLon, z: number): { x: number; y: number };
  export function trekTileUrl(layerId: string, ext: string, z: number, x: number, y: number): string;
  ```
  | id | ext | minZoom | maxNativeZoom | bounds (S, W, N, E) |
  |---|---|---|---|---|
  | `Mars_Viking_MDIM21_ClrMosaic_global_232m` | jpg | 0 | 7 | whole planet |
  | `JEZ_ctx_B_soc_008_orthoMosaic_6m_Eqc_latTs0_lon0` | png | 9 | 13 | 18.2110274, 77.1604655, 18.7211945, 77.6991776 |
  | `JEZ_hirise_soc_006_orthoMosaic_25cm_Eqc_latTs0_lon0_first_dd` | png | 11 | 17 | 18.3067994, 77.2229331, 18.669315, 77.583964 |
- Produces, `tileHealth.ts`: `createTileHealth(): { loaded(): void; failed(): void; readonly unavailable: boolean; reset(): void }`; `unavailable` is true when `failures >= 3 && failures > loads`.
- Produces, `overlays.ts`:
  ```ts
  export type MapOverlay =
    | { kind: 'route'; id: string; points: LatLon[]; variant: 'active' | 'walked' | 'alternative' | 'alternative-dotted' | 'pending' }
    | { kind: 'hazard'; id: string; hazard: Hazard; pending?: boolean }
    | { kind: 'waypoint'; id: string; pos: LatLon; label: string }
    | { kind: 'endpoint'; id: string; pos: LatLon; variant: 'start' | 'end' }
    | { kind: 'traveller'; id: string; pos: LatLon; headingDeg: number; errorM: number; variant: 'solid' | 'ghost' }
    | { kind: 'ring'; id: string; center: LatLon; radiusM: number; label: string }
    | { kind: 'label'; id: string; pos: LatLon; text: string; tone: 'plain' | 'route' | 'caution' | 'inverse' };
  export type MapCamera =
    | { mode: 'follow'; center: LatLon; headingDeg: number; zoom: number }       // heading-up, traveller at 65 % of the height
    | { mode: 'fit'; points: LatLon[] }                                          // north-up, fitted with padding
    | { mode: 'free' };                                                          // user pans and zooms, limited to DEMO_BOUNDS
  ```
- Produces, `MarsMap.tsx` (`'use client'`): `export default function MarsMap(props: { overlays: MapOverlay[]; camera: MapCamera; onMapClick?: (p: LatLon) => void; armed?: boolean; className?: string })`. Renders a `div[data-testid="mars-map"]`. `armed` shows a crosshair cursor. When tiles are unavailable it renders a strip `div[data-testid="tiles-unavailable"]` reading `MAP IMAGERY UNAVAILABLE · ROUTE DATA STILL LIVE` and keeps drawing overlays on the flat `--surface` background.

- [ ] **Step 1: Write the failing tests**

```ts
// tiles.test.ts
expect(MARS_RESOLUTIONS).toHaveLength(18);
expect(MARS_RESOLUTIONS[0]).toBe(0.703125);                       // two 256 px tiles across 360 degrees
expect(tileCoordFor({ lat: 18.4446, lon: 77.4509 }, 15)).toEqual({ x: 46867, y: 13026 });
expect(tileCoordFor({ lat: 90, lon: -180 }, 0)).toEqual({ x: 0, y: 0 });
expect(trekTileUrl('JEZ_hirise_soc_006_orthoMosaic_25cm_Eqc_latTs0_lon0_first_dd', 'png', 15, 46867, 13026)).toBe(
  'https://trek.nasa.gov/tiles/Mars/EQ/JEZ_hirise_soc_006_orthoMosaic_25cm_Eqc_latTs0_lon0_first_dd/1.0.0/default/default028mm/15/13026/46867.png');
expect(TREK_LAYERS.map(l => l.maxNativeZoom)).toEqual([7, 13, 17]);

// tileHealth.test.ts                                              // Review Focus 2
const h = createTileHealth();
h.failed(); h.failed(); expect(h.unavailable).toBe(false);
h.failed(); expect(h.unavailable).toBe(true);
h.loaded(); h.loaded(); h.loaded(); expect(h.unavailable).toBe(false);
h.failed(); h.reset(); expect(h.unavailable).toBe(false);
```

(That URL was fetched on 2026-11-14 and returned a PNG of Jezero terrain.)

- [ ] **Step 2:** Run `npm test` → both files fail.
- [ ] **Step 3:** Implement `tiles.ts` and `tileHealth.ts`; run `npm test` → pass.
- [ ] **Step 4:** Implement `MarsMap.tsx` with OpenLayers. Projection `'EPSG:4326'` (coordinates are `[lon, lat]`). One `TileLayer` per `TREK_LAYERS` entry using an `XYZ` source with `tileUrlFunction` calling `trekTileUrl`, and a `TileGrid` with `extent [-180, -90, 180, 90]`, `origin [-180, 90]`, `tileSize 256` and `MARS_RESOLUTIONS` cut at that layer's `maxNativeZoom` (OpenLayers enlarges the last level beyond it); each layer gets its `extent` from `bounds` and `className: 'mars-tiles'`, which the CSS module tints with `filter: sepia(.75) saturate(1.5) hue-rotate(-14deg) brightness(.8) contrast(1.1)`. View: zoom 12 to 18, extent limited to `DEMO_BOUNDS`, no default controls, no attribution box (credit goes in the README and landing page). One `VectorLayer` for overlays; rebuild its features when `overlays` changes. Wire tile `tileloadend` / `tileloaderror` to `createTileHealth`. Create the map in an effect and dispose it on unmount; the component must be imported with `next/dynamic` and `ssr: false` by its users.
- [ ] **Step 5:** Implement `styles.ts`, one style function per overlay kind, colours read from the CSS tokens:
  - route `active`: 3 px `--route` over a 7 px 55 % black casing; `walked`: 2 px white, dash 4-4; `alternative`: 1.8 px white dash 6-5; `alternative-dotted`: 1.8 px white dash 2-5; `pending`: 2.4 px `--route` dash 7-5.
  - hazard: circle built from 48 `destination()` points, 1.5 px `--caution` outline, 45° `--caution` hatch fill (a canvas pattern); `pending` uses a dashed outline.
  - waypoint: 9 px diamond, `--surface` fill, 2 px `--route` outline, label chip beside it.
  - endpoint: 16 px square, white filled for `start`, `--surface` with a 2.5 px white outline for `end`.
  - traveller `solid`: white-outlined triangle with `--surface` fill pointing along `headingDeg`, plus a white circle of radius `errorM` (never drawn smaller than 14 px); `ghost`: the same, dashed, no fill.
  - ring: dotted white circle of `radiusM` with its label chip on the ring.
  - label: text chip, `--surface` background for `plain` (white text), `route` (magenta text) and `caution` (amber text); amber background with dark text for `inverse`. Uppercase, Barlow Condensed 600 (read the real family name from the computed `--font-barlow`).
- [ ] **Step 6: Visual check.** Temporarily render in `app/control/page.tsx` a full-window `MarsMap` with `camera = { mode: 'fit', points: [DEFAULT_START, DEFAULT_END] }` and overlays for the three `planRoutes(DEFAULT_START, DEFAULT_END, PRESET_HAZARDS)` routes (safest `active`, shortest `alternative`, flattest `alternative-dotted`), the preset hazards, start and end endpoints, and a `solid` traveller at `DEFAULT_START` with `errorM: 6`. Run `npm run dev`, open `http://localhost:3000/control/` and take a screenshot (headless Edge: `msedge --headless=new --screenshot=.smoke/map.png --window-size=1280,800 --virtual-time-budget=15000 http://localhost:3000/control/`). Expected: warm-tinted Jezero imagery; three distinct routes joining the two squares; the magenta one avoiding every hatched circle; no console errors. Leave the temporary page for Task 7 to replace.

---

### Task 7: Control shell, demo controls and Plan mode

**Files:**
- Create: `components/shared/Readout.tsx`, `components/shared/Bar.tsx`, `components/shared/shared.module.css`, `components/control/ControlScreen.tsx`, `components/control/TopBar.tsx`, `components/control/usePlanDraft.ts`, `components/control/PlanRail.tsx`, `components/control/PlanDetailRail.tsx`, `components/control/ElevationProfile.tsx`, `components/control/controlModel.ts`, `components/control/control.module.css`, `scripts/smoke.mjs`
- Modify: `app/control/page.tsx`, `package.json` (script `smoke`, dev dependency `playwright-core`)
- Test: `components/control/controlModel.test.ts`

**Interfaces:**
- Consumes: Tasks 2-6.
- Produces, shared: `Readout({ label, value, unit?, tone? })` where `tone: 'plain' | 'nominal' | 'caution' | 'danger' | 'route'`; `Bar({ label, value, unit, fraction, tone? })`.
- Produces, `controlModel.ts`:
  ```ts
  export type RouteSummary = { profile: RouteProfile; letter: 'A' | 'B' | 'C'; title: string;   // 'Safest' | 'Shortest' | 'Flattest'
    length: string; time: string; maxSlope: string; risk: Risk; riskLabel: string };            // 'Risk low' | 'Risk medium' | 'Risk high'
  export function summarizeRoute(route: Route, traveller: TravellerKind): RouteSummary;         // time = formatClock(lengthM / pace)
  export function recommendationText(routes: Route[]): string;       // why 'safest' is recommended, comparing it with 'shortest'
  export function passesDuring(route: Route, traveller: TravellerKind, startMs: number): { passes: SatellitePass[]; longestGapMs: number; worstDriftM: number };
  export function planOverlays(routes: Route[], selected: RouteProfile, hazards: Hazard[], start: LatLon | null, end: LatLon | null): MapOverlay[];
  export const EARTH_CLOCK_START_MS: number;  export const MARS_SOL = 1284;  export const MARS_CLOCK_START_MS: number;
  ```
- Produces, `usePlanDraft.ts`: `usePlanDraft(): { traveller; setTraveller; start; end; arming: 'start' | 'end' | null; arm(which); placeAt(p: LatLon); routes: Route[]; selected: RouteProfile; select(p); tooClose: boolean }`. Starts with `DEFAULT_START`, `DEFAULT_END`, `'astronaut'`, routes planned, `'safest'` selected. `placeAt` sets whichever end is armed and replans. `tooClose` is true when `planRoutes` returned `[]`.
- Produces, `ControlScreen` test ids: `tab-plan`, `tab-live`, `demo-rate` (a button group, each button `data-rate`), `demo-pause`, `demo-reset`, `plan-traveller-astronaut`, `plan-traveller-rover`, `plan-arm-start`, `plan-arm-end`, `route-card-safest`, `route-card-shortest`, `route-card-flattest`, `send-route`, `signal-delay`.

- [ ] **Step 1: Write the failing tests** (`controlModel.test.ts`)

```ts
const routes = planRoutes(DEFAULT_START, DEFAULT_END, PRESET_HAZARDS);
it('summarises a route for its card', () => {
  const s = summarizeRoute(straightRoute(2310), 'astronaut');
  expect(s).toMatchObject({ length: '2.31 km', time: '35:32', riskLabel: 'Risk low' });      // 2310 m at 3.9 km/h
  expect(summarizeRoute(straightRoute(2310), 'rover').time).toBe('32:05');                   // 2310 m at 1.2 m/s
  expect(summarizeRoute(routes[1], 'astronaut')).toMatchObject({ letter: 'B', title: 'Shortest', riskLabel: 'Risk high' });
});
it('explains the recommendation with real numbers', () => {
  const t = recommendationText(routes);
  expect(t).toContain('Dune field');
  expect(t).toContain(formatDistance(routes[0].lengthM - routes[1].lengthM).value);
});
it('finds the passes during a traverse and the worst drift', () => {
  const p = passesDuring(straightRoute(2000), 'astronaut', 0);            // 30:46 long, passes at 6, 19, 31 min
  expect(p.passes.map(x => x.tMs / 60_000)).toEqual([6, 19]);
  expect(p.longestGapMs).toBe(13 * 60_000);
  expect(p.worstDriftM).toBeCloseTo(1 + 0.02 * PACE_MPS.astronaut * 13 * 60, 1);
});
it('draws the selected route in magenta and the others as alternatives', () => {
  const o = planOverlays(routes, 'safest', PRESET_HAZARDS, DEFAULT_START, DEFAULT_END);
  expect(o.filter(x => x.kind === 'route').map(x => x.kind === 'route' && x.variant).sort())
    .toEqual(['active', 'alternative', 'alternative-dotted']);
  expect(o.filter(x => x.kind === 'endpoint')).toHaveLength(2);
  expect(o.filter(x => x.kind === 'waypoint')).toHaveLength(routes[0].waypoints.length - 1);   // 'End' is the endpoint
});
```

- [ ] **Step 2:** Run `npm test` → fails. Implement `controlModel.ts`; run → passes.
- [ ] **Step 3:** Build `Readout`, `Bar` and `ControlScreen` as a CSS grid matching `control-layout-v2.html`: columns `270px 1fr 270px`, rows `40px 1fr 130px`, minimum width 1120 px (below that the page scrolls sideways; below 700 px the rails stack under the map). `TopBar`: "MARS MAP / CONTROL", Plan and Live tabs, traverse name "TRAVERSE 07 · JEZERO WEST", Earth UTC clock and Mars sol clock (start values plus mission time), "SIGNAL DELAY 11:20" in `--caution`, then the demo controls (rate buttons from `RATES`, pause, reset with a confirm step) set apart at the far right in `--muted`.
- [ ] **Step 4:** Plan mode. `PlanRail` (left): astronaut / rover switch; Start and End cells showing `formatLat` / `formatLon`, each with an arm button, the armed one highlighted and the map `armed`; three route cards from `summarizeRoute`, selected card with a 3 px `--route` left edge; `send-route` button "SEND ROUTE A TO FIELD ▲" with "Arrives in 11:20" beneath; when `tooClose`, the cards are replaced by "START AND END ARE TOO CLOSE" and the button is disabled. `PlanDetailRail` (right): waypoint table (number, name, leg length, leg max slope), passes from `passesDuring` with longest gap and worst drift, and `recommendationText`. `ElevationProfile` (bottom strip): SVG area chart of `route.elevationM` against distance with waypoint ticks, min and max elevation labels, distance axis. Map: `planOverlays`, camera `fit` on the selected route.
- [ ] **Step 5:** Sending. `send-route` appends `{ type: 'route-sent', origin: 'control', traveller, route: <selected>, hazards: PRESET_HAZARDS }` and switches to the Live tab (an empty Live placeholder until Task 9). If the log already has a `route-sent`, Plan shows "MISSION IN PROGRESS · RESET TO PLAN A NEW ONE" instead of the send button, and Control opens on Live.
- [ ] **Step 6:** `scripts/smoke.mjs` with `playwright-core`: launch with `channel: 'msedge'`, falling back to `'chrome'`; one browser context; base URL from `BASE_URL` or `http://localhost:3000`. Open `/control/` at 1280×800, save `.smoke/plan.png`, assert the three route cards exist and the selected one is `route-card-safest`, click `route-card-flattest` and assert it becomes selected, click `route-card-safest`, click `send-route`, then assert `window.__marsMission.getSnapshot().log` has one `route-sent` event. Exit non-zero on any failed assertion.
- [ ] **Step 7: Verify.** `npm test` → pass. With `npm run dev` running, `npm run smoke` → exits 0. Open `.smoke/plan.png` and compare with the Plan half of `control-layout-v2.html`: same three columns, cards, map with three routes, height profile. `npm run build` → succeeds.

---

### Task 8: Field HUD

**Files:**
- Create: `components/shared/TurnArrow.tsx`, `components/field/fieldModel.ts`, `components/field/FieldScreen.tsx`, `components/field/NextMoveBand.tsx`, `components/field/MessageStrip.tsx`, `components/field/ReadoutBand.tsx`, `components/field/StatusPanel.tsx`, `components/field/field.module.css`
- Modify: `app/field/page.tsx`, `scripts/smoke.mjs`
- Test: `components/field/fieldModel.test.ts`

**Interfaces:**
- Consumes: `FieldState`, `nextMove`, `MANEUVER_TEXT`, `MapOverlay`, `MarsMap`, `Readout`, `Bar`, the store hooks.
- Produces, `fieldModel.ts`:
  ```ts
  export type Cell = { label: string; value: string; unit?: string; tone: 'plain' | 'nominal' | 'caution' };
  export type BarCell = { label: string; value: string; unit: string; fraction: number };
  export function fieldOverlays(state: FieldState): MapOverlay[];
  export function fieldCells(state: FieldState): Cell[];          // always 6
  export function fieldBars(state: FieldState): BarCell[];        // always 2
  export function fieldCamera(state: FieldState): MapCamera;      // follow at zoom 15.5 when a position exists, else fit DEMO_BOUNDS
  export const FIX_STALE_MS = 180_000;  export const ERROR_OK_M = 10;
  ```
  Cells, in order: `Distance` (remaining), `ETA` (remaining / pace, `--:--` when not moving), `Pace` (astronaut) or `Speed` (rover) in km/h, `Pos error` (`±N`, m, rounded up, `nominal` up to `ERROR_OK_M` then `caution`), `Last fix` (age as `formatClock`, `caution` beyond `FIX_STALE_MS`), `Next pass` (countdown, `--:--` if none). Bars: astronaut `O₂` and `Power`; rover `Battery` and `Tilt`. Mock values: O₂ and Battery start at 96 % and lose 0.5 % per mission minute since the traverse started; Power starts at 92 % and loses 0.25 % per minute; Tilt is the route slope at the current position (fraction of 30°); none drop below 5 %.
- Produces, test ids: `field-status` (with `data-status`), `field-start`, `field-next-move`, `field-message`, `field-fix-cue`.

- [ ] **Step 1: Write the failing tests** (`fieldModel.test.ts`; build states with `fieldStateAt` from the Task 4 fixtures)

```ts
const moving = fieldStateAt([sent, start], 1_300_000, []);
it('draws the route ahead from the traveller, the walked path behind, and the marker', () => {
  const o = fieldOverlays(moving);
  const ahead = o.find(x => x.kind === 'route' && x.variant === 'active');
  const walked = o.find(x => x.kind === 'route' && x.variant === 'walked');
  expect(ahead && ahead.kind === 'route' && ahead.points[0]).toEqual(moving.pos);
  expect(walked && walked.kind === 'route' && walked.points.at(-1)).toEqual(moving.pos);
  expect(o.find(x => x.kind === 'traveller')).toMatchObject({ variant: 'solid', errorM: moving.posErrorM });
  expect(o.find(x => x.kind === 'ring')).toMatchObject({ radiusM: 100, label: '100 m' });
  expect(o.filter(x => x.kind === 'waypoint')).toHaveLength(1);              // only the next waypoint
});
it('draws nothing before a route has arrived', () =>
  expect(fieldOverlays(fieldStateAt([sent], 100_000, []))).toEqual([]));
it('labels the six cells for an astronaut', () =>
  expect(fieldCells(moving).map(c => c.label)).toEqual(['Distance', 'ETA', 'Pace', 'Pos error', 'Last fix', 'Next pass']));
it('swaps the readouts for a rover', () => {
  const rover = fieldStateAt([{ ...sent, traveller: 'rover' }, start], 1_300_000, []);
  expect(fieldCells(rover)[2].label).toBe('Speed'); expect(fieldBars(rover).map(b => b.label)).toEqual(['Battery', 'Tilt']);
  expect(fieldBars(moving).map(b => b.label)).toEqual(['O₂', 'Power']);
});
it('turns the last fix amber when it is stale and the error amber when it is large', () => {
  const late = fieldStateAt([sent, start], 700_000 + 181_000, []);
  expect(fieldCells(late)[4]).toMatchObject({ value: '03:01', tone: 'caution' });
  expect(fieldCells(moving)[3].tone).toBe('caution');      // 650 m without a fix is about ±14 m
  expect(fieldCells(fieldStateAt([sent, start], 760_000, []))[3]).toMatchObject({ value: '±3', tone: 'nominal' });
});
it('follows the traveller heading-up', () =>
  expect(fieldCamera(moving)).toMatchObject({ mode: 'follow', zoom: 15.5, headingDeg: moving.headingDeg }));
```

- [ ] **Step 2:** Run `npm test` → fails. Implement `fieldModel.ts`; run → passes.
- [ ] **Step 3:** `TurnArrow({ maneuver })`: one inline SVG per `Maneuver`, square line caps, 4 px stroke, drawn in `currentColor`.
- [ ] **Step 4:** Build `FieldScreen` to match option B in `field-look-v2.html`, filling the window (`100dvh`, safe-area padding), designed for 360-430 px wide and centred with a maximum width of 480 px on wider windows:
  - `NextMoveBand`: arrow, distance (large), `MANEUVER_TEXT` and "· WP n name" on the left; `HDG` and `WAYPOINT n / total` cells on the right.
  - `MessageStrip`: amber strip with the newest unacknowledged notice, "CTRL ▸ text" and its age since it was sent as `−MM:SS`; tapping it appends `{ type: 'ack', origin: 'field', targetId }`. Hidden when there is nothing unacknowledged.
  - Map: `fieldOverlays` and `fieldCamera`, plus a north pointer that turns against the map rotation.
  - `ReadoutBand`: the six cells in two rows of three, the two bars beneath.
  - `StatusPanel`: full-map panel for `awaiting-route` ("AWAITING ROUTE FROM CONTROL"), `ready` (route length, time, and a `field-start` button "START TRAVERSE" which appends `{ type: 'traverse-started', origin: 'field' }`), and a slim banner for `holding` ("HOLDING · ORDER FROM CONTROL") and `arrived` ("TRAVERSE COMPLETE").
  - Cues: for 4 mission-minutes after a pass, a `field-fix-cue` chip "FIX ACQUIRED" by the position readout; for 4 mission-minutes after a route change arrives, the route line pulses once and the strip shows the notice. No cue animates under reduced motion.
- [ ] **Step 5:** Extend `scripts/smoke.mjs`: in the same context open `/field/` in a second page at 390×844; assert `field-status` is `awaiting-route`; after the route is sent from Control, set `window.__marsMission.setRate(600)` and wait until `field-status` becomes `ready` (about 1.2 s real); click `field-start`; wait until `field-status` is `moving` and `field-next-move` has text; set the rate back to 30; save `.smoke/field.png`.
- [ ] **Step 6: Verify.** `npm test` → pass. `npm run smoke` → exits 0. Open `.smoke/field.png` and compare with option B: black bands top and bottom, magenta route ahead of a white triangle, six cells and two bars. `npm run build` → succeeds.

---

### Task 9: Control Live mode

**Files:**
- Create: `components/control/LiveRail.tsx`, `components/control/CommsRail.tsx`, `components/control/SignalTimeline.tsx`, `components/control/timelineModel.ts`
- Modify: `components/control/controlModel.ts`, `components/control/ControlScreen.tsx`, `components/control/control.module.css`, `scripts/smoke.mjs`
- Test: `components/control/timelineModel.test.ts`, `components/control/controlModel.test.ts` (added cases)

**Interfaces:**
- Consumes: `ControlView`, `controlViewAt`, `predictBranchDistM`, `canReroute`, `replan`, `spliceRoute`, `FLAG_RADIUS_M`, `fieldCells`, `fieldBars`.
- Produces, added to `controlModel.ts`:
  ```ts
  export function liveOverlays(view: ControlView): MapOverlay[];
  export function buildReroute(view: ControlView, newHazard: Hazard | null): { route: Route; hazards: Hazard[] } | null;
     // null when canReroute(view) is false or replan finds nothing
  export function uplinkText(u: Uplink): string;      // message text; 'Route sent.'; the route-changed notice texts
  ```
  `buildReroute`: branch point = `predictBranchDistM(view)` along the newest sent route; `hazards` = everything Control knows plus `newHazard`; `tail = replan(branchPos, routeEnd, hazards, newestRoute.profile)`; result `route = spliceRoute(newestRoute, branchDist, tail)`.
  `liveOverlays`: `walked` up to the received position; `active` from there on `view.activeRoute`; `pending` for the part of `view.pendingRoute` after the point where it stops matching `view.activeRoute` (compare the two point lists from the start); a `solid` traveller at the received position labelled `LAST RECEIVED · 11:20 OLD`; a `ghost` traveller at `estimatedNow` labelled `ESTIMATED NOW`; hazards, with `pending: true` and an `inverse` label `FLAGGED · NOT YET AT FIELD` while `atField` is false; a `route`-toned label `REROUTE · ARRIVES IN MM:SS` on a pending route.
- Produces, `timelineModel.ts`:
  ```ts
  export type TimelineSignal = { id: string; dir: 'up' | 'down'; sentMs: number; arrivesMs: number;
                                 tone: 'telemetry' | 'nominal' | 'caution'; label?: string };
  export type Timeline = { fromMs: number; toMs: number; nowMs: number; signals: TimelineSignal[];
                           passes: { tMs: number; past: boolean }[] };
  export function buildTimeline(view: ControlView, passes: SatellitePass[]): Timeline;
  export const TIMELINE_BACK_MS = 40 * 60_000;  export const TIMELINE_AHEAD_MS = 20 * 60_000;  export const TELEMETRY_EVERY_MS = 5 * 60_000;
  ```
  Uplinks are `dir: 'up'`, `caution` while in transit and `nominal` after, labelled `ROUTE`, `REROUTE`, `HOLD`, `PROCEED` or `MSG`. Downlinks (`view.downlinks`) are `dir: 'down'`, `nominal`. Telemetry: one `telemetry` down-signal every `TELEMETRY_EVERY_MS` from the traverse start as known to Control, **only those with `arrivesMs <= nowMs`**.
- Produces, test ids: `data-age`, `flag-hazard`, `replan`, `too-late`, `msg-input`, `msg-send`, `order-hold`, `order-proceed`, `uplink` (each log entry, with `data-status`), `signal-timeline`.

- [ ] **Step 1: Write the failing tests**

```ts
// timelineModel.test.ts  (log = [sent, start] from the Task 4 fixtures)
it('never shows a signal from the field before it has arrived', () => {
  const early = buildTimeline(controlViewAt([sent, start], 1_000_000, []), []);
  expect(early.signals.filter(s => s.dir === 'down')).toEqual([]);          // start news lands at 1_380_000
  const later = buildTimeline(controlViewAt([sent, start], 2_000_000, []), []);
  expect(later.signals.filter(s => s.dir === 'down').every(s => s.arrivesMs <= 2_000_000)).toBe(true);
  expect(later.signals.some(s => s.tone === 'telemetry')).toBe(true);
});
it('draws an uplink in transit in caution and a delivered one in nominal', () => {
  const t = buildTimeline(controlViewAt([sent], 300_000, []), []);
  expect(t.signals[0]).toMatchObject({ dir: 'up', sentMs: 0, arrivesMs: 680_000, tone: 'caution', label: 'ROUTE' });
  expect(buildTimeline(controlViewAt([sent], 700_000, []), []).signals[0].tone).toBe('nominal');
});
it('covers 40 minutes back and 20 ahead and marks passes', () => {
  const t = buildTimeline(controlViewAt([sent], 1_200_000, []), [{ satellite: 'MRO', tMs: 360_000, quality: 'overhead' }, { satellite: 'TGO', tMs: 1_860_000, quality: 'overhead' }]);
  expect(t.toMs - t.fromMs).toBe(60 * 60_000); expect(t.nowMs).toBe(1_200_000);
  expect(t.passes).toEqual([{ tMs: 360_000, past: true }, { tMs: 1_860_000, past: false }]);
});

// controlModel.test.ts, added
it('builds a reroute that starts where the traveller can be on arrival and avoids the new hazard', () => {
  const [safest] = planRoutes(DEFAULT_START, DEFAULT_END, PRESET_HAZARDS);
  const s2: MissionEvent = { ...sent, route: safest, hazards: PRESET_HAZARDS };
  const view = controlViewAt([s2, start], 700_000, []);
  const hz: Hazard = { id: 'hz', center: pointAlong(safest.points, safest.lengthM - 300).pos, radiusM: FLAG_RADIUS_M, label: 'Flagged', source: 'control' };
  const r = buildReroute(view, hz)!;
  const branch = predictBranchDistM(view);
  expect(pointAlong(r.route.points, branch - 50).pos.lat).toBeCloseTo(pointAlong(safest.points, branch - 50).pos.lat, 6);
  expect(slicePath(r.route.points, branch, r.route.lengthM).some(p => isInsideHazard(p, hz))).toBe(false);
  expect(r.hazards.some(h => h.id === 'hz')).toBe(true);
  expect(r.route.points.at(-1)).toEqual(DEFAULT_END);
});
it('offers no reroute when it is too late', () =>                            // Review Focus 4
  expect(buildReroute(controlViewAt([sent, start], 2_380_000, []), null)).toBeNull());
it('shows two travellers and marks an undelivered hazard as pending', () => {
  const hz: Hazard = { id: 'hz', center: ORIGIN, radiusM: 60, label: 'Flagged', source: 'control' };
  const change: MissionEvent = { id: 'c', tMs: 1_400_000, type: 'route-changed', origin: 'control', route: divertedRoute(R, 1500), hazards: [hz], reason: 'hazard' };
  const o = liveOverlays(controlViewAt([sent, start, change], 1_500_000, []));
  expect(o.filter(x => x.kind === 'traveller').map(x => x.kind === 'traveller' && x.variant).sort()).toEqual(['ghost', 'solid']);
  expect(o.find(x => x.kind === 'hazard' && x.id === 'hz')).toMatchObject({ pending: true });
  expect(o.some(x => x.kind === 'label' && x.text === 'FLAGGED · NOT YET AT FIELD')).toBe(true);
  expect(o.some(x => x.kind === 'route' && x.variant === 'pending')).toBe(true);
});
```

- [ ] **Step 2:** Run `npm test` → fails. Implement `timelineModel.ts` and the `controlModel.ts` additions; run → passes.
- [ ] **Step 3:** `LiveRail` (left), matching the Live half of `control-layout-v2.html`: amber `data-age` bar "FIELD DATA IS 11:20 OLD"; traveller name ("EV-1 · ASTRONAUT" or "RV-1 · ROVER") with the received status; readout grid reusing `fieldCells` / `fieldBars` on `view.received`; progress bar with "x of y km" and "LEG n OF m"; received coordinates with "Received HH:MM:SS · sent from Mars HH:MM:SS" and "Estimated now: about N m further along the route"; `flag-hazard` and `replan` buttons. Before any field data has arrived it reads "NO FIELD DATA YET · FIRST SIGNAL IN MM:SS".
- [ ] **Step 4:** Hazard and replan. `flag-hazard` arms the map; the next click makes `{ id, center, radiusM: FLAG_RADIUS_M, label: 'Flagged', source: 'control' }`, calls `buildReroute(view, hazard)` and appends `{ type: 'route-changed', origin: 'control', reason: 'hazard', route, hazards }`. `replan` does the same with `null` and `reason: 'replan'`. When `buildReroute` returns `null`, show a `too-late` notice "TOO LATE TO REROUTE · TRAVELLER WILL HAVE ARRIVED" and append nothing. Both buttons are disabled until a route has been sent. Map: `liveOverlays(view)`, camera `fit` on the newest route, then `free` once the user drags.
- [ ] **Step 5:** `CommsRail` (right): header "COMMS · ONE WAY 11:20"; `view.uplinks` and `view.downlinks` merged newest first, each `uplink` entry showing direction, send time, `uplinkText`, and its status: in transit (amber left edge, progress bar, "ARRIVES IN MM:SS · FIELD STILL ON OLD ROUTE" for route changes), delivered, or acknowledged (`--nominal`). At the bottom: `order-hold` and `order-proceed` buttons (append `message` events with `order` and text "Hold position" / "Proceed"), `msg-input` with `msg-send` (plain `message`; empty or whitespace-only text is not sent; 140 character limit), and "Will arrive at HH:MM:SS".
- [ ] **Step 6:** `SignalTimeline` (bottom strip): SVG from `buildTimeline`. Two lanes, EARTH above and MARS below; each signal a straight line from its send point on one lane to its arrival point on the other; an in-transit uplink solid up to "now" with a dot there and dashed beyond; a vertical NOW line with a tag; passes as squares on the Mars lane (filled if past, outlined if ahead); the area right of NOW slightly lighter; tick labels every 10 minutes.
- [ ] **Step 7:** Extend `scripts/smoke.mjs` (continuing after Task 8's steps, the Field traveller moving): on the Control page assert `data-age` contains `11:20`; type "Sample at next waypoint" into `msg-input` and click `msg-send`; assert the new `uplink` has `data-status="in-transit"`; set rate 600 and wait until it is `delivered`; on the Field page assert `field-message` contains "Sample at next waypoint", click it, and on Control wait until that `uplink` is `acknowledged`; click `order-hold`, wait until Field `field-status` is `holding`; click `order-proceed`, wait for `moving`; set rate 30; click `flag-hazard`, click the middle of `mars-map`, assert the log's last event is `route-changed` or that `too-late` is shown; save `.smoke/live.png` and `.smoke/field-live.png`.
- [ ] **Step 8: Verify.** `npm test` → pass. `npm run smoke` → exits 0. Open `.smoke/live.png` and compare with the Live half of `control-layout-v2.html`: amber data-age bar, two traveller markers, comms log with statuses, sloped lines in the timeline. `npm run build` → succeeds.

---

### Task 10: Offline behaviour, README and full run-through

**Files:**
- Create: `README.md`
- Modify: `scripts/smoke.mjs`, any component the checks below show needs fixing

- [ ] **Step 1: Offline check (Review Focus 2).** Add a second scenario to `scripts/smoke.mjs`: a new context that aborts every request to `trek.nasa.gov` (`context.route('**/trek.nasa.gov/**', r => r.abort())`), opens `/control/`, and asserts `tiles-unavailable` becomes visible while `route-card-safest` still exists and `send-route` still works. Save `.smoke/offline.png`. Run `npm run smoke` → exits 0; the screenshot shows routes on a flat dark background under the message strip.
- [ ] **Step 2: Reload check (Review Focus 1).** Add to the main scenario: after the traveller is moving, reload the Field page and assert `field-status` is `moving` again within 2 s, without pressing Start. Run `npm run smoke` → exits 0.
- [ ] **Step 3: Reduced motion.** In the smoke script open `/field/` once with `reducedMotion: 'reduce'` and assert that no element has a running CSS animation (`document.getAnimations().length === 0`).
- [ ] **Step 4: Rover run.** By hand in two windows: reset, choose Rover, send, start. Expected: Field shows `Speed`, `Battery`, `Tilt`; Control's traveller reads "RV-1 · ROVER"; the route cards show different (shorter) times than for the astronaut.
- [ ] **Step 5: Width check.** Control at 1120, 1366 and 1920 px wide: no overlapping text, no horizontal scroll at 1120 and above. Field at 360, 390 and 430 px: nothing clipped; numbers do not shift sideways while they count.
- [ ] **Step 6:** Write `README.md` for teammates: what the app is; `npm install`, `npm run dev`, `npm test`, `npm run smoke` (needs Edge or Chrome installed and the dev server running), `npm run build` (static site in `out/`); hosting on Vercel or Netlify with `frontend` as the project folder, build command `npm run build`, output folder `out`; **how to present the demo** (two windows, the steps, what to point at, the speed and reset controls); where to change things (colour tokens in `app/tokens.css`, type in `app/layout.tsx`, delay and pace in `lib/mission/types.ts`); **how to plug in real data** (replace what is behind `lib/planner/index.ts`, keeping its function signatures); credits (imagery NASA / JPL-Caltech / USGS via NASA Mars Trek; OpenLayers).
- [ ] **Step 7: Final verification.** `npm test` → all pass. `npm run typecheck` → clean. `npm run build` → export succeeds and `out/` holds `index.html`, `field/index.html`, `control/index.html`. `npm run smoke` → exits 0. `git status --short` (from the repo root) lists changes under `frontend/` only.
