#!/usr/bin/env python3
"""Download and check the Perseverance test photos, and write data/test_photos/manifest.json.

What this script does, and nothing more:
1. Downloads each listed Navcam photo and its raw-image record from NASA's public Mars 2020 feed into
   data/test_photos/images/ (git-ignored), and NASA's rover waypoint file.
2. Checks each photo: SHA-256, the size the record says, a camera model and rover attitude, a final
   waypoint for its rover pose (site/drive) within one sol, and whether a skyline is visible
   (the photo is run through backend/skyline just far enough to say so; no samples are kept).
3. Writes the manifest: one case per rover pose, with per photo only source links, checksum, camera
   calibration and time, plus a review record. The truth (the waypoint, and each camera's heading) is
   kept apart, in the top-level "truth" map, so nothing that builds requests needs to read it.

Skyline requests are not stored here: backend/skyline/scripts/build_test_requests.py makes them.

Run from the repository root with the backend's Python (numpy, Pillow):
    py -3.10 data/scripts/fetch_test_photos.py
"""
from __future__ import annotations

import hashlib
import json
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from collections import Counter
from io import BytesIO
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / "data" / "test_photos"
IMAGE_DIR = OUT / "images"
MANIFEST = OUT / "manifest.json"
WAYPOINTS_URL = "https://mars.nasa.gov/mmgis-maps/M20/Layers/json/M20_waypoints.json"
NASA_FEED = "https://mars.nasa.gov/rss/api/"
RAW_PAGE = "https://mars.nasa.gov/mars2020/multimedia/raw-images/"
USER_AGENT = "Snickers-Enterprise-test-data/1.0"
MIN_TRUSTED_SHARE = 0.3  # a photo is usable when at least this share of its traced skyline is trusted

# Curated set: distinct sols and rover poses within 11.4 km of the landing site. Always listed; the
# review record says when one can't be used (e.g. pointed at the ground).
CURATED = [
    "NLF_0017_0668451937_008ECM_N0030578NCAM00195_01_290J",
    "NLF_0020_0668728525_175ECM_N0030770NCAM03020_01_295J",
    "NLF_0023_0668989782_854ECM_N0030792NCAM03023_01_195J",
    "NLF_0031_0669701558_070ECM_N0031044NCAM02031_01_295J",
    "NLF_0033_0669876929_412ECM_N0031374NCAM03033_04_195J",
    "NLF_0045_0670932866_237ECM_N0031416NCAM00298_01_295J",
    "NLF_0048_0671204803_602ECM_N0031708NCAM00296_01_295J",
    "NLM_0065_0672719652_349ECM_N0032150TRAV12006_01_2LLJ",
    "NLF_0085_0674497718_262ECM_N0040000NCAM00501_01_295J",
    "NLF_0100_0675829298_323ECM_N0040218NCAM00501_01_295J",
    "NLF_0175_0682484814_495ECM_N0061752NCAM03175_01_195J",
    "NLF_0200_0684705390_613ECM_N0071172NCAM02200_01_195J",
    "NLF_0400_0702459099_323ECM_N0191126NCAM02400_01_185J",
    "NLF_0700_0729097896_521ECM_N0330366NCAM13700_01_195J",
    "NLF_1000_0755730069_005ECM_N0474404NCAM00501_01_295J",
    "NLF_1100_0764605750_020ECM_N0510644NCAM00501_01_295J",
    "NLF_1300_0782342100_633ECM_N0610000NCAM13299_01_195J",
    "NLF_1400_0791226168_881ECM_N0660000NCAM13400_01_195J",
    "NRF_1700_0817857060_612ECM_N0820000NCAM03700_01_195J",
]

