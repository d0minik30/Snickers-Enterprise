# Engine status (Person 1, `backend/marsloc`)

Kept current after each stage. Numbers are measured, not targets.
Last update: 2026-11-15, 08:30 local.

## Handoff: how to continue in a new session

Everything of the engine is committed and pushed to `main`. To pick up:

1. Read this file, `backend/CONTRACTS.md` and `backend/README.md`. Rules: work only in `backend/`
   (not `backend/skyline/`, `frontend/`, `data/`); stage files by path; `git pull --rebase`, push.
2. Check the state: from `backend/`, `.venv\Scripts\python -m pytest` (131 pass, about 2 min).
3. Open work, most important first:
   - **App ↔ server:** see "App's Locate screen" below for what was tried and what is left.
   - **Real photos (16 of 24 poses not found):** needs Person 3. Seven poses have the up/down
     shift at the ±0.3° limit (levelling), and site-3 truth headings are off by +0.7–0.9°. After
     their fix rerun `backend/skyline/scripts/validate.py` (write the output to `backend/reports/`,
     not over their file) and update the table below.
   - **Circles too small** with several photos (hold 82–84 % instead of 95 %) and on real photos.
     Where: `radius_for_mass` in `marsloc/match/likelihood.py`, the widening by
     `fit_z/expected_fit_z` in `marsloc/match/matcher.py`. Measure with
     `scripts/validate_sim.py --sets three pano --workers 8`.
   - **Speed:** second coarse pass is 2.2 s of a 3.7 s single-photo request
     (`CoarseIndex.likelihood` in `marsloc/match/coarse.py`).
   - **Speed rule lost real pose 3/828** (`prefilter_full_deg` in `MatcherConfig`); revisit after
     Person 3's fixes.
   - Optional, never started: `.ply` export of the terrain for viewing.

## Where it stands

