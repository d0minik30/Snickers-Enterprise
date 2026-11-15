#!/usr/bin/env python3
"""Download and verify the Perseverance test photos listed in data/test_photos/manifest.json.

manifest.json is the one committed list of test cases with known positions (backend/CONTRACTS.md
section 4): one case per rover pose (NASA site/drive) with the photos taken there, each photo's source
links, SHA-256, camera calibration and a review record, and the truth (position from NASA's localized
rover waypoint, headings from the image labels) kept apart. It holds no skyline: skyline requests are
generated from it by backend/skyline/scripts/build_test_requests.py.

This script:
  * downloads every listed photo and its raw-feed label into data/test_photos/images/ (git-ignored);
  * checks each image against the SHA-256 in the manifest (a mismatch is an error, unless
    --update-checksums is given);
  * refreshes calibration, time, links and truth from the label and the M20 waypoint file;
  * keeps every photo's `review` record exactly as it is (people fill it in);
  * with --add, adds photos by NASA image id: full-frame Navcam frames with a CAHVORE model, at a pose
    with a final localized waypoint, and not the second eye of a moment already in the case.

It never runs the skyline extractor. It uses only the CAHVORE camera geometry from backend/skyline
(skyline.camera, numpy only) to state each camera's field of view.

Run from the repository root with the backend environment:
    .\\backend\\.venv\\Scripts\\python.exe data/scripts/fetch_test_photos.py
    .\\backend\\.venv\\Scripts\\python.exe data/scripts/fetch_test_photos.py --add NLF_0048_0671201674_630ECM_N0031708NCAM00296_01_295J
"""
from __future__ import annotations

import argparse
import hashlib
import json
import struct
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "backend"))
from skyline.camera import Cahvore  # noqa: E402  (camera geometry only, not the extractor)

OUT = ROOT / "data" / "test_photos"
MANIFEST = OUT / "manifest.json"
IMAGE_DIR = OUT / "images"
WAYPOINTS_URL = "https://mars.nasa.gov/mmgis-maps/M20/Layers/json/M20_waypoints.json"
WAYPOINTS_CACHE = IMAGE_DIR / "M20_waypoints.json"
NASA_FEED = "https://mars.nasa.gov/rss/api/"
PAGE_URL = "https://mars.nasa.gov/mars2020/multimedia/raw-images/{id}"
USER_AGENT = "Snickers-Enterprise-test-data/2.0"
SCHEMA = "test_photos/2"
POSITION_SOURCE = "NASA M20 waypoint: final localization for the photo's site/drive"
HEADING_SOURCE = ("Image label: rover attitude quaternion (rover to north-east-down) applied to the "
                  "CAHVORE optical axis A")
NEW_REVIEW = {"skyline_visible": None, "usable": None, "notes": "", "reviewed_by": None}


class Refused(Exception):
    """A photo that cannot be a test case (cropped, not Navcam, no waypoint, ...)."""


# ------------------------------------------------------------------ network and files


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


def metadata_url(image_id: str) -> str:
    query = urllib.parse.urlencode({"feed": "raw_images", "category": "mars2020",
                                   "feedtype": "json", "id": image_id})
    return f"{NASA_FEED}?{query}"


def label(image_id: str, refresh: bool) -> dict:
    """The raw-image feed's record for this image (cached next to the image)."""
    path = IMAGE_DIR / f"{image_id}.label.json"
    if path.is_file() and not refresh:
        return json.loads(path.read_text(encoding="utf-8"))
    payload = json.loads(get(metadata_url(image_id)))
    records = payload.get("image") or payload.get("images") or []
    if isinstance(records, dict):
        records = [records]
    record = next((r for r in records if r.get("imageid") == image_id), None)
    if record is None:
        raise Refused(f"NASA image feed has no record for {image_id}")
    path.write_text(json.dumps(record, indent=2) + "\n", encoding="utf-8", newline="\n")
    return record


def png_size(data: bytes) -> tuple[int, int]:
    if data[:8] != b"\x89PNG\r\n\x1a\n":
        raise ValueError("not a PNG file")
    return struct.unpack(">II", data[16:24])