# More photos at the early rover poses (formerly work/m20_candidates.json). Kept only when they have a
# final waypoint and a visible, traceable skyline; they join the case of their rover pose.
CANDIDATES = [
    "NRF_0017_0668451937_008EBY_N0030578NCAM00195_05_0LLJ",
    "NRF_0017_0668452002_600EBY_N0030578NCAM00183_06_0LLJ",
    "NLF_0018_0668543320_776EBY_N0030578NCAM00190_04_0LLJ",
    "NLF_0018_0668545153_612EBY_N0030578NCAM00190_04_0LLJ",
    "NLF_0020_0668728577_477ECM_N0030770NCAM02020_01_295J",
    "NLF_0020_0668728666_168ECM_N0030770NCAM02020_01_295J",
    "NLF_0023_0668989261_427ECM_N0030792NCAM00194_01_290J",
    "NLF_0023_0668990131_179ECM_N0030792NCAM02023_01_295J",
    "NRF_0029_0669530788_675ECM_N0030828NCAM02029_01_295J",
    "NRF_0029_0669530737_914ECM_N0030828NCAM02029_01_295J",
    "NLF_0031_0669701720_789EBY_N0031044NCAM00600_00_0LLJ",
    "NRF_0031_0669701926_722EBY_N0031044NCAM00600_00_0LLJ",
    "NLF_0032_0669789514_761ECM_N0031266NCAM02032_07_195J",
    "NLF_0032_0669789369_152ECM_N0031266NCAM02032_01_295J",
    "NLF_0033_0669877239_418ECM_N0031374NCAM02033_01_295J",
    "NLF_0033_0669877142_481ECM_N0031374NCAM02033_01_295J",
    "NLF_0045_0670932866_237ECM_N0031416NCAM00298_01_295J",
    "NLF_0045_0670932474_176ECM_N0031416NCAM00298_01_295J",
    "NLF_0046_0671024021_615ECM_N0031416NCAM00298_01_295J",
    "NLF_0046_0671024226_132ECM_N0031416NCAM00298_01_295J",
    "NLF_0047_0671114203_533EBY_N0031416NCAM00603_00_0LLJ",
    "NLF_0047_0671114224_611EBY_N0031416NCAM00603_00_0LLJ",
    "NLF_0048_0671204803_602ECM_N0031708NCAM00296_01_295J",
    "NLF_0048_0671201674_630ECM_N0031708NCAM00296_01_295J",
    "NLF_0050_0671379226_926EBY_N0031950NCAM00294_00_0LLJ",
    "NRF_0050_0671379226_926EBY_N0031950NCAM00294_00_0LLJ",
    "NLF_0055_0671828623_680EBY_N0032046NCAM00295_00_0LLJ",
    "NLF_0055_0671823755_948EBY_N0032046NCAM00295_00_0LLJ",
    "NLF_0060_0672265209_237EBY_N0032046NCAM00410_00_0LLJ",
    "NRF_0060_0672265209_237EBY_N0032046NCAM00410_00_0LLJ",
    "NLM_0065_0672719652_349ECM_N0032150TRAV12006_01_2LLJ",
    "NRM_0065_0672719709_543ECM_N0032150TRAV12002_01_2LLJ",
    "NLE_0070_0673172017_401ECM_N0032208NCAM00190_04_0LLJ",
    "NLE_0070_0673174064_027ECM_N0032208NCAM00189_04_0LLJ",
    "NLF_0075_0673599197_036ECM_N0032430NCAM00500_01_295J",
    "NLF_0075_0673599280_164ECM_N0032430NCAM00500_01_295J",
    "NLE_0080_0674048171_974ECM_N0032430NCAM00193_04_0LLJ",
    "NLF_0080_0674047950_137EBY_N0032430NCAM00192_04_0LLJ",
    "NLF_0085_0674497718_262ECM_N0040000NCAM00501_01_295J",
    "NLF_0085_0674497957_615ECM_N0040000NCAM00501_01_295J",
]


def get(url: str) -> bytes:
    request = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    for attempt in range(5):
        try:
            with urllib.request.urlopen(request, timeout=90) as response:
                return response.read()
        except (urllib.error.URLError, TimeoutError, ConnectionError):
            if attempt == 4:
                raise
            time.sleep(2 ** attempt)
    raise RuntimeError("unreachable retry state")


def feed_url(image_id: str) -> str:
    query = urllib.parse.urlencode({"feed": "raw_images", "category": "mars2020", "feedtype": "json", "id": image_id})
    return f"{NASA_FEED}?{query}"


def feed_record(image_id: str) -> dict:
    cached = IMAGE_DIR / f"{image_id}.label.json"
    if cached.is_file():
        return json.loads(cached.read_text(encoding="utf-8"))
    payload = json.loads(get(feed_url(image_id)))
    records = payload.get("image") or payload.get("images") or []
    records = [records] if isinstance(records, dict) else records
    record = next((r for r in records if r.get("imageid") == image_id), None)
    if record is None:
        raise RuntimeError(f"NASA image feed returned no record for {image_id}")
    cached.write_text(json.dumps(record, indent=2) + "\n", encoding="utf-8", newline="\n")
    return record


def image_bytes(image_id: str, record: dict) -> bytes:
    path = IMAGE_DIR / f"{image_id}.png"
    if path.is_file():
        return path.read_bytes()
    url = (record.get("image_files") or {}).get("full_res")
    if not url:
        raise RuntimeError(f"{image_id}: no full-resolution image URL")
    data = get(url)
    path.write_bytes(data)
    return data


