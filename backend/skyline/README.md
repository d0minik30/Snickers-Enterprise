# Skyline: photo → skyline

Turns a photo into a **skyline**: the line where terrain meets sky, as angles the engine can match
against the elevation data. Classic image processing only (numpy and Pillow, no learned model).

```
photo + camera info ──► find the sky ──► weigh each column ──► pixels → angles ──► skyline JSON
                         sky.py           trust.py             camera.py, level.py,   + debug image
                                                               angles.py
```

## Run it

Python 3.10 (`py -3.10` on Windows; the default `python` there is 3.9 without these packages).

```bash
py -3.10 -m pip install -r backend/skyline/requirements.txt
py -3.10 -m pytest backend/skyline                     # 36 tests, about 75 s
py -3.10 backend/skyline/scripts/fetch_samples.py      # 10 real Perseverance Navcam photos -> samples/
py -3.10 backend/skyline/scripts/run_samples.py        # traced photos and skylines -> out/
```

`samples/` and `out/` are git-ignored (the repo keeps images out). The tests on real photos skip
themselves when the samples are not downloaded.

Until the main server exists, `py -3.10 backend/skyline/scripts/dev_server.py` serves this router
on http://localhost:8000 with CORS open to the Next.js dev server, for the app's Locate screen.

## API (a FastAPI router)

The main server includes it: `from skyline.api import router; app.include_router(router)`.

**`POST /skyline`**, multipart form:

| Field | |
|---|---|
| `photo` | JPEG or PNG. EXIF orientation is applied. At most 30 MB and 50 megapixels. |
| `camera` | Optional JSON string, below. |
| `label` | Optional file: a Perseverance raw-image record (JSON, as `fetch_samples.py` saves it, or the feed's by-id reply). |

Returns one photo of the engine's `POST /locate` body (`backend/CONTRACTS.md`, section 2, without its
`id`), the camera set-up for the app (`diagnostics`, not sent to the engine), the line in photo pixels
(`trace`) and the debug image. Below.

**`POST /skyline/convert`**, JSON `{"camera": {...}, "label": {...} | null, "width": W, "height": H,
"trace": {"x": [...], "y": [...], "weight": [...], "sun_px": [x, y] | null}}` returns
`{"contract_version", "photo", "diagnostics"}`. The app sends a trace the user has fixed (moved points,
erased stretches as weight 0) and gets the angles back, so the camera maths lives in one place.

Errors: HTTP 400 (413 for a photo that is too large) with `{"detail": {"code", "message"}}`.

### Camera info (`camera`, all optional)

| Key | |
|---|---|
| `preset` | `iphone-main`, `iphone-ultrawide`, `pixel-main`, `galaxy-main`, `generic-phone`, `m2020-navcam`, `m2020-mastcamz-26mm`, `m2020-mastcamz-110mm` (see `metadata.PRESETS`) |
| `hfov_deg`, `vfov_deg`, `k`, `p` | Explicit pinhole camera with Brown–Conrady distortion `[k1, k2, k3]`, `[p1, p2]` |
| `pitch_deg`, `roll_deg`, `level_source` | Tilt. Pitch: optical axis above the horizon, positive up. Roll: positive when the camera's right side dips. `level_source`: `sensor` (the phone's tilt sensor) or `manual` (levelled by hand). |
| `eye_height_m` | Default 1.7; from the label for Perseverance (about 1.97 m for Navcam). |
| `time_utc` | ISO 8601. From the label for Perseverance; from EXIF only when it carries a time-zone offset. |

Which camera wins: label, then `hfov_deg`, then `preset`, then EXIF 35 mm-equivalent focal length.
Without `pitch_deg`/`roll_deg` a phone photo is treated as level and `diagnostics.level_source` says
`"assumed"`.

## The output (`backend/CONTRACTS.md` 0.1)

Real output for the sol 48 sample photo:

```json
{
  "contract_version": "0.1",
  "photo": {
    "camera": {"hfov_deg": 96.537, "vfov_deg": 73.098, "width_px": 1280, "height_px": 960, "lens_model": "other"},
    "eye_height_m": 1.973,
    "horizon_uncertainty_deg": 0.3,
    "relative_heading_deg": null,
    "time_utc": "2021-04-09T00:56:43.394Z",
    "samples": [{"az_offset_deg": -49.0, "elev_deg": 4.1819, "weight": 0.0}, "...", {"az_offset_deg": 0.0, "elev_deg": 3.9524, "weight": 1.0}, "..."]
  },
  "diagnostics": {"camera_model": "cahvore", "camera_source": "label", "level_source": "label", "pitch_deg": -3.984, "roll_deg": -1.013, "az_step_deg": 0.1, "rover_axis_azimuth_deg": 99.2772, "rover_pose": "3/1708"},
  "trace": {"...": "the line in photo pixels"},
  "debug_image": "data:image/jpeg;base64,..."
}
```

`photo` follows the contract, section 2:

- **`camera`**: full field of view (outer pixel edge to outer pixel edge) and size. `lens_model` is
  `rectilinear` for phone cameras and `other` for CAHVORE; the samples are true ray angles either way.
- **`horizon_uncertainty_deg`**: how far "level" may be off, by where the tilt came from: label 0.3,
  sensor 1.0, manual 1.0, assumed 5.0 (`pipeline.HORIZON_UNCERTAINTY_DEG`; to calibrate on the test photos).
- **`relative_heading_deg`**: always `null` here; the app sets it for photos that turn together
  (Perseverance photos at one rover pose, from `diagnostics.rover_axis_azimuth_deg`).
- **`samples`**: `az_offset_deg` is the azimuth of the viewing ray minus that of the optical axis, in
  the horizontal plane, positive to the right; `elev_deg` is above the local horizontal with pitch and
  roll removed. Every 0.1° (`diagnostics.az_step_deg`), left to right. `weight` 0–1, 0 = do not use;
  between a trusted and an untrusted point a sample gets 0, so a bad stretch never leaks.
- **`sun`** (only when a sun disc is visible) and **`time_utc`** (only when known).

`diagnostics`: camera model and where it came from, where the tilt came from, the pitch and roll that
were removed, and for Perseverance the camera's direction from the rover's forward direction and the
rover pose (site/drive). Neither of those last two is the answer: the rover's own heading is not in them.

The **trace** (for the app) has the line in the photo's own pixels: `x`, `y`, `weight` and `reason`
per column, plus `sun_px`.

## Never the answer

For Perseverance test photos the label's rover heading and position are the answer. From a label
this code reads **only** the camera model and the **direction of gravity** in the camera's frame
(`level.gravity_from_rover_attitude` keeps only the "down" row of the attitude rotation). Elevation
needs "down"; azimuth is measured from the optical axis, so the heading cancels out. A test changes
the heading and position in a label and checks that the skyline does not change
(`tests/test_level.py::test_skyline_never_depends_on_the_labels_answer`).

## How the sky is found (`sky.py`)

Going down each column, the skyline is the **first strong** colour change that **lasts**. The
Martian sky is a smooth gradient, often with a bright glow near the horizon, so inside it the colour
changes very little from row to row however bright it gets.

1. **Mask the dark lens corners.** Navcam has them. The mask covers the dark core and its fade-out.
2. **Score every possible line position** in each column on a copy at most 640 px wide:
   - strong steps above the line count against it;
   - a lasting difference below the line counts for it;
   - a sharp step right at the line counts for it.
3. **Pick the best line across all columns** with an exact best-path search that also charges for
   jumps between neighbouring columns.
4. **Refine at full resolution:** in each column, the first strong step, to sub-pixel accuracy. Then
   remove single-column slips.
5. **The sun** is found first and painted over with the sky around it, so it cannot bend the line.

On synthetic photos of known geometry the line is within 0.2 px (median) of the truth, and the
angles come back within 0.03° (median) with a pinhole camera, distortion, pitch and roll, and with
the real Navcam CAHVORE model.

## Trust weights (`trust.py`)

Each column of the line gets a weight from 0 to 1, and the `reason` it was cut:

| Reason | Cut when | Cue |
|---|---|---|
| `near` | Something close to the camera rises into the sky: a rock, the rover's arm, a person. | The line sticks up above a robust straight line through the far skyline, *and* the ground under it is sharper than the far skyline (far terrain is hazy). Weight 0, plus a small margin either side. |
| `haze` | The far rim fades into the sky. | The edge is weak compared with this skyline's typical edge. |
| `jitter` | The line keeps jumping between two levels, for example a faint ridge behind a nearer one. | Mean column-to-column change in row. |
| `edge` | Near the image border or the dark lens corners. | Weight ramps up over 3 % of the width. |
| `top` | The line touches the top of the usable image, so the skyline itself isn't visible. | Distance to the top. |
| `glare` | Blown-out sky above a weak edge. | Saturated pixels, together with a weak edge. |

On the ten sample photos:
- **The robotic arm** is zero weight in every frame.
- **Clean rim horizons** (sols 47, 48) keep 935 of 964 samples, losing only the borders.

## Open points

- **Attitude quaternion convention.** The code assumes the raw-image feed's `attitude` (w, x, y, z)
  rotates rover-frame vectors into the local-level site frame (north, east, down), as I understand
  JPL's convention. A photo with a known heading (Person 2's test set) will confirm it. If it is the
  other way round, levelling is off by about the rover's tilt (1–2° on the sample photos).
- **PDS4 labels.** Only the raw-image feed record is read so far. PDS4 XML can be added once Person 2's
  test photos show which form they come in.
- **Cropped (subframe) Perseverance images** that don't start at the sensor's corner are refused for
  now.
- **The contract** (`backend/CONTRACTS.md`) is still a draft (0.1); my review is in
  [`CONTRACT_REVIEW.md`](CONTRACT_REVIEW.md).
