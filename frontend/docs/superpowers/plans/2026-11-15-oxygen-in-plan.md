# Oxygen and battery in the mission plan: Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Route cards, reroutes and the crew HUD account for suit oxygen (or rover battery); a reroute that would end below the reserve shows Control an OXYGEN CHECK card with options instead of being sent.

**Architecture:** Pure cost functions in `lib/mission/lifeSupport.ts`; Control's projection and option ranking in `components/control/controlModel.ts`; the screens only render what those return. Control's view is `SIGNAL_DELAY_MS` old, so every projection starts from `view.received`.

**Tech Stack:** Next.js / React / TypeScript, vitest.

**Spec:** `frontend/docs/superpowers/specs/2026-11-15-oxygen-in-plan-design.md`

## Global Constraints

- Only `frontend/` changes. No backend, no change to the mission event format beyond existing event types.
- `RESERVE_PERCENT = 20`. One-way trip: arriving is safe; no round-trip planning.
- The app never sends a route on its own: an OXYGEN CHECK waits for Control's click.
- Labels: `O₂ AT END` / `BATTERY AT END` on cards; `≈ N % AT ARRIVAL` (Live), `≈ N % AT END` (Field); below 0 shows `WON'T REACH`, never a negative number.
- Amber (`caution`) below the reserve, red (`danger`) below 0.
- Turn-back message to the crew (≤ 140 chars): `Turning back to the start: not enough oxygen to reach the destination with a 20 % reserve.` (battery wording for the rover).

## Review Focus

1. Rover selected: everything says BATTERY and uses battery figures.
2. Traveller holding when Control reroutes: the time until the new route lands is costed as resting, not walking.
3. Reroute too late / too close: existing notices win; no OXYGEN CHECK.
4. Replanning back to the start fails (no path): the Turn back option is left out, not shown broken.
5. Minutes pass while the OXYGEN CHECK card is open: options are recomputed on click; if a reroute is no longer possible, the existing notice shows.

---

### Task 1: Cost model

**Files:** Modify `lib/mission/lifeSupport.ts`; Test `lib/mission/lifeSupport.test.ts`

**Interfaces — Produces:**
- `export const RESERVE_PERCENT = 20`
- `export function costPercent(traveller: TravellerKind, movedM: number, restMs: number): number` — percent of tank/battery for moving `movedM` at `PACE_MPS[traveller]` plus resting `restMs` (walking/driving and resting/idle figures already in the file).
- `export function routeEndPercent(route: Route, traveller: TravellerKind): number` — `100 - costPercent(traveller, route.lengthM, 0)` (may be negative).
- `export function arrivalPercent(state: FieldState): number | null` — `lifeSupportAt(state).percent - costPercent(traveller, route.lengthM - distM, 0)`; null without traveller or route. Unclamped.
- `export function lifeTone(percent: number): 'plain' | 'caution' | 'danger'` — danger < 0, caution < RESERVE_PERCENT.
- Refactor `lifeSupportAt` to use `costPercent` (same results).

- [ ] **Step 1: Failing tests** in `lifeSupport.test.ts`:
  - `costPercent('astronaut', 1000, 0)` ≈ 5.83 (`toBeCloseTo(5.83, 2)`); `costPercent('astronaut', 0, 3_600_000)` ≈ 5.53; `costPercent('rover', 1000, 0)` ≈ 2.80; `costPercent('rover', 0, 3_600_000)` ≈ 1.67.
  - `routeEndPercent({ lengthM: 10_000 } as Route, 'astronaut')` ≈ 41.7.
  - `arrivalPercent` of a moving astronaut 1000 m along a 3000 m route equals `lifeSupportAt(s).percent - costPercent('astronaut', 2000, 0)`; null when `route` is null.
  - `lifeTone(-1) === 'danger'`, `lifeTone(19.9) === 'caution'`, `lifeTone(20) === 'plain'`.
  - Existing lifeSupport tests stay green.
- [ ] **Step 2:** `npx vitest run lib/mission/lifeSupport.test.ts` → FAIL (not exported).
- [ ] **Step 3:** Implement the five exports above.
- [ ] **Step 4:** Same command → PASS.
- [ ] **Step 5:** Commit `Oxygen: cost model for routes (percent per km and per hour, 20 % reserve)`.

### Task 2: Control projection and OXYGEN CHECK options

**Files:** Modify `components/control/controlModel.ts`; Test `components/control/controlModel.live.test.ts` (reuse its log/view helpers)