def waypoint_for(record: dict, by_site_drive: dict) -> dict | None:
    """The final localized waypoint of the photo's rover pose. The drive counter goes up whenever the
    rover moves, so every photo with the same site/drive was taken from that one position, however
    many sols later; the nearest sol is preferred only to pick between duplicates."""
    site, drive, sol = record.get("site"), str(record.get("drive")), int(record["sol"])
    choices = [p for p in by_site_drive.get((site, drive), []) if p.get("final") == "y"]
    if not choices:
        return None
    return min(choices, key=lambda p: (abs(int(p.get("sol", sol)) - sol), -int(p.get("sol", 0))))


def review_photo(rgb, record: dict, setup_from_m2020_record, process) -> tuple[dict, float | None]:
    """Is a skyline visible, and how much of it can be trusted? Also the camera's direction from the
    rover's forward direction (for the truth heading). Nothing traced is kept."""
    height, width = rgb.shape[:2]
    try:
        setup = setup_from_m2020_record(record, width, height, {})
    except ValueError as e:
        return {"skyline_visible": False, "trusted_share": 0.0, "usable": False, "notes": str(e)}, None
    out = process(rgb, setup)
    samples = out.photo["samples"]
    share = sum(s["weight"] >= 0.5 for s in samples) / max(1, len(samples))
    visible = bool(out.diagnostics["sky_visible"]) and share > 0
    reasons = Counter(r for r in out.trace["reason"] if r)
    if not out.diagnostics["sky_visible"]:
        notes = f"no sky in view (camera pitch {out.diagnostics['pitch_deg']:+.0f} deg)"
    else:
        cut = ", ".join(f"{k} {100 * v / len(out.trace['reason']):.0f} %" for k, v in reasons.most_common(3))
        notes = f"{100 * share:.0f} % of the traced skyline trusted" + (f"; not trusted: {cut}" if cut else "")
    review = {"skyline_visible": visible, "trusted_share": round(share, 3),
              "usable": visible and share >= MIN_TRUSTED_SHARE, "notes": notes}
    return review, setup.rover_axis_azimuth_deg


