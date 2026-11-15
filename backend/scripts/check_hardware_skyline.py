import json
from pathlib import Path
from PIL import Image
import numpy as np

manifest_path = Path("data/test_photos/manifest.json")
image_dir = Path("data/test_photos/images")
data = json.loads(manifest_path.read_text(encoding="utf-8"))

for case in data["cases"]:
    name = case["name"]
    sol = case.get("sol")
    for photo in case["photos"]:
        img_path = image_dir / f"{photo['image_id']}.png"
        if not img_path.exists():
            continue
        with Image.open(img_path) as img:
            arr = np.array(img.convert("L"))
            h, w = arr.shape

            # Check bottom 20%
            bot_20 = arr[int(0.8 * h):, :]
            # Very dark or very saturated pixels (hardware, solar panel, RTG, wheels)
            hardware_mask = (bot_20 < 25) | (bot_20 > 240)
            hardware_frac = float(hardware_mask.mean())

            # Check top 25% (sky)
            top_25 = arr[:int(0.25 * h), :]
            # Smooth gradient characteristic of sky (std of row-to-row diffs is low)
            grad_y = np.abs(np.diff(top_25, axis=0))
            sky_score = float(grad_y.mean())

            print(f"Sol {sol:4d}: {name:22s} {photo['image_id'][:24]} | Size: {w}x{h} | Top Grad: {sky_score:4.1f} | Bot Hardware: {hardware_frac * 100:4.1f}%")
