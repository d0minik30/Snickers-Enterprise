# Good morning: handover for the next shift

> **For the colleague (and your Claude) starting around 06:30 on 15 Nov 2026.** This file is kept up to
> date overnight by the coordinator session until 07:00. Read it first, then `SYSTEM_REFERENCE.md`
> (corrected tonight to match reality), then `backend/STATUS.md` (the engine's own status, if present)
> and `backend/CONTRACTS.md` (the formats between the three parts).

Last updated: **15 Nov, 03:15 local**.

---

## 1. The project in 30 seconds

NASA Space Apps 2026, *"Interplanetary Survival Guide: Martian Map"*, region **Jezero Crater**.
An astronaut photographs the skyline; we find where they stand by matching that skyline against
orbital elevation data. Three parts, three owners:

| Part | Folder | Owner | Job |
|---|---|---|---|
| Data | `data/` | Person 2 | Terrain (HiRISE 1 m, CTX 20 m, MOLA-HRSC 200 m), overlays, test photos with true positions |
| Photo + app | `backend/skyline/`, `frontend/` | Person 3 | Photo → skyline angles; the website (Field, Control, Jezero map, Locate, Validate) |
| Engine | `backend/marsloc/` (+ `backend/scripts`, `backend/tests`) | Person 1 | Skyline + terrain → position, heading, distance, uncertainty |

Each person treats the other folders as read-only. Shared files (`SYSTEM_REFERENCE.md`,
`backend/CONTRACTS.md`, this file) change only in the agreed sections.

---

## 2. State at a glance

| Component | State |
|---|---|
| Terrain (80 × 80 km+, three levels) | **Done.** `backend/data_local/terrain/` (git-ignored; rebuild with `data/scripts/fetch_terrain.py`). Blend band at source edges (contract v0.2) |
| Horizon renderer | **Done, verified** (agrees with a brute-force reference to ~0.001–0.006°) |
| Stored horizons | **Rebuilt tonight** on the new terrain: CTX extent, 22,801 candidates, 66 MB, `backend/cache/horizons_200m_0.5deg/` |
| Photo → skyline (`backend/skyline/`) | **Works on most photos** (0.1–0.3° from the terrain at the truth). Weak where rover hardware or nearby rocks aren't caught (poses 3/1374, 3/2150, 3/2430) |
| Test photos | **Consolidated tonight** into one slim list, `data/test_photos/manifest.json` (24 poses, 38 photos); requests are generated, not committed |
| **Matcher (the engine's core)** | **Scoring bug fixed, confidence calibrated on simulation (03:12).** Not yet re-validated on real photos. See section 4 and `backend/STATUS.md` |
| `POST /locate` HTTP server | **Not built.** Only `backend/skyline/scripts/dev_server.py` (`/skyline`, `/health`). The app shows saved engine results |
| Website | Works: `/field`, `/control`, `/map`, `/locate` (saved result), `/validate` (saved run) |

---

## 3. What happened overnight (log, newest last)

- **02:17 · 7deb150** · Engine: contract v0.2 (blend band at source edges), candidates over the CTX extent, 82 tests pass.
- **02:19 · b7178d7** · Person 3: validation run on real photos, skyline-vs-truth check per case, findings in `backend/skyline/CONTRACT_REVIEW.md`, phone-width nav fix.
- **02:25 · 2f57886** · `CONTRACTS.md` §4: test cases are one manifest; requests are generated.
- **~02:26** · Stored horizons rebuilt on the three-source terrain (about 3 min).
- **~02:39 · 2148be3** · Cleanup: test-photo list 1.88 MB / 67k lines → 76 KB / 1,430 lines; `work/m20_candidates.json` removed; new `backend/skyline/scripts/build_test_requests.py`; `/validate` now loads `frontend/public/validation.json`. Fixed two wrong image ids (sols 100, 1100) and the "looks 25° down" error in the docs (they look 23–33° up).
- **~02:50** · `SYSTEM_REFERENCE.md` corrected: matcher marked not validated, timings marked as targets, no `/locate` server yet, blend band, test counts.
- **02:50–02:52 · e1b0b20, 775c2c8** · Person 3 (Dávid) did the same test-photo consolidation in parallel and merged it with 2148be3. Checked at 03:00: the merged manifest has 24 poses / 38 photos (1,430 lines), `work/` is gone, skyline tests 22 passed / 6 skipped, scripts compile, `GOOD_MORNING.md` and `SYSTEM_REFERENCE.md` kept intact. Person 3 is evidently still working from their own machine.
- The engine session ("Fable Image Engine") keeps working on the matcher, in this order: (1) scoring bug, (2) a few hundred simulated trials, (3) honest confidence, (4) rerun on real photos. Updates are added below as they land.
- **03:00 · 6441e9d** · Engine: **scoring bug fixed.** A candidate no longer scores higher for having far terrain (no 1/tolerance factor per bin); the coarse pass solves for the offset between a 200 m grid point and the true position (first-order parallax) before scoring. Near-field rule and DEM height error default off. Simulated photos now get noise correlated along the skyline. Tests in `backend/tests/test_match_score.py`.
- **03:12 · 4744510** · Engine: **honest verdicts from a 300-trial simulation** (`backend/scripts/validate_sim.py`, reports in `backend/reports/`). "ok" now needs a good fit, full support and a clear lead. Result on 300 simulated photos: 43 % answered "ok", and of those 91 % were within 300 m and 96 % had the truth inside their 95 % circle; over all answers the truth is inside the 95 % circle 98 % of the time. **CONTRACTS.md v0.3** adds Person 3's four requests (optional `roll_uncertainty_deg`, `lens_model: cahvore`, 422 on unknown version, one server); requests marked 0.1–0.3 accepted. The matcher fits roll tilt when allowed. `backend/STATUS.md` now describes where the engine stands.
- The cleanup agent session has ended; its work is merged.
- **~03:40 · 33adfe6 + next commit** · Website navigation (frontend only, no engine or data files touched):
  a **screens menu** (`components/shared/ScreenMenu.tsx`) as Control's brand button and a ☰ button on the Field
  map, listing every screen with what it is for; Field's waiting screen now says the three steps to start and
  links to Control; Control's Plan rail links to Field; the landing page points Locate users to
  `/locate/?result=saved` when no engine server runs. Rebased onto 909df8a; kept Person 3's newer
  `public/validation.json` in the one conflict. 194 frontend tests and the browser smoke test pass.
  Notes for the frontend in `frontend/docs/CHANGES.md`.
- **~04:00 · d947ac4 … 52c7a20** · Website, continued (frontend only): Control Live says "no route sent yet"
  with a button back to Plan; Field keeps the traveller visible above the Start panel on a phone; `/map` shows
  the real mission sites from `places.geojson`, the traverse end (Western Delta Deposit) in magenta, others on
  hover. Production build, 194 tests and the smoke test pass. Nothing waiting on a human from the website side.

---

## 4. The main open problem: the matcher

Numbers so far:

| Test | Result |
|---|---|
| Simulated photos, before the fixes (30, 60° view, 0.05° noise) | ~60 % within 100 m; 93 % reported "ok" though only ~60 % right |
| **Simulated photos, after 03:12 (300 trials)** | 43 % "ok"; of those 91 % within 300 m, 96 % truth inside their 95 % circle; all answers 98 % inside the 95 % circle. Confidence is now honest; the share of confident answers is the next thing to raise |
| Real photos, committed engine (24 poses) | 2 within 50 m, 4 within 100 m, truth inside the 95 % circle 8/24, median 5.3 km, median heading error 3.2° |
| Real photos, in-progress matcher | median 2.96 km, truth inside the 95 % circle 11/24 |

Known causes:
1. ~~**Bug:** a true position could lose to a look-alike that fits 2–3× worse.~~ **Fixed 03:00** (6441e9d).
2. **Overconfidence:** fixed on simulation at 03:12 (4744510). Still to check on the 24 real poses, where skylines are 0.1–0.3° off rather than the simulated noise.
3. **Look-alikes are real:** skylines with under 1° of relief, one photo facing one way, and 20–65 % of each horizon coming from the coarse 200 m data. More photos in different directions, and finer data for the rim, help most.
4. **Near-field rule** (down-weight terrain closer than 1.5 km): implemented, default off until a few-hundred-trial run decides.

---

## 5. What is left, in priority order

1. **Matcher on real photos** (engine): rerun `validate.py` with the 03:12 engine and compare with the 5.3 km / 8-of-24 baseline; then raise the share of confident ("ok") answers without losing honesty. Nothing else matters as much.
2. **`POST /locate` server** (engine): FastAPI in `backend/`, includes Person 3's `/skyline` router from `backend/skyline/api.py`; CORS for `http://localhost:3000`. Contract §2 in, §3 out.
3. **Rerun validation** after each engine fix and refresh `/validate` (commands in section 7).
4. **Skyline step** (Person 3): catch rover hardware and nearby rocks on poses 3/1374, 3/2150, 3/2430.
5. **Contract decisions** proposed in `backend/skyline/CONTRACT_REVIEW.md`: optional `roll_uncertainty_deg`, `cahvore` lens value, 422 on unknown `contract_version`, `/skyline` router in the same server. Recommended: accept all four.
6. **Demo:** run website and engine locally on one laptop (`npm run dev` + the engine server). Host only the static website (Vercel/Netlify, project folder `frontend`, output `out/`). Record a backup screen video of a live locate once it works.
7. **Space Apps submission:** project page text, demo link, video. Only claim accuracy the latest validation shows.

---

## 6. Waiting for a human decision

- [ ] Install `python-multipart` into `backend/.venv` (already listed in `backend/skyline/requirements.txt`; without it `backend/skyline/tests/test_api.py` can't run). Recommended: yes.
- [ ] Check the photo review sheet `backend/cache/test_review/index.html` (local, git-ignored; regenerate with `build_test_requests.py --review`). Judgements the cleanup was unsure about:
  - near skylines marked usable: NLF_0175, NLF_0700, NLF_1100, NLF_1400 (weak for 20 m terrain; maybe `usable: false`)
  - robotic-arm turret in view, cut at weight 0: pose 3/1416 (4 photos) and NLF_0017 (pose 3/578)
  - NLF_0085: camera tilted up, rocks along the skyline
  - NLF_0075 (pose 3/2430): very wide strip crops; one end of the traced line jumps
- [ ] Whether to host the engine at all (recommended: only if time remains after it works).

---

## 7. How to run things (Windows, repo root unless noted)

```bash
cd frontend && npm install && npm run dev            # website on http://localhost:3000 (predev copies data/output into public/data)
```
```bash
backend/.venv/Scripts/python -m pytest backend/tests                 # engine tests
```
```bash
backend/.venv/Scripts/python -m pytest backend/skyline/tests         # skyline tests
```
```bash
cd backend && .venv/Scripts/python scripts/build_horizons.py         # rebuild stored horizons (~3 min, CTX extent)
```
```bash
backend/.venv/Scripts/python data/scripts/fetch_test_photos.py                     # download + verify test photos
backend/.venv/Scripts/python backend/skyline/scripts/build_test_requests.py --review   # skyline requests + review sheet
backend/.venv/Scripts/python backend/skyline/scripts/validate.py --out backend/skyline/out/validation.json --app-copy frontend/public/validation.json
```
```bash
backend/.venv/Scripts/python backend/skyline/scripts/dev_server.py  # skyline API on :8000 (no /locate yet)
```
Terrain from scratch: `data/scripts/fetch_terrain.py` (downloads crops, checks SHA-256, writes `backend/data_local/terrain/terrain.json`).

---

## 8. Rules that kept biting us

- **Several Claude sessions share this one folder.** Stage files **by path** (`git add backend/marsloc/...`). Never `git add -A`, `git add .` or `git commit -a`: twice tonight a commit swept up another session's unfinished files.
- `git pull --rebase` before every push. Never force-push or rewrite pushed history.
- Big or generated files stay out of git: terrain, stored horizons, test images, generated requests (`backend/data_local/`, `backend/cache/`, `data/test_photos/images/`).
- Never open large data files as text (`cost_grid.json`, `.tif`, `.npy`, big JSON): inspect them with a short script. It saves a lot of usage.
- `frontend/lib/planner/jezeroTerrain.json` shows as modified after a build (line endings from the prebuild step). Don't commit it unless its content really changed.
- Report numbers honestly: errors in metres, what was and wasn't measured.
