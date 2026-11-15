import json
from pathlib import Path
from PIL import Image
import numpy as np

manifest_path = Path("data/test_photos/manifest.json")
image_dir = Path("data/test_photos/images")
data = json.loads(manifest_path.read_text(encoding="utf-8"))

LANDING_LAT = 18.4447
LANDING_LON = 77.4508
RADIUS_M = 3396190.0

def haversine_m(lat1, lon1, lat2, lon2):
    p1, p2 = np.radians(lat1), np.radians(lat2)
    dp = p2 - p1
    dl = np.radians(lon2) - np.radians(lon1)
    h = np.sin(dp / 2)**2 + np.cos(p1) * np.cos(p2) * np.sin(dl / 2)**2
    return 2 * RADIUS_M * np.arcsin(np.sqrt(h))

cases = data["cases"]
print(f"Total cases: {len(cases)}, photos: {sum(len(c['photos']) for c in cases)}\n")

results = []

for case in cases:
    name = case["name"]
    sol = case.get("sol")
    truth = data["truth"][name]  # scoring only; never part of a request
    lat, lon = truth["lat"], truth["lon"]
    dist_base_m = haversine_m(LANDING_LAT, LANDING_LON, lat, lon)

    for photo in case["photos"]:
        heading = truth["photo_headings_deg"].get(photo["image_id"])
        img_path = image_dir / f"{photo['image_id']}.png"

        # Check if image exists
        img_ok = img_path.exists()
        width, height = (0, 0)
        top_mean = bot_mean = top_std = 0.0

        if img_ok:
            with Image.open(img_path) as img:
                width, height = img.size
                arr = np.array(img.convert("L"))
                top_quarter = arr[:height // 4, :]
                bottom_quarter = arr[3 * height // 4:, :]
                top_mean = float(np.mean(top_quarter))
                bot_mean = float(np.mean(bottom_quarter))
                top_std = float(np.std(top_quarter))

        # Camera pointing elevation from the calibration's camera vector
        camera_vector = photo.get("camera_calibration", {}).get("camera_vector", "")
        cam_elev = None
        if camera_vector:
            parts = camera_vector.strip("()").split(",")
            if len(parts) == 3:
                vx, vy, vz = float(parts[0]), float(parts[1]), float(parts[2])
                # Elevation angle above horizontal:
                cam_elev = np.degrees(np.arctan2(vz, np.hypot(vx, vy)))

        results.append({
            "name": name,
            "sol": sol,
            "dist_base_m": dist_base_m,
            "heading_deg": heading,
            "cam_elev_deg": cam_elev,
            "dims": (width, height),
            "top_mean": top_mean,
            "bot_mean": bot_mean,
            "top_std": top_std,
            "usable": photo["review"]["usable"],
        })

for r in results:
    elev_str = f"{r['cam_elev_deg']:+.1f}°" if r['cam_elev_deg'] is not None else "N/A"
    dist_str = f"{r['dist_base_m']:.0f} m"
    hdg_str = f"{r['heading_deg']:5.1f}°" if r['heading_deg'] is not None else "  N/A"
    print(f"Sol {r['sol']:4d} | {r['name']:22s} | Dist: {dist_str:7s} | Hdg: {hdg_str} | Elev: {elev_str:6s} | Top Mean: {r['top_mean']:5.1f} (std: {r['top_std']:4.1f}) | {'usable' if r['usable'] else 'not usable'}")
