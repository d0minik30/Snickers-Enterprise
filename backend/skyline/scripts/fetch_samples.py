"""Download a few real Perseverance Navcam photos, with their metadata, for developing the sky finder.

They come from NASA's public Mars 2020 raw-image feed and land in backend/skyline/samples/ (git-ignored:
the repo keeps images out). Each photo is saved as <id>.png next to <id>.json, the feed's record for it
(camera model, rover attitude, mast angles). Sols 17-18 are at site 3, near the landing site.

Run from the repo root:  py -3.10 backend/skyline/scripts/fetch_samples.py
"""

from __future__ import annotations

import json
import sys
import urllib.request
from pathlib import Path

FEED = 'https://mars.nasa.gov/rss/api/?feed=raw_images&category=mars2020&feedtype=json&id={id}'
USER_AGENT = 'skyline-dev/0.1'
SAMPLES = Path(__file__).resolve().parents[1] / 'samples'

# One frame per distinct pointing (camera-axis azimuth / elevation in the rover frame, degrees).
IMAGE_IDS = [
    'NLF_0018_0668545642_177ECM_N0030578NCAM00190_01_290J',  #   1.5 / -5.6
    'NLF_0018_0668547197_285ECM_N0030578NCAM00189_01_290J',  #   3.3 / -1.9
    'NLF_0017_0668454934_320ECM_N0030578NCAM00184_01_290J',  # 280.4 / +7.1
    'NLF_0017_0668453452_115ECM_N0030578NCAM00186_01_290J',  # 306.9 / +11.2
    'NLF_0018_0668555532_151ECM_N0030578NCAM00188_01_290J',  # 335.2 / -11.7
    'NLF_0017_0668451937_008ECM_N0030578NCAM00195_01_290J',  # 350.5 / -3.4
    # Later drives: arm partly in view (45, 46), then clean horizons with the crater rim (47, 48).
    'NLF_0045_0670932866_237ECM_N0031416NCAM00298_01_295J',  # 300 / -2.0, drive 1416
    'NLF_0046_0671024021_615ECM_N0031416NCAM00298_01_295J',  # 300 / -2.0, drive 1416
    'NLF_0047_0671121153_414ECM_N0031708NCAM00405_01_295J',  # 101 / -1.6, drive 1708
    'NLF_0048_0671201674_630ECM_N0031708NCAM00296_01_295J',  #  99 / -1.8, drive 1708
]
# The first six are robotic-arm checkout shots: the arm crosses the horizon, which tests near-object distrust.


def get(url: str) -> bytes:
    req = urllib.request.Request(url, headers={'User-Agent': USER_AGENT})
    with urllib.request.urlopen(req, timeout=60) as res:
        return res.read()


def main() -> int:
    SAMPLES.mkdir(parents=True, exist_ok=True)
    for image_id in IMAGE_IDS:
        png, meta = SAMPLES / f'{image_id}.png', SAMPLES / f'{image_id}.json'
        if png.exists() and meta.exists():
            print(f'have  {image_id}')
            continue
        reply = json.loads(get(FEED.format(id=image_id)))
        record = reply['image'][0] if 'image' in reply else reply  # the by-id feed wraps the record
        meta.write_text(json.dumps(record, indent=1), encoding='utf-8')
        png.write_bytes(get(record['image_files']['full_res']))
        print(f'got   {image_id}')
    return 0


if __name__ == '__main__':
    sys.exit(main())
