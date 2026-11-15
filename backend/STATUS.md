# Engine status (Person 1, `backend/marsloc`)

Kept current after each stage. Newest first. Numbers are measured, not targets.

## Where it stands

| Stage | State |
|---|---|
| Terrain layer (three sources, blend band, seam check) | done, tested |
| Horizon renderer | done, tested (0.001° RMS against brute force on the delivered terrain) |
| Stored horizons | rebuilt for the CTX extent: 22,801 candidates, 66 MB, 229 s with 15 workers |
| Matcher | scoring bug fixed; **not validated yet**, see below |
| Simulation harness (`scripts/validate_sim.py`) | written; first 300-trial run in progress |
| Honest confidence (calibration, verdict) | in progress |
| Real photos (`backend/skyline/scripts/validate.py`) | not rerun yet |
| Dominant feature, `/locate` server, CONTRACTS.md changes from Person 3's review | not started |

## Matcher: what was wrong and what changed

1. **The bug** (a true position lost to a look-alike with a 2–3× worse fit). Cause: the score
   multiplied per-bin Gaussian densities whose width depended on the candidate. A narrow width
   (far terrain) has a tall peak, so far terrain was rewarded by the normalisation itself, and the
   near-field rule added a second penalty. Fix: the per-bin fit has no 1/tolerance factor; a
   perfect fit is worth the same for every bin of every candidate; what can't be judged counts as
   a mediocre fit. Tests: `tests/test_match_score.py` (truth on near terrain beats a far-terrain
   look-alike that fits 2× and 3× worse; a broad tolerance is not a way to win).
2. **Realistic noise changed the picture.** My earlier success rates used noise that was independent
   per sample; it averages away in the matcher's bins. A traced skyline errs smoothly along its
   length. With 0.05° of such noise the coarse stage ranked the true place first only 42 % of the
   time (82 % with independent noise).
3. **Offset fit in the coarse stage.** Candidates are 200 m apart; the shift of every skyline bin
   between a candidate and the true position follows from one unknown offset. Pass 2 now solves
   for it from the stored distances and slopes and scores what is left with a tight tolerance.
   True place ranked first: 42 % → 75 % (40 photos, realistic noise).
4. Near-field rule and DEM height error are **off by default** until the harness decides.

## Measured so far (small samples, to be replaced by the harness)

- 40 simulated photos, one 60° photo each, 0.05° correlated noise: 48 % within 100 m, median 115 m.
- Many answers are 100–400 m off with a good fit: that is about what 0.05° of correlated error
  allows (the far skyline moves about 0.06° per 100 m). The 95 % circles were too small there
  (held the truth 52 % of the time): calibration pending.
- Most large misses are flagged `no_match`; 2 of 40 were still reported `ok`.
- `/locate`-equivalent time: about 3.8 s per request (92 live renders).

## Open points for the team

- Person 3's `validate.py` calls `Matcher.locate` directly; the interface is unchanged.
- `Candidate` has three new fields: `fit_z`, `support`, `coverage`.
