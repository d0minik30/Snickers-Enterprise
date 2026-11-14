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

- One caveat on the label value: I assume the raw-image feed's `attitude` quaternion rotates rover
  vectors into the site frame. If it's the other way round, label-levelled photos are off by the
  rover's tilt (1–2° on my sample photos). The first test photo with a known heading will settle it.

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
