"""Run the skyline step on every downloaded sample photo and write what it found to backend/skyline/out/.

For each photo: <id>.jpg (the traced line on the photo: green trusted, amber doubtful, magenta not
trusted) and <id>.json (the skyline the engine would get). Prints a one-line summary per photo.

Run from the repo root, after scripts/fetch_samples.py:  py -3.10 backend/skyline/scripts/run_samples.py
"""

from __future__ import annotations

import json
import sys
from collections import Counter
from pathlib import Path

HERE = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(HERE.parent))

from skyline.metadata import camera_setup, load_image  # noqa: E402
from skyline.pipeline import process  # noqa: E402


def main() -> int:
    samples, out_dir = HERE / 'samples', HERE / 'out'
    photos = sorted(samples.glob('*.png'))
    if not photos:
        print('no samples: run scripts/fetch_samples.py first')
        return 1
    out_dir.mkdir(exist_ok=True)
    for png in photos:
        img, exif = load_image(png.read_bytes())
        label = json.loads(png.with_suffix('.json').read_text())
        result = process(img, camera_setup(img.shape[1], img.shape[0], {}, exif, label))
        (out_dir / f'{png.stem}.jpg').write_bytes(result.debug_jpeg)
        (out_dir / f'{png.stem}.json').write_text(json.dumps(result.skyline, indent=1))
        s = result.skyline['samples']
        trusted = sum(1 for x in s if x['weight'] >= 0.5)
        reasons = Counter(r for r in result.trace['reason'] if r)
        print(f'{png.stem[:28]}  {trusted:4d}/{len(s)} samples trusted  cut: {dict(reasons)}')
    print(f'written to {out_dir}')
    return 0


if __name__ == '__main__':
    sys.exit(main())