| Stage | State |
|---|---|
| Terrain layer (three sources, blend band, seam check) | done, tested |
| Horizon renderer | done, tested (0.001° RMS against brute force on the delivered terrain) |
| Stored horizons | built for the CTX extent: 22,801 candidates, 66 MB, 229 s with 15 workers |
| Matcher | scoring bug fixed, verdicts calibrated in simulation, tested; **weak on real photos**, see below |
| Dominant feature (`marsloc/feature.py`) | done, tested |
| Server (`marsloc/api.py`): `POST /locate`, `GET /health`, Person 3's `/skyline` routes | done, tested, run for real once |
| Simulation harness (`scripts/validate_sim.py`) | done; results below |
| Near-field rule | decided: **stays off** (no benefit measured) |
| CONTRACTS.md 0.3 (Person 3's four requests) | written and implemented |
| Tests | 131 pass (`.venv\Scripts\python -m pytest`), about 2 minutes |

## How to run the server

From `backend/`: `.venv\Scripts\python -m uvicorn marsloc.api:app --port 8000`

- `GET /health` says whether the terrain and the stored horizons loaded.
- Checked for real: a three-photo Navcam request (sol 20, pose 3/770) returned HTTP 200, verdict
  `ok`, ±56 m / ±90 m, 39 m from the true position, and a dominant feature 10.7 km away whose two
  distance estimates agree to 3 m.
- **Time per request on an idle machine** (server start: 1.4 s):

  | Request | Time |
  |---|---|
  | one 60° photo | 3.7 s |
  | one 120° photo | 3.9 s |
  | three 60° photos | 6.1 s |
  | 360° panorama | 8.7 s |
  | real request, three Navcam photos | 7.6 s |

  One photo meets "a few seconds"; several photos take 6–9 s. The largest part of a single-photo
  request is the second pass of the coarse search (2.2 s). Requests with a lot of skyline keep
  fewer candidates after the first pass and are refined with wider-spaced rays; without that rule
  the real three-photo request took 31 s (measured while a harness run used 8 cores). The rule
  changes nothing in simulation (table below) but lost one real pose (3/828, below).

## Real photos (24 rover poses, no prior)

Run with `backend/skyline/scripts/validate.py`. "Before" is Person 3's saved run of 00:41 UTC
(`backend/skyline/out/validation.json`); "now" is `backend/reports/validation_real_after2.json`
(I did not overwrite Person 3's file or the app's copy).

| | Before | Now |
|---|---|---|
| Answers called `ok` | 20 | 4 |
| ... of those within 100 m | 4 | 2 |
| ... of those wrong by more than 1 km | 12 | 0 |
| Truth inside the 68 % circle | 2 of 24 | 18 of 24 |
| Truth inside the 95 % circle | 8 of 24 | 19 of 24 |
| Within 100 m (any verdict) | 4 | 2 |
| Within 400 m (any verdict) | 8 | 8 |
| Median error | 5302 m | 3844 m |

What this says, plainly:
- The engine no longer claims `ok` for answers that are kilometres off. That was the worst fault.
- It still **finds** the right place for only 8 of 24 poses. Most of the rest are reported
  `ambiguous` with a circle of 10–30 km, which is honest but not useful.
- The four `ok` answers are 39 m, 31 m, 330 m and 671 m off. The last two are outside their 95 %
  circles (114 m and 386 m): on real photos the circles are still too small.
- Two `ambiguous` answers have a tiny circle around a wrong place (3/792: 11.7 km off, ±23 m;
  3/1374: 218 m off, ±8 m).
- The speed rule cost one pose: 3/828 was 222 m off before it and is 10.5 km off now (`ambiguous`
  both times). Its photos do not fit at the true position, so it was found by luck.

### Why 16 poses are not found (checked case by case)

I scored every pose AT its true position with its true headings:

- **8 poses fit well there** (the trusted skyline misses by less than 1 tolerance): 3/770, 3/1044,
  3/1708, 3/1950, 3/2046, 3/2150, 6/1752, 7/1172. For 7 of them the coarse stage ranks the true
  place in its top three and the answer is 31–382 m off. So where the input is good, the engine
  works, to a few hundred metres.
- **16 poses do not fit at the true position** within the assumed 0.1° (they miss by 1.1–2.6
  tolerances, 0.09–0.28° rms). The engine cannot prefer a place where the photo does not match.
- In **7 poses the fitted up/down shift sits at its ±0.3° limit** (3/1266, 19/1126, 33/366, 51/644,
  61/0, 66/0, 82/0), and Person 3's own check shows the far skyline off by 0.36–0.57° there. The
  photo's "horizontal" is further off than `horizon_uncertainty_deg: 0.3` says. The engine now
  warns when a shift is at its limit. **For Person 3:** raise the value for these sols or check the
  levelling (the review mentions a possible attitude-quaternion direction issue).
- At the true position my best-fit heading differs from the "true heading" by a steady +0.7 to
  +0.9° in nearly every site-3 pose. **For Person 3:** that looks like a constant offset in the
  truth headings or in the camera model, not noise.
- Three poses (33/366, 61/0, 66/0) have a skyline formed entirely by terrain closer than 1.5 km.

## Simulation (300 photos per row, one 60° photo each, noise correlated along the skyline)

Positions are random over the crater floor, the delta and the western rim area.

| Set | Within 100 m | Within 300 m | Within 1 km | Median error | `ok` | `ok`: within 300 m | `ok`: inside its 95 % circle | `ambiguous` | `no_match` | In 68 % circle | In 95 % circle |
|---|---|---|---|---|---|---|---|---|---|---|---|
| base: 0.05° noise | 52 % | 67 % | 74 % | 96 m | 43 % | 91 % | 96 % | 51 % | 7 % | 77 % | 98 % |
| near-field rule on | 50 % | 64 % | 72 % | 100 m | 37 % | 95 % | 95 % | 62 % | 1 % | 76 % | 96 % |
| 2 m DEM roughness | 45 % | 59 % | 70 % | 126 m | 33 % | 93 % | 96 % | 45 % | 22 % | 83 % | 97 % |
| 2 m roughness, near-field rule on | 44 % | 58 % | 69 % | 149 m | 30 % | 94 % | 97 % | 58 % | 12 % | 82 % | 98 % |
| 2 m roughness, engine told of a 2 m DEM error | 46 % | 60 % | 72 % | 124 m | 24 % | 96 % | 99 % | 64 % | 12 % | 88 % | 99 % |

- **Near-field rule: stays off.** With 2 m of roughness it changes "within 300 m" from 59 % to 58 %
  and the median error from 126 m to 149 m, and makes fewer answers `ok`. Differences of 1–3 points
  are within the noise of 300 trials; there is no benefit to show. The rule (`near_field_m`,
  `near_weight`) and the DEM error (`dem_height_error_m`) remain configurable in `MatcherConfig`.
- **Confidence is honest in simulation:** the 95 % circle holds the truth 96–99 % of the time, the
  68 % circle 76–88 % (slightly cautious). 91–96 % of `ok` answers are within 300 m.
- About a quarter of single 60° photos can't be located (wrong by more than 1 km); those are
  nearly all reported `ambiguous` or `no_match`.

### More skyline, and more trouble (200 photos per row)

| Set | Within 100 m | Within 300 m | Median error | `ok` | `ok`: within 300 m | In 95 % circle |
|---|---|---|---|---|---|---|
| one 60° photo (base, 300 trials) | 52 % | 67 % | 96 m | 43 % | 91 % | 98 % |
| one 120° photo | 71 % | 77 % | 22 m | 68 % | 98 % | 92 % |
| three 60° photos, known relative headings | 88 % | 92 % | 6 m | 70 % | 100 % | 83 % |
| 360° panorama | 90 % | 94 % | 2 m | 72 % | 100 % | 84 % |
| three photos, with the speed rule | 87 % | 92 % | 6 m | 70 % | 100 % | 82 % |
| one 120° photo, with the speed rule | 70 % | 76 % | 23 m | 68 % | 98 % | 91 % |
| 0.1° noise instead of 0.05° | 36 % | 52 % | 263 m | 20 % | 95 % | 100 % |
| 2 unflagged rocks and a gap | 42 % | 54 % | 185 m | 16 % | 100 % | 100 % |
| 0.3° pitch error, declared as ±0.5° | 33 % | 44 % | 988 m | 30 % | 86 % | 98 % |

- **More skyline is the biggest lever.** Three photos or a panorama: about 90 % within 100 m, and
  every `ok` answer within 300 m.
- With several photos the 95 % circle holds the truth only 82–84 % of the time: too small there.
- Angle noise of 0.1°, unflagged rocks and an undeclared horizontal each roughly halve what one
  photo can do. A pitch error is the worst: allowing ±0.5° of shift makes many places fit.

## Matcher: what was wrong and what changed

1. **The bug** (a true position lost to a look-alike with a 2–3× worse fit). Cause: the score
   multiplied per-bin Gaussian densities whose width depended on the candidate. A narrow width
   (far terrain) has a tall peak, so far terrain was rewarded by the normalisation itself, and the
   near-field rule added a second penalty. Fix: the per-bin fit has no 1/tolerance factor; a
   perfect fit is worth the same for every bin of every candidate; what can't be judged counts as
   a mediocre fit. Tests: `tests/test_match_score.py` and `tests/test_match_locate.py`.
2. **Realistic noise changed the picture.** Earlier success rates used noise that was independent
   per sample; it averages away in the matcher's bins. With 0.05° of noise that varies smoothly
   along the skyline the coarse stage ranked the true place first only 42 % of the time.
3. **Offset fit in the coarse stage.** The shift of every skyline bin between a 200 m candidate and
   the true position follows from one unknown offset. Pass 2 solves for it from the stored
   distances and slopes. True place ranked first: 42 % → 75 %.
4. **Verdicts and circles calibrated** on the harness: `ok` needs a good fit (at most 1.2
   tolerances rms), full support (90 % of the usable skyline counts), a clear lead (60 % of the
   likelihood, no rival with half as much) and half the field of view usable. A fit worse than the
   noise settings promise widens the circles.

## Next, in order

1. Real photos: with Person 3, sort out the horizontal (shift at its limit in 7 poses) and the
   0.8° heading offset, then rerun. More photos per pose would help most (see the table above).
2. Make the circles hold with several photos (82–84 % instead of 95 %) and on real photos.
3. Cut the second coarse pass (2.2 s of a 3.7 s single-photo request).
4. Point the app at the server and try the Locate screen end to end (not done from my side).

## Notes for the team

- Person 3's `validate.py` and `engine_result.py` call `Matcher.locate` directly; that interface
  is unchanged. `marsloc/engine.py` now does the same job as `engine_result.result_json` and also
  fills `dominant_feature`.
- CONTRACTS.md is at 0.3; requests marked 0.1, 0.2 or 0.3 are accepted. Section 4 untouched.
- `/health` also returns `skyline_routes` (true when the `/skyline` routes loaded) and `detail`
  (why the engine is not ready). `engine` in the result also carries `contract_version`.
- `python-multipart` and `Pillow` are in `backend/requirements.txt` for the `/skyline` routes.