def image(photo: dict, update_checksums: bool) -> bytes:
    """The photo's bytes, downloaded if missing, checked against the manifest's SHA-256."""
    path = IMAGE_DIR / f"{photo['image_id']}.png"
    data = path.read_bytes() if path.is_file() else None
    want = photo.get("image_sha256")
    if data is None or (want and sha256(data) != want):
        data = get(photo["image_url"])  # missing, or a local copy that is damaged: fetch again
        path.write_bytes(data)
    have = sha256(data)
    if want and have != want:
        if not update_checksums:
            raise RuntimeError(f"{photo['image_id']}: NASA's image no longer matches the manifest checksum "
                               f"({have[:12]}... vs {want[:12]}...); rerun with --update-checksums if intended")
        print(f"  checksum updated: {want[:12]}... -> {have[:12]}...")
    photo["image_sha256"] = have
    return data


def sha256(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def waypoints(refresh: bool) -> dict[tuple[int, int], list[dict]]:
    if refresh or not WAYPOINTS_CACHE.is_file():
        WAYPOINTS_CACHE.write_bytes(get(WAYPOINTS_URL))
    doc = json.loads(WAYPOINTS_CACHE.read_text(encoding="utf-8"))
    by_pose: dict[tuple[int, int], list[dict]] = {}
    for feature in doc.get("features", []):
        p = feature.get("properties", {})
        if p.get("site") is not None and p.get("drive") is not None and p.get("final") == "y":
            by_pose.setdefault((int(p["site"]), int(p["drive"])), []).append(p)
    return by_pose


# ------------------------------------------------------------------ what a label says


def pose_of(record: dict) -> tuple[int, int]:
    return int(record["site"]), int(record["drive"])


def check_usable_product(record: dict) -> None:
    """Refuse products the skyline step can't use: not Navcam, or no camera model/attitude.

    Crops of the sensor (subframeRect) are fine: the feed states their camera model in the crop's own
    pixels. Whether a crop shows any sky is for the review (and the skyline step's sky_visible)."""
    instrument = str((record.get("camera") or {}).get("instrument", ""))
    if "NAVCAM" not in instrument.upper():
        raise Refused(f"not a Navcam frame ({instrument})")
    if not (record.get("camera") or {}).get("camera_model_component_list"):
        raise Refused("label has no camera model")
    if len(str(record.get("attitude", "")).strip("()").split(",")) != 4:
        raise Refused("label has no rover attitude")
    if not (record.get("image_files") or {}).get("full_res"):
        raise Refused("no full-resolution image")


def label_size(record: dict) -> tuple[int, int]:
    w, h = str((record.get("extended") or {}).get("dimension", "")).strip("()").split(",")[:2]
    return int(w), int(h)


def camera_of(record: dict) -> tuple[dict, Cahvore]:
    cam = record["camera"]
    width, height = label_size(record)
    model = Cahvore.from_components(cam["camera_model_component_list"], width, height)
    cy, cx = (height - 1) / 2, (width - 1) / 2
    lr = model.pixel_to_ray(np.array([-0.5, width - 0.5]), np.array([cy, cy]))
    tb = model.pixel_to_ray(np.array([cx, cx]), np.array([-0.5, height - 0.5]))
    angle = lambda a, b: round(float(np.degrees(np.arccos(np.clip(a @ b, -1, 1)))), 3)  # noqa: E731
    rect = str((record.get("extended") or {}).get("subframeRect", "")).strip("()").replace(" ", "")
    return {
        "model": str(cam.get("camera_model_type") or "CAHVORE"),
        "components": cam["camera_model_component_list"],
        "width_px": width, "height_px": height,
        "sensor_rect": rect or None,  # x, y, width, height on the sensor (1-based); crops start past 1,1
        "hfov_deg": angle(lr[0], lr[1]), "vfov_deg": angle(tb[0], tb[1]),
    }, model


def rover_to_ned(record: dict) -> np.ndarray:
    w, x, y, z = (float(v) for v in str(record["attitude"]).strip("()").split(","))
    return np.array([[1 - 2 * (y * y + z * z), 2 * (x * y - w * z), 2 * (x * z + w * y)],
                     [2 * (x * y + w * z), 1 - 2 * (x * x + z * z), 2 * (y * z - w * x)],
                     [2 * (x * z - w * y), 2 * (y * z + w * x), 1 - 2 * (x * x + y * y)]])


def axis_heading_and_elevation(record: dict, model: Cahvore) -> tuple[float, float]:
    """Truth: where the optical axis points (azimuth from north) and how far it looks up (+) or down (-)."""
    a = rover_to_ned(record) @ model.A
    heading = float(np.degrees(np.arctan2(a[1], a[0])) % 360)
    elevation = float(np.degrees(np.arcsin(np.clip(-a[2] / np.linalg.norm(a), -1, 1))))
    return heading, elevation


def moment(image_id: str) -> str:
    return image_id[9:19]  # spacecraft clock: both eyes of a stereo pair share it


# ------------------------------------------------------------------ the manifest


def photo_entry(record: dict, old: dict | None) -> dict:
    camera, _ = camera_of(record)
    image_id = record["imageid"]
    time_utc = record.get("date_taken_utc")
    if time_utc and not str(time_utc).endswith("Z"):
        time_utc = f"{time_utc}Z"
    return {
        "image_id": image_id,
        "instrument": record["camera"].get("instrument"),
        "sol": int(record["sol"]),
        "time_utc": time_utc,
        "source": record.get("link") or PAGE_URL.format(id=image_id),
        "metadata_url": metadata_url(image_id),
        "image_url": record["image_files"]["full_res"],
        "image_sha256": (old or {}).get("image_sha256"),
        "camera": camera,
        "review": dict((old or {}).get("review") or NEW_REVIEW),
    }


def case_truth(case: dict, records: dict[str, dict], by_pose: dict) -> dict:
    site, drive = (int(x) for x in case["pose"].split("/"))
    finals = by_pose.get((site, drive), [])
    if not finals:
        raise Refused(f"no final localized waypoint for site/drive {case['pose']}")
    first_sol = min(p["sol"] for p in case["photos"])
    # The rover stays put within one site/drive; if NASA localized it more than once, take the last fix
    # made no later than a day after the first photo.
    before = [p for p in finals if int(p.get("sol", 0)) <= first_sol + 1] or finals
    wp = max(before, key=lambda p: int(p.get("sol", 0)))
    headings, elevations = {}, {}
    for photo in case["photos"]:
        rec = records[photo["image_id"]]
        h, e = axis_heading_and_elevation(rec, camera_of(rec)[1])
        headings[photo["image_id"]] = round(h, 3)
        elevations[photo["image_id"]] = round(e, 2)
    return {
        "lat": float(wp["lat"]), "lon": float(wp["lon"]),
        "rover_heading_deg": round(float(wp["yaw"]) % 360, 3),
        "headings_deg": headings,
        "axis_elevation_deg": elevations,
        "waypoint": {"sol": int(wp["sol"]), "site": int(wp["site"]), "drive": int(wp["drive"])},
        "position_source": POSITION_SOURCE,
        "heading_source": HEADING_SOURCE,
    }


def add_photo(cases: list[dict], record: dict) -> str:
    """Put a new photo into its pose's case (creating it); returns the case name."""
    check_usable_product(record)
    site, drive = pose_of(record)
    pose = f"{site}/{drive}"
    case = next((c for c in cases if c["pose"] == pose), None)
    if case is None:
        case = {"name": f"site{site:03d}_drive{drive:04d}", "pose": pose, "sol": int(record["sol"]),
                "photos": [], "truth": {}}
        cases.append(case)
    image_id = record["imageid"]
    for p in case["photos"]:
        if p["image_id"] == image_id:
            raise Refused("already in the manifest")
        if moment(p["image_id"]) == moment(image_id):
            raise Refused(f"same moment as {p['image_id']} (the other eye of a stereo pair)")
    case["photos"].append(photo_entry(record, None))
    return case["name"]


def dumps(value, indent: int = 0, width: int = 110) -> str:
    """JSON with small objects and lists kept on one line, so the manifest stays short and diffable."""
    one = json.dumps(value, ensure_ascii=False, separators=(", ", ": "))
    if len(one) + indent <= width or not isinstance(value, (dict, list)) or not value:
        return one
    pad, inner = " " * indent, " " * (indent + 2)
    if isinstance(value, dict):
        items = [f"{inner}{json.dumps(k)}: {dumps(v, indent + 2, width)}" for k, v in value.items()]
        return "{\n" + ",\n".join(items) + f"\n{pad}}}"
    items = [f"{inner}{dumps(v, indent + 2, width)}" for v in value]
    return "[\n" + ",\n".join(items) + f"\n{pad}]"


def load_manifest() -> dict:
    if not MANIFEST.is_file():
        return {"schema": SCHEMA, "cases": []}
    doc = json.loads(MANIFEST.read_text(encoding="utf-8"))
    if doc.get("schema") != SCHEMA:
        raise SystemExit(f"{MANIFEST} is not a {SCHEMA} manifest")
    return doc


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--add", nargs="*", default=[], metavar="IMAGE_ID", help="NASA raw image ids to add")
    ap.add_argument("--update-checksums", action="store_true",
                    help="accept images whose bytes no longer match the recorded SHA-256")
    ap.add_argument("--refresh", action="store_true", help="fetch labels and waypoints again, not from the cache")
    args = ap.parse_args()

    IMAGE_DIR.mkdir(parents=True, exist_ok=True)
    doc = load_manifest()
    cases: list[dict] = doc["cases"]
    by_pose = waypoints(args.refresh)

    refused = []
    for image_id in args.add:
        try:
            record = label(image_id, args.refresh)
            if (pose_of(record)) not in by_pose:
                raise Refused(f"no final localized waypoint for site/drive {record['site']}/{record['drive']}")
            print(f"added   {image_id} -> {add_photo(cases, record)}")
        except Refused as why:
            refused.append((image_id, str(why)))
            print(f"refused {image_id}: {why}")

    records: dict[str, dict] = {}
    for case in cases:
        for photo in case["photos"]:
            image_id = photo["image_id"]
            record = label(image_id, args.refresh)
            check_usable_product(record)
            records[image_id] = record
            data = image(photo, args.update_checksums)
            if png_size(data) != label_size(record):
                raise RuntimeError(f"{image_id}: image is {png_size(data)}, label says {label_size(record)}")
            photo.update({k: v for k, v in photo_entry(record, photo).items() if k != "image_sha256"})
        case["photos"].sort(key=lambda p: (p["sol"], p["time_utc"] or "", p["image_id"]))
        case["sol"] = case["photos"][0]["sol"]
        case["truth"] = case_truth(case, records, by_pose)
        n = len(case["photos"])
        print(f"ok      {case['name']:20} {n} photo{'s' if n != 1 else ''}")
    cases.sort(key=lambda c: tuple(int(x) for x in c["pose"].split("/")))

    manifest = {
        "schema": SCHEMA,
        "description": ("Perseverance Navcam test cases with known positions (backend/CONTRACTS.md section 4). "
                        "One case per rover pose. truth is for scoring only and never goes into a request. "
                        "Skyline requests are generated by backend/skyline/scripts/build_test_requests.py."),
        "image_source": "NASA/JPL Mars 2020 raw-image feed; full-resolution public products",
        "waypoint_source": WAYPOINTS_URL,
        "cases": cases,
    }
    MANIFEST.write_text(dumps(manifest) + "\n", encoding="utf-8", newline="\n")
    photos = sum(len(c["photos"]) for c in cases)
    print(f"wrote {len(cases)} cases, {photos} photos to {MANIFEST.relative_to(ROOT)}")
    for image_id, why in refused:
        print(f"  not added: {image_id}: {why}")
    return 1 if refused else 0


if __name__ == "__main__":
    sys.exit(main())
