# Frontend brief: show the engine's output faithfully

**For:** Person 3 (frontend) and their coding agents. **From:** Person 1 (engine). **Date:** 2026-11-15.
**Read first:** `WORKFLOW_ARCHITECTURE.md` (the pipeline), `backend/CONTRACTS.md` section 3 (the result format, the authority).

## Goal

The app must show what the engine actually returns: the fix *and* how sure it is. Never show a
position as certain when the engine says it isn't, and never invent a number the engine did not send.

## Rules for the agent

- Work only in `frontend/`. `backend/`, `backend/skyline/` engine code and `data/` are read-only.
- Do not change the result format. If the app needs something the engine doesn't send, write it
  down under "Requests to the engine" at the end of your report; don't work around it.
- Keep the names of the pipeline stages as in the slide diagram (`architecture_workflow.svg`):
  Surface Photo, Skyline Extraction, Coarse Search, Fine Search, Position Fix & Uncertainty,
  Locate Screen & Map, Field HUD & Control. Use them in any progress text or help text.
- Verify with `npm test`, `npm run typecheck`, and in the browser (see "How to verify").

## The pipeline, as the app sees it

| Stage | Endpoint | What the app does |
|---|---|---|
| Surface Photo | — | user picks photos on `/locate` or in the "find me" panel of `/map` |
| Skyline Extraction | `POST /skyline`, `POST /skyline/convert` | shows the traced line; untrusted stretches (`trace.reason`) look different |
| Coarse Search → Fine Search | `POST /locate` | one request; show progress, the server takes about 4–6 s per photo |
| Position Fix & Uncertainty | `POST /locate` response | everything in the next section |
| Locate Screen & Map | `/locate`, `/map` | draws the result |
| Field HUD & Control | `/field`, `/control` | a photo fix resets the drift ring; Control sees it 11 min 20 s later |

## What the result means (`POST /locate`, `frontend/lib/locate/types.ts`)

| Field | Meaning | The app must |
|---|---|---|
| `status` | `ok`, `ambiguous` (another place fits nearly as well) or `no_match` (nothing fits: the point is only the least bad) | show it before the position, in words, everywhere a fix appears |
| `warnings[]` | plain-English problems (flat skyline, much of the line ignored, level off) | show all of them, unchanged |
| `best.lat/lon`, `east_m/north_m` | the fix | draw it |
| `best.uncertainty_m` / `uncertainty_95_m` | radius holding 68 % / 95 % of the likelihood | draw both circles; quote "± X m" from the 95 % one |
| `best.heading_deg` | direction photo 1 faced, clockwise from north | draw the view wedge |
| `best.score` | share of the trusted skyline that fits | may show as "skyline fit" |
| `best.probability` | this place's share of the likelihood | may show; it is not "accuracy" |
| `candidates[]` | other separate places, most likely first; `[0]` is `best` | show them, at least when `status != ok` |
| `likelihood_grid` | heat map, values 0..`scale`, may be `null` | draw when present |
| `dominant_feature` | most prominent distant peak of the matched skyline; may be `null`; `name` may be `null` | "Unnamed terrain" for a null name; say nothing when null |
| `photos[]` | per-photo fit (heading, residuals) | optional detail |

**Any number may be `null`.** The engine writes `null` for a value it can't compute (NaN or
infinite), for example `best.ground_elevation_m` off the terrain or `dominant_feature.distance_check_m`
when the angle can't be explained. The TypeScript types say `number`; they should say `number | null`
where this can happen, and the UI must show "—" instead of a made-up value.

## Acceptance checklist

Each item: check it, fix it if it fails, and say which in your report.

### Locate screen (`components/locate/ResultView.tsx`)
- [ ] `ok`, `ambiguous` and `no_match` each look different and say what they mean (already done; keep).
- [ ] **Bug:** `GROUND HEIGHT` shows `0 m` when `ground_elevation_m` is `null` (`Math.round(null)`). Show "—".
- [ ] **Bug:** with `distance_check_m` `null` the text "The distance check disagrees" appears
      (`distance_m - null` is `distance_m`). Only compare when both are numbers.
- [ ] Both circles (68 % and 95 %), the other candidates and all `warnings` are shown (already
      done; keep).

### Jezero map "find me" (`components/jezero/FindMe.tsx`)
- [ ] For `no_match`, the "Accurate to ± X" line is hidden or says the number can't be trusted.
- [ ] For `ambiguous`, the other candidates are visible on the map (today only the best point and
      one circle are drawn).
- [ ] `warnings` are shown (today they are not).

### Validation of the response (`lib/locate/types.ts`, `isLocateResult`)
- [ ] A result with `null` in a field the UI can do without (`ground_elevation_m`,
      `distance_check_m`, `photos[].rms_residual_deg`, …) is accepted, not rejected as malformed.
- [ ] A result with `null` in `best.uncertainty_m` / `uncertainty_95_m` is still rejected, or
      shown with "uncertainty unknown" and no circle. Pick one and say which.
- [ ] Types match the engine: `photos[].horizon_tilt_deg` exists; nullable fields are `| null`.

### Field HUD & Control (`components/field/`, `lib/mission/`, `lib/planner/drift.ts`)
- [ ] Today the "photo fix" is a button that resets the drift ring to a fixed 47 m
      (`PHOTO_FIX_ERROR_M`), whatever the engine said. Decide with the team, then either:
      (a) keep it as a demo shortcut and label it so, or
      (b) send the engine result with the `photo-fix` event (position, `uncertainty_95_m`, `status`),
      use `uncertainty_95_m` as the ring size, and don't reset the ring on `no_match`.
- [ ] Control shows the fix only after the 11 min 20 s delay, and labels it as a photo fix (`FIX`).

## How to verify

```
backend/.venv/Scripts/python -m uvicorn marsloc.api:app --port 8000   # from backend/
npm run dev                                                           # from frontend/, port 3000
npm test && npm run typecheck                                         # from frontend/
```

Open `http://localhost:3000/locate/` and send one real photo with its label file. To test
`ambiguous`, `no_match` and `null` fields without the server, add fixtures next to
`lib/locate/fixtures/engine-pose3-770.json` (copy it, then change `status`, set fields to `null`)
and cover them in `lib/locate/*.test.ts`.

## Report back

One list: each checklist item as passed, fixed (file and line) or not done (why), plus any
"Requests to the engine".
