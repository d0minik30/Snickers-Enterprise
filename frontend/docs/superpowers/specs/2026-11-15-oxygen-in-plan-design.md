# Oxygen and battery in the mission plan

**Date:** 2026-11-15 · **Status:** approved · **Scope:** `frontend/` only

## Why

The crew screen shows simulated suit oxygen (astronaut) or battery (rover), worked out from what was
used so far (`lib/mission/lifeSupport.ts`). Nothing in planning knows about it. Oxygen is the real limit:
walking uses about 22 L/km from a 380 L tank, so the default trip to the Western Delta (at least 9.6 km)
costs over half the tank, and a reroute costs extra twice: the longer route and the ~23 min round trip
of the signal while the crew keeps breathing. Control should see whether a route or a reroute can be
finished, and when it can't, the app works out the options and Control decides.

## Goals

- Route cards say what is left on arrival.
- A reroute that would end below the reserve is not sent silently: Control gets the options, with the
  app's pick.
- Field sees the expected oxygen at arrival.

## Non-goals and anti-goals

- No backend change; no round-trip planning (the demo trip is one way; arriving is safe).
- The app never sends a route on its own: Control picks.
- No clutter: one number per card, one line per screen, one card only when there is a decision.

## Approaches considered

- **A. Control decides, the app works out the options (picked).** Keeps a human in the loop, fits the
  11 min 20 s delay story.
- B. The app picks and sends a fallback itself: faster, but overrules the operator in the demo.
- C. Warnings only: least work, but does not answer "what comes next".

## Design

**Model** (`lib/mission/lifeSupport.ts`)
- `RESERVE_PERCENT = 20`.
- Cost in percent of the tank (or battery) for moving `m` metres and resting `ms`, using the same
  breathing / power figures as the readout.
- Control's picture is old by `SIGNAL_DELAY_MS`: it projects from the received state through the delay,
  then to when a new route can land (`predictBranchDistM`), then along the rest of the route, at the
  current activity (walking or holding).

**Plan screen** (route cards): a fourth readout **O₂ AT END** / **BATTERY AT END** from a full tank.
Amber below the reserve, red below 0 ("WON'T REACH"). Send is blocked only for red.

**Live screen**
- "What we know": one line, `OXYGEN 71 % · ≈ 34 % AT ARRIVAL` (projected, on the newest route).
- Reroute (flag a danger, or plan a new route from here): if the new route keeps the reserve, it is sent
  as today. Otherwise nothing is sent and an **OXYGEN CHECK** card lists up to three options, the app's
  pick marked:
  1. **Go around**: the replanned tail (all three profiles tried) that leaves the most oxygen.
  2. **Turn back**: a route from the branch point back to the trip's start, sent with a short message to
     the crew saying why.
  3. **Send anyway**: the original reroute, showing how far under the reserve it ends.
- Pick: the first way to the destination that keeps the reserve; else turning back if it keeps it; else
  the option that leaves the most, saying that none keeps the reserve.

**Field screen**: one line under OXYGEN / BATTERY, `≈ 34 % AT END`, amber below the reserve.

## Left to the builder

Exact wording and styling within the existing control and field styles; test coverage of the cost model
and the option ranking.
