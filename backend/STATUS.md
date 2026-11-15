# Engine status (Person 1, `backend/marsloc`)

Kept current after each stage. Numbers are measured, not targets.
Last update: 2026-11-15, about 03:50 local.

## Where it stands

| Stage | State |
|---|---|
| Terrain layer (three sources, blend band, seam check) | done, tested |
| Horizon renderer | done, tested (0.001° RMS against brute force on the delivered terrain) |
| Stored horizons | rebuilt for the CTX extent: 22,801 candidates, 66 MB, 229 s with 15 workers |
| Matcher | scoring bug fixed, verdicts calibrated in simulation; **weak on real photos**, see below |
| Simulation harness (`scripts/validate_sim.py`) | done; 300-trial base run below |
| Near-field rule | **off by default**; comparison run in progress |
| Real photos (`backend/skyline/scripts/validate.py`) | rerun, before/after below |
| CONTRACTS.md 0.3 (Person 3's four requests) | written; roll fit implemented in the matcher |
| Dominant feature, `/locate` server | not started |
| Matcher end-to-end tests on the real DEM | not written yet (unit tests of the scoring exist) |

## Real photos: before and after (24 rover poses, no prior)

Run with `backend/skyline/scripts/validate.py`; "before" is Person 3's saved run of 00:41 UTC
(`backend/skyline/out/validation.json`), "after" is `backend/reports/validation_real_after.json`.

| | Before | After |
|---|---|---|
| Answers called `ok` | 20 | 4 |
| ... of those within 100 m | 4 | 2 |
| ... of those wrong by more than 1 km | 13 | 0 |
| Truth inside the 68 % circle | 2 of 24 | 19 of 24 |
| Truth inside the 95 % circle | 8 of 24 | 20 of 24 |
| Within 100 m (any verdict) | 4 | 2 |
| Within 400 m (any verdict) | 8 | 9 |
| Median error | 5302 m | 2010 m |
| Median heading error | 3.2° | 2.3° |

What this says, plainly:
- The engine no longer claims `ok` for answers that are kilometres off. That was the worst fault.
- It still **finds** the right place for only about 9 of 24 poses. Most of the rest are reported
  `ambiguous` with a circle of 10–30 km, which is honest but not useful.
- The four `ok` answers are 29 m, 31 m, 324 m and 671 m off. The last two are outside their 95 %
  circles (118 m and 383 m): on real photos the circles are still too small.
- Two `ambiguous` answers have a tiny circle around a wrong place (3/792: 11.7 km off, ±22 m;
  3/1374: 218 m off, ±8 m). The coarse map itself is overconfident there.
- Why real photos are harder than simulation: Person 3's own check ("skyline vs truth", terrain
  further than 2 km) shows the traced skyline differs from the rendered one at the true position
  by a median of 0.05–0.5° with a scatter of 0.03–0.3°. The engine assumes 0.1° noise. 0.06° is
  100 m.

## Simulation (300 photos, one 60° photo each, 0.05° noise correlated along the skyline)

| Within 100 m | Within 300 m | Within 1 km | Median error | `ok` | `ok` and within 300 m | `ok` inside its 95 % circle | `ambiguous` | `no_match` | In 68 % circle | In 95 % circle |
|---|---|---|---|---|---|---|---|---|---|---|
| 52 % | 67 % | 74 % | 96 m | 43 % | 91 % | 96 % | 51 % | 7 % | 77 % | 98 % |

- Time per request in the harness (8 workers, one thread each): 7.3 s. Alone on the machine about 4 s.
- The 95 % circle holds the truth 98 % of the time, the 68 % circle 77 %: slightly cautious.
- `ok` now means something: 91 % of `ok` answers are within 300 m, 95 % within 1 km.
- About a quarter of single 60° photos can't be located at all (wrong by more than 1 km). Those
  are mostly reported `ambiguous` or `no_match`.

## Matcher: what was wrong and what changed tonight

1. **The bug** (a true position lost to a look-alike with a 2–3× worse fit). Cause: the score
   multiplied per-bin Gaussian densities whose width depended on the candidate. A narrow width
   (far terrain) has a tall peak, so far terrain was rewarded by the normalisation itself, and the
   near-field rule added a second penalty. Fix: the per-bin fit has no 1/tolerance factor; a
   perfect fit is worth the same for every bin of every candidate; what can't be judged counts as
   a mediocre fit. Tests: `tests/test_match_score.py` (truth on near terrain beats a far-terrain
   look-alike that fits 2× and 3× worse; a broad tolerance is not a way to win).
2. **Realistic noise changed the picture.** Earlier success rates used noise that was independent
   per sample; it averages away in the matcher's bins. A traced skyline errs smoothly along its
   length. With 0.05° of such noise the coarse stage ranked the true place first only 42 % of the
   time (82 % with independent noise).
3. **Offset fit in the coarse stage.** Candidates are 200 m apart; the shift of every skyline bin
   between a candidate and the true position follows from one unknown offset. Pass 2 now solves
   for it from the stored distances and slopes and scores what is left with a tight tolerance.
   True place ranked first: 42 % → 75 % (40 photos, realistic noise).
4. **Verdicts and circles calibrated** on the harness: `ok` needs a good fit (at most 1.2
   tolerances rms), full support (90 % of the usable skyline counts), a clear lead (60 % of the
   likelihood, no rival with half as much) and half the field of view usable. Bins are taken to
   err together over 3°. A fit worse than the noise settings promise widens the circles.
5. Near-field rule and DEM height error are off by default.

## Next, in order

1. Near-field rule: read the comparison run, decide the default.
2. Real photos: find out why 15 of 24 poses are not found (first check: is the true place among
   the coarse candidates, as in simulation, or lost there?). Likely levers: the assumed angle
   noise, the horizon shift limit, more photos per pose.
3. End-to-end matcher tests on the real DEM.
4. Dominant feature, then the `/locate` server with Person 3's `/skyline` router.

## Notes for the team

- Person 3's `validate.py` calls `Matcher.locate` directly; the interface is unchanged.
  `Candidate` has three new fields: `fit_z`, `support`, `coverage`. `PhotoObservation` accepts
  `roll_uncertainty_deg`; `PhotoFit` has `horizon_tilt_deg`.
- CONTRACTS.md is at 0.3; requests marked 0.1, 0.2 or 0.3 are accepted. Section 4 untouched.
- The stored horizons' fingerprint no longer depends on the contract version (it did, which made
  them look stale after the 0.3 edit; the terrain files were unchanged, so I re-stamped them).