**Interfaces — Consumes:** Task 1. **Produces:**
- `export function branchPercent(view: ControlView): number | null` — received percent (`lifeSupportAt(view.received)`) minus cost from the received state to when a signal sent now lands: moving → `costPercent(t, predictBranchDistM(view) - view.received.distM, 0)`; otherwise → `costPercent(t, 0, 2 * SIGNAL_DELAY_MS)`.
- `export function projectedArrivalPercent(view: ControlView): number | null` — received percent minus cost to `estimatedNow` (moving: walked distance; holding: rest `SIGNAL_DELAY_MS`) minus the rest of the newest route from there.
- `export type RerouteOption = { kind: 'around' | 'back' | 'anyway'; route: Route; hazards: Hazard[]; endPercent: number; keepsReserve: boolean }`
- `export type OxygenCheck = { options: RerouteOption[]; pick: RerouteOption['kind']; noneKeeps: boolean }`
- `export function planReroute(view: ControlView, newHazard: Hazard | null): { send: RerouteOption } | { check: OxygenCheck } | null` — null exactly when `buildReroute` is null. `anyway` = `buildReroute` result. If it keeps the reserve → `{ send }`. Else build `around` = best `endPercent` of the tail replanned with each of `safest | shortest | flattest` (same splice as `buildReroute`), and `back` = `replan(branch, newest.points[0], hazards, newest.profile)` spliced (omitted if null). `endPercent = branchPercent(view) - costPercent(t, route.lengthM - branchDistM, 0)`. Pick: `around` if it keeps; else `back` if it keeps; else highest `endPercent` with `noneKeeps: true`. `anyway` is listed only if it differs from `around`'s route id.

- [ ] **Step 1: Failing tests:**
  - Holding view: `received percent - branchPercent(view)` equals `costPercent('astronaut', 0, 2 * SIGNAL_DELAY_MS)`.
  - Short demo reroute on a fresh mission → `'send' in planReroute(...)`.
  - Same reroute with the received oxygen forced low (log where the astronaut has walked/held long enough that `endPercent < 20`; or stub via a long route) → `'check' in result`, `result.check.options.map(o => o.kind)` contains `'around'`; options' `endPercent` < 20 for `anyway`.
  - A case where only `back` keeps the reserve → `pick === 'back'`.
  - Too-late view → `planReroute` returns null.
- [ ] **Step 2:** `npx vitest run components/control` → FAIL.
- [ ] **Step 3:** Implement. Keep `buildReroute` as is (callers unchanged).
- [ ] **Step 4:** Same command → PASS.
- [ ] **Step 5:** Commit `Control: oxygen projection and OXYGEN CHECK options for reroutes`.

### Task 3: Screens

**Files:** Modify `components/control/PlanRail.tsx`, `components/control/LiveRail.tsx`, `components/control/ControlScreen.tsx`, `components/control/control.module.css`, `components/field/NextMoveBand.tsx`, `components/field/FieldScreen.tsx`, `components/field/field.module.css`

**Interfaces — Consumes:** Tasks 1–2.

- [ ] **Step 1: Plan cards.** `RouteCard`: fourth `Readout` label `O₂ at end` / `Battery at end`, value `${Math.round(p)} %` or `WON'T REACH`, tone from `lifeTone`. `.cardStats` → 4 columns. Send button disabled (with note `NOT ENOUGH OXYGEN TO REACH THE END` / battery) when the selected route's `routeEndPercent < 0`.
- [ ] **Step 2: Live rail line.** Under Progress: `OXYGEN 71 % · ≈ 34 % AT ARRIVAL` (received percent, `projectedArrivalPercent`), arrival part toned by `lifeTone`; hidden before data.
- [ ] **Step 3: Reroute flow.** `ControlScreen.reroute`: use `planReroute`. `send` → append `route-changed` as today. `check` → keep `{ hazard }` in state and pass `check` to `LiveRail`. `LiveRail` Act section renders card `data-testid="oxygen-check"`: title `OXYGEN CHECK`, one line why (`This route ends at ≈ 12 % · reserve is 20 %` or `None keeps the 20 % reserve`), one button per option (`GO AROUND · ≈ N %`, `TURN BACK · ≈ N %`, `SEND ANYWAY · ≈ N %`), pick marked `RECOMMENDED`, plus `CANCEL`. On click: recompute `planReroute` with the kept hazard; send the chosen kind's route (`reason: 'hazard'` if hazard else `'replan'`); for `back` also append the turn-back `message`. If recompute returns null, show the existing notice.
- [ ] **Step 4: Field line.** `NextMoveBand` gets `arrival: number | null`; `LifeCell` shows a second note `≈ N % AT END` (or `WON'T REACH`) toned by `lifeTone`. `FieldScreen` passes `arrivalPercent(state)` when hydrated.
- [ ] **Step 5:** `npm run typecheck` and `npx vitest run` → all pass.
- [ ] **Step 6: Browser.** `/control/`: cards show O₂ AT END; move the end far away until a card turns red and Send disables. Send a route, flag a danger → reroute sent normally. With rate raised so oxygen is low, flag a danger → OXYGEN CHECK appears; pick an option → route changes. `/field/` shows the AT END line. Check phone width (375 px) for the cards and the HUD.
- [ ] **Step 7:** Commit `Plan, Live and Field show oxygen at the end; OXYGEN CHECK on low-oxygen reroutes`; `git pull --rebase`; push to main.