def main() -> int:
    try:
        import numpy as np
        from PIL import Image
    except ImportError as exc:
        raise SystemExit("Use the backend's Python, with Pillow and NumPy installed") from exc
    sys.path.insert(0, str(ROOT / "backend"))
    from skyline.metadata import setup_from_m2020_record
    from skyline.pipeline import process

    IMAGE_DIR.mkdir(parents=True, exist_ok=True)
    previous = json.loads(MANIFEST.read_text(encoding="utf-8")) if MANIFEST.is_file() else {}
    known_sha = {p["image_id"]: p["image_sha256"] for c in previous.get("cases", []) for p in c.get("photos", [])
                 if "image_id" in p}
    manual_notes = {c["name"]: c["review"].get("manual_notes") for c in previous.get("cases", [])
                    if c.get("review", {}).get("manual_notes")}

    waypoints = json.loads(get(WAYPOINTS_URL))
    by_site_drive: dict[tuple, list[dict]] = {}
    for feature in waypoints.get("features", []):
        props = feature.get("properties", {})
        if props.get("site") is not None and props.get("drive") is not None:
            by_site_drive.setdefault((props["site"], str(props["drive"])), []).append(props)

    cases: dict[tuple, dict] = {}
    truth: dict[tuple, dict] = {}
    moments: set[tuple] = set()  # (pose, spacecraft clock): a stereo pair counts once
    listed = [(i, True) for i in CURATED] + [(i, False) for i in CANDIDATES]
    for n, (image_id, curated) in enumerate(listed, start=1):
        record = feed_record(image_id)
        data = image_bytes(image_id, record)
        sha = hashlib.sha256(data).hexdigest()
        if image_id in known_sha and known_sha[image_id] != sha:
            raise RuntimeError(f"{image_id}: image changed since the manifest was written (SHA-256 differs)")
        cam = record.get("camera") or {}
        if not cam.get("camera_model_component_list") or not record.get("attitude"):
            raise RuntimeError(f"{image_id}: record has no camera model or rover attitude")
        with Image.open(BytesIO(data)) as im:
            rgb = np.asarray(im.convert("RGB"))
        dim = str((record.get("extended") or {}).get("dimension", "")).strip("()").split(",")
        if [int(x) for x in dim] != [rgb.shape[1], rgb.shape[0]]:
            raise RuntimeError(f"{image_id}: image is {rgb.shape[1]}x{rgb.shape[0]}, record says {dim}")

        waypoint = waypoint_for(record, by_site_drive)
        pose = (int(record["site"]), int(record["drive"]))
        moment = (pose, image_id[9:19])
        if waypoint is None:
            print(f"[{n}/{len(listed)}] {image_id}: no final waypoint for its site/drive, left out")
            continue
        if not curated and moment in moments:
            print(f"[{n}/{len(listed)}] {image_id}: other eye of a stereo pair already listed, left out")
            continue
        review, axis = review_photo(rgb, record, setup_from_m2020_record, process)
        if not curated and not review["usable"]:
            print(f"[{n}/{len(listed)}] {image_id}: {review['notes']}, left out")
            continue
        moments.add(moment)
        print(f"[{n}/{len(listed)}] {image_id}: {review['notes']}")

        ext = record.get("extended") or {}
        case = cases.setdefault(pose, {
            "name": f"site_{pose[0]}_drive_{pose[1]}", "sol": int(record["sol"]),
            "pose": {"site": pose[0], "drive": pose[1]}, "photos": [],
        })
        case["sol"] = min(case["sol"], int(record["sol"]))
        case["photos"].append({
            "image_id": image_id,
            "source_url": record.get("link") or f"{RAW_PAGE}{image_id}",
            "metadata_url": feed_url(image_id),
            "image_url": (record.get("image_files") or {}).get("full_res"),
            "image_sha256": sha,
            "time_utc": f"{record['date_taken_utc']}Z" if record.get("date_taken_utc") else None,
            "camera_calibration": {
                "instrument": cam.get("instrument"),
                "model_type": cam.get("camera_model_type"),
                "camera_model_component_list": cam.get("camera_model_component_list"),
                "camera_vector": cam.get("camera_vector"),
                "image_width_px": rgb.shape[1],
                "image_height_px": rgb.shape[0],
                "subframe_rect": ext.get("subframeRect"),
                "scale_factor": ext.get("scaleFactor"),
                "rover_attitude_wxyz": record.get("attitude"),
            },
            "review": review,
        })
        t = truth.setdefault(pose, {
            "lat": float(waypoint["lat"]), "lon": float(waypoint["lon"]),
            "rover_heading_deg": float(waypoint["yaw"]) % 360.0,
            "waypoint_sol": int(waypoint["sol"]), "site": pose[0], "drive": pose[1],
            "photo_headings_deg": {},
            "position_source": "NASA M20 waypoint: the final localization of the photo's site/drive",
            "heading_source": "waypoint yaw plus the camera's direction from the rover's forward direction (from its label)",
            "waypoint_source": WAYPOINTS_URL,
        })
        if axis is not None:
            t["photo_headings_deg"][image_id] = round((t["rover_heading_deg"] + axis) % 360.0, 4)

    out_cases = []
    for pose in sorted(cases):
        c = cases[pose]
        usable = [p for p in c["photos"] if p["review"]["usable"]]
        c["review"] = {
            "skyline_visible": any(p["review"]["skyline_visible"] for p in c["photos"]),
            "usable": bool(usable),
            "notes": f"{len(usable)} of {len(c['photos'])} photos usable",
        }
        if manual_notes.get(c["name"]):
            c["review"]["manual_notes"] = manual_notes[c["name"]]
        out_cases.append(c)

    manifest = {
        "manifest_version": 2,
        "description": ("Real Perseverance Navcam photos with known rover positions, one case per rover pose. "
                        "Photos and their raw-image records are downloaded into images/ (git-ignored) by "
                        "data/scripts/fetch_test_photos.py; skyline requests are built by "
                        "backend/skyline/scripts/build_test_requests.py. The truth map is for scoring only "
                        "and must never be copied into a /locate request."),
        "image_source": "NASA/JPL-Caltech Mars 2020 raw images, " + RAW_PAGE,
        "waypoint_source": WAYPOINTS_URL,
        "cases": out_cases,
        "truth": {cases[pose]["name"]: truth[pose] for pose in sorted(cases)},
    }
    MANIFEST.write_text(json.dumps(manifest, indent=2, ensure_ascii=False) + "\n", encoding="utf-8", newline="\n")
    n_photos = sum(len(c["photos"]) for c in out_cases)
    n_usable = sum(c["review"]["usable"] for c in out_cases)
    print(f"Wrote {len(out_cases)} cases ({n_usable} usable), {n_photos} photos, to {MANIFEST}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
