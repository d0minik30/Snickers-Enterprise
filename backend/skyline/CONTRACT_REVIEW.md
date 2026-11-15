# Review of `CONTRACTS.md` 0.1, from Person 3 (photo → skyline, the app)

The draft works for me as it is. `backend/skyline` already produces section 2 photos, and the app
builds the `POST /locate` body and checks the result against section 3. Below are answers to the questions
for me, then a few requests. Numbered so we can refer to them.

## Answers

**Q2: true ray angles and an honest `horizon_uncertainty_deg`.** Yes to both.

- Each traced pixel goes through the camera model to a ray: a pinhole with Brown–Conrady
  distortion for phones, CAHVORE for Perseverance. The ray is then levelled with the direction of
  gravity. `elev_deg` is the angle of that ray above the horizontal plane, so it's the
  `atan(y / sqrt(f² + x²))` form, not `atan(y / f)`.
- On synthetic photos of known geometry, the angles come back within 0.03° (median).
- `horizon_uncertainty_deg` depends on where the tilt came from. These are starting values; I'll
  calibrate them on Person 2's photos with known positions:

  | Tilt from | `horizon_uncertainty_deg` |
  |---|---|
  | Perseverance label | 0.3 |
  | Phone tilt sensor at the shutter | 1.0 |
  | Levelled by hand in the app | 1.0 |
  | Nothing (assumed level) | 5.0 |

- The label's attitude convention is confirmed: your matcher, run on six sol 17–18 Navcam photos
  from one rover pose, found every camera heading within 0.8° of the label's, and the position 23 m
  from the landing site (±13 m). See `backend/skyline/README.md`. Nice work on the matcher.

**Q3: heatmap as a JSON grid?** Fine. The app draws it on a canvas and lays it on the map like
`L.imageOverlay`.

**Q4: `prior`?** The app can send one when the user gives it (for example, "I'm roughly here" on the
map). It never comes from a test photo's truth. The validation screen runs without a prior.

## Requests

1. **Roll error isn't a constant shift.** A roll error δ tilts the skyline. At azimuth offset `a` the
   elevation error is about `δ · sin(a)` (for a skyline near 0°). On a 65° phone photo with δ = 1°
   that's ±0.5° at the edges, much more than the 0.06° per 100 m you're looking for. Could the engine
   take an optional `roll_uncertainty_deg` per photo, and fit `shift + t · sin(az_offset)` with
   |t| ≤ that value? Until then I'll fold roll into `horizon_uncertainty_deg`, which is cruder.

2. **`lens_model`:** please add `cahvore`. For now I send `other` for CAHVORE photos. Either way the
   samples are true ray angles.

3. **`relative_heading_deg`:** I'll fill it in for Perseverance photos taken at the same rover pose
   (same site/drive). It comes from the difference between the cameras' directions relative to the rover
   body, so the absolute heading is never involved. It's accurate to about 0.1°, so please treat it as
   exact (the photos turn together), not as a hint. Sign: clockwise positive, first photo 0. Phone
   photos get `null`.

4. **One server, one address.**
   - Please include my router in the same FastAPI app, so `/skyline`, `/skyline/convert`, `/locate` and
     `/health` share one base URL (the app's `NEXT_PUBLIC_ENGINE_URL`). With `backend/` on the path:
     `from skyline.api import router; app.include_router(router)`.
   - Allow CORS for `http://localhost:3000` and for the hosted site's address.
   - Add `Pillow` and `python-multipart` to `backend/requirements.txt`, or
     `-r skyline/requirements.txt`.
   - Until your server exists, `backend/skyline/scripts/dev_server.py` serves my part on :8000.

5. **Errors.** FastAPI's 422 list (`detail: [{loc, msg}]`) is fine: the app shows `loc: msg`. For other
   4xx, a `detail` string or `{"code", "message"}` (what my router sends) both work.

6. **`contract_version` mismatch:** I send `"0.1"`. Suggest a 422 that names `contract_version` when
   the engine doesn't support it, so a stale app fails loudly.

7. **Test cases (section 4):** I'll make the `request` part from Person 2's photos with the skyline
   step. `truth` stays in the test file: it's never sent to the engine, and the validation screen
   compares in the browser.

## What I send today

Per photo:
- **Camera:** full field of view (outer pixel edges) and size.
- **Eye height:** 1.97 m for Navcam, from the camera's position on the rover.
- **`horizon_uncertainty_deg`, `relative_heading_deg`,** and **`time_utc`** when known.
- **`sun`** when a sun disc is visible, always with `elev_deg`.
- **Samples:** every 0.1°, left to right. About 965 for a Navcam photo, about 650 for a 65° phone photo.

`options` is `{top_k: 5, include_likelihood_grid: true, include_residuals: true}`, with no prior unless
the user gives one. Real example output: `backend/skyline/README.md`, "The output".

## Findings from validation (real photos, known positions)

`backend/skyline/scripts/validate.py` ran the 15 rover poses in `work/m20_candidates.json` through the
whole chain: skyline step, the `POST /locate` body, your matcher, no prior. Truth = the NASA waypoint,
used only for scoring. The app shows the run at `/validate/`. 13 poses scored (2 had no photo showing sky).

| | |
|---|---|
| Within 50 m | 2 of 13 (3/1950, 3/2046: ~36 m) |
| Median error | 5.2 km |
| Truth inside the 95 % circle | 3 of 13 |
| Median heading error | 15.6° |

**The skylines are mostly fine.** For each case I compared the traced skyline with your horizon renderer
at the *true* position and heading (terrain over 2 km away):
- 3/770, 3/1708, 3/828, 3/1266, 4/0: the skyline matches the truth within 0.1–0.3°.
- 3/1374, 3/2150, 3/2430: off by 0.7–1.1° with a large spread; I'm looking into near objects on my side.

**So the main problem is confidence.** With 1–2 photos facing one direction the matcher answers `ok`
with ±10–80 m while 4–16 km off (for example 3/1266: ±82 m, 15.5 km off; 3/2430: ±9 m, 4.3 km off).
One 96° view of a fairly flat far horizon fits many places. Suggestions:
1. Treat a narrow total azimuth coverage (say under 180°) as weak evidence: `ambiguous` unless one peak
   clearly wins, and a warning saying so.
2. Check that `probability` and the uncertainty radii include the far look-alike peaks the coarse pass
   finds, not only the refined neighbourhood of the best one.
3. The six-photo sol 17–18 case (one pose, known relative headings) came out 74 m from the truth while
   claiming ±13 m. So even with good coverage the radius looks about 5× too small.
