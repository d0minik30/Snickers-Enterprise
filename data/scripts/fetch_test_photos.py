#!/usr/bin/env python3
"""Fetch curated Perseverance Navcam frames and build contract-ready truth cases.

Images and raw feed labels are kept under data/test_photos/images/ (git-ignored).
The committed manifest contains the source URLs, camera calibration, extracted
skyline request, and a separate validation-only truth record.
"""
from __future__ import annotations

import hashlib
import json
import math
import sys
import time
import urllib.parse
import urllib.error
import urllib.request
from io import BytesIO
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / "data" / "test_photos"
IMAGE_DIR = OUT / "images"
WAYPOINTS_URL = "https://mars.nasa.gov/mmgis-maps/M20/Layers/json/M20_waypoints.json"
NASA_FEED = "https://mars.nasa.gov/rss/api/"
USER_AGENT = "Snickers-Enterprise-test-data/1.0"

# Chosen across distinct sols and rover sites/drives within 11.4 km of the landing
# site. Every image is joined to the closest final waypoint for its site/drive.
IMAGE_IDS = [
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


def digest(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def feed_record(image_id: str) -> tuple[dict, str]:
    query = urllib.parse.urlencode({"feed": "raw_images", "category": "mars2020",
                                   "feedtype": "json", "id": image_id})
    feed_url = f"{NASA_FEED}?{query}"
    cached_label = IMAGE_DIR / f"{image_id}.label.json"
    if cached_label.is_file():
        return json.loads(cached_label.read_text(encoding="utf-8")), feed_url
    payload = json.loads(get(feed_url))
    records = payload.get("image") or []
    if isinstance(records, dict):
        records = [records]
    record = next((item for item in records if item.get("imageid") == image_id), None)
    if record is None:
        raise RuntimeError(f"NASA image feed returned no record for {image_id}")
    return record, feed_url


def records_for_sol(sol: int) -> list[dict]:
    query = urllib.parse.urlencode({"feed": "raw_images", "category": "mars2020",
                                   "feedtype": "json", "sol": sol})
    payload = json.loads(get(f"{NASA_FEED}?{query}"))
    records = payload.get("images") or payload.get("image") or []
    return [records] if isinstance(records, dict) else records


def is_full_frame(record: dict) -> bool:
    rect = str((record.get("extended") or {}).get("subframeRect", "")).strip("()").split(",")
    return len(rect) != 4 or (rect[0].strip(), rect[1].strip()) == ("1", "1")


def camera_setup_if_valid(record: dict, setup_from_m2020_record):
    ext = record.get("extended") or {}
    dim = str(ext.get("dimension", "")).strip("()").split(",")
    try:
        width, height = int(dim[0]), int(dim[1])
        return setup_from_m2020_record(record, width, height, {})
    except (ValueError, IndexError, TypeError):
        return None


def full_frame_alternative(record: dict, setup_from_m2020_record) -> dict:
    """Resolve cropped or unusable views to a full-frame sibling at the same pose."""
    if is_full_frame(record) and camera_setup_if_valid(record, setup_from_m2020_record) is not None:
        return record
    site, drive = record.get("site"), str(record.get("drive"))
    instrument = (record.get("camera") or {}).get("instrument")
    choices = [r for r in records_for_sol(int(record["sol"]))
               if r.get("site") == site and str(r.get("drive")) == drive
               and (r.get("camera") or {}).get("instrument") == instrument
               and is_full_frame(r) and r.get("attitude")
               and (r.get("image_files") or {}).get("full_res")
               and camera_setup_if_valid(r, setup_from_m2020_record) is not None]
    if not choices:
        raise RuntimeError(f"{record['imageid']}: no usable full-frame sibling at the same rover pose")
    choices.sort(key=lambda r: (r.get("date_taken_utc", ""), r.get("imageid", "")))
    selected, _ = feed_record(choices[0]["imageid"])
    return selected


def waypoint_for(record: dict, by_site_drive: dict) -> dict:
    site, drive, photo_sol = record.get("site"), str(record.get("drive")), int(record["sol"])
    choices = [p for p in by_site_drive.get((site, drive), [])
               if p.get("final") == "y" and abs(int(p.get("sol", photo_sol)) - photo_sol) <= 1]
    if not choices:
        raise RuntimeError(f"No final waypoint within one sol for {record['imageid']} ({site}/{drive})")
    return min(choices, key=lambda p: (abs(int(p.get("sol", photo_sol)) - photo_sol), -int(p.get("sol", 0))))


def main() -> int:
    try:
        import numpy as np
        from PIL import Image
    except ImportError as exc:
        raise SystemExit("Use backend/.venv Python with Pillow and NumPy installed") from exc
    sys.path.insert(0, str(ROOT / "backend"))
    from skyline.metadata import setup_from_m2020_record
    from skyline.pipeline import process

    IMAGE_DIR.mkdir(parents=True, exist_ok=True)
    waypoint_bytes = get(WAYPOINTS_URL)
    waypoint_doc = json.loads(waypoint_bytes)
    by_site_drive: dict[tuple, list[dict]] = {}
    for feature in waypoint_doc.get("features", []):
        props = feature.get("properties", {})
        if props.get("site") is not None and props.get("drive") is not None:
            by_site_drive.setdefault((props["site"], str(props["drive"])), []).append(props)

    cases = []
    for index, image_id in enumerate(IMAGE_IDS, start=1):
        print(f"[{index}/{len(IMAGE_IDS)}] {image_id}")
        record, feed_url = feed_record(image_id)
        record = full_frame_alternative(record, setup_from_m2020_record)
        if record.get("camera", {}).get("instrument", "").upper().find("NAVCAM") < 0:
            raise RuntimeError(f"{image_id}: selected product is not a Navcam frame")
        waypoint = waypoint_for(record, by_site_drive)
        image_url = record.get("image_files", {}).get("full_res")
        if not image_url:
            raise RuntimeError(f"{image_id}: no full-resolution image URL")
        image_path = IMAGE_DIR / f"{image_id}.png"
        label_path = IMAGE_DIR / f"{image_id}.label.json"
        image_bytes = image_path.read_bytes() if image_path.is_file() else get(image_url)
        image_path.write_bytes(image_bytes)
        label_path.write_text(json.dumps(record, indent=2) + "\n", encoding="utf-8", newline="\n")

        with Image.open(BytesIO(image_bytes)) as im:
            rgb = np.asarray(im.convert("RGB"))
        height, width = rgb.shape[:2]
        setup = setup_from_m2020_record(record, width, height, {})
        output = process(rgb, setup)
        if len(output.photo.get("samples", [])) < 20:
            raise RuntimeError(f"{image_id}: skyline extractor produced fewer than 20 samples")

        photo = dict(output.photo)
        photo["id"] = image_id
        case_name = f"sol_{int(record['sol']):04d}_{record['camera']['instrument'].lower()}"
        yaw_raw = float(waypoint["yaw"])
        if setup.rover_axis_azimuth_deg is None:
            raise RuntimeError(f"{image_id}: camera label has no optical-axis azimuth relative to the rover")
        rover_heading = yaw_raw % 360.0
        camera_axis_relative = float(setup.rover_axis_azimuth_deg)
        heading = (rover_heading + camera_axis_relative) % 360.0
        camera = photo["camera"]
        calibration = {
            "instrument": record["camera"].get("instrument"),
            "model_type": record["camera"].get("camera_model_type"),
            "camera_model_component_list": record["camera"].get("camera_model_component_list"),
            "camera_vector": record["camera"].get("camera_vector"),
            "image_width_px": width,
            "image_height_px": height,
            "hfov_deg": camera["hfov_deg"],
            "vfov_deg": camera["vfov_deg"],
            "lens_model": camera["lens_model"],
            "calibration_source": feed_url,
        }
        cases.append({
            "name": case_name,
            "sol": int(record["sol"]),
            "source": record.get("link") or feed_url,
            "source_metadata_url": feed_url,
            "image_url": image_url,
            "image_file": f"data/test_photos/images/{image_path.name}",
            "image_sha256": digest(image_bytes),
            "label_file": f"data/test_photos/images/{label_path.name}",
            "camera_calibration": calibration,
            "time_utc": photo.get("time_utc"),
            "request": {"contract_version": "0.1", "photos": [photo],
                        "options": {"top_k": 5, "include_likelihood_grid": True,
                                    "include_residuals": True}},
            "truth": {
                "lat": float(waypoint["lat"]),
                "lon": float(waypoint["lon"]),
                "heading_deg": heading,
                "headings_deg": [heading],
                "rover_heading_deg": rover_heading,
                "camera_axis_azimuth_relative_to_rover_deg": camera_axis_relative,
                "waypoint_sol": int(waypoint["sol"]),
                "site": int(waypoint["site"]),
                "drive": int(waypoint["drive"]),
                "heading_source": "NASA M20 waypoint yaw plus image-label optical-axis azimuth relative to rover",
                "position_source": "NASA M20 waypoint final localization matched by site/drive",
                "waypoint_source": WAYPOINTS_URL,
                "waypoint_yaw_raw_deg": yaw_raw,
            },
        })

    manifest = {
        "contract_version": "0.1",
        "description": "Perseverance Navcam validation cases. Truth fields are validation-only and are not included in request.",
        "image_source": "NASA/JPL Mars 2020 Raw Images feed; full-resolution public products",
        "waypoint_source": WAYPOINTS_URL,
        "cases": cases,
    }
    output_path = OUT / "manifest.json"
    output_path.write_text(json.dumps(manifest, indent=2, ensure_ascii=False) + "\n",
                           encoding="utf-8", newline="\n")
    print(f"Wrote {len(cases)} contract-ready cases to {output_path}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
