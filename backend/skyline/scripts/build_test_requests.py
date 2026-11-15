"""Build the POST /locate request for every usable test case, from the downloaded test photos.

Reads data/test_photos/manifest.json and the photos in data/test_photos/images/ (download them with
data/scripts/fetch_test_photos.py), runs each usable photo through the skyline step, and writes one
request per case, exactly as the app would send it (CONTRACTS.md section 2), to
backend/skyline/out/test_requests/<case>.json (git-ignored). Photos of one case share a rover pose,
so their relative headings are known. The manifest's truth map is not read here.

Run from the repo root:  py -3.10 backend/skyline/scripts/build_test_requests.py
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
REPO = HERE.parents[2]
sys.path.insert(0, str(HERE.parents[1]))
sys.path.insert(0, str(HERE))

from engine_result import locate_body  # noqa: E402

MANIFEST = REPO / 'data' / 'test_photos' / 'manifest.json'
IMAGES = REPO / 'data' / 'test_photos' / 'images'
OUT = HERE.parent / 'out' / 'test_requests'


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.split('\n')[0])
    ap.add_argument('--only', nargs='*', default=[], help='case names to build, e.g. site_3_drive_578')
    args = ap.parse_args()
    manifest = json.loads(MANIFEST.read_text(encoding='utf-8'))
    OUT.mkdir(parents=True, exist_ok=True)
    built = 0
    for case in manifest['cases']:
        if args.only and case['name'] not in args.only:
            continue
        ids = [p['image_id'] for p in case['photos'] if p['review']['usable']]
        missing = [i for i in ids if not (IMAGES / f'{i}.png').exists()]
        if missing:
            print(f"{case['name']}: {len(missing)} photo(s) not downloaded; run data/scripts/fetch_test_photos.py")
            continue
        if not ids:
            print(f"{case['name']}: no usable photo ({case['review']['notes']})")
            continue
        skipped: list[str] = []
        body = locate_body(ids, skipped, image_dir=IMAGES)
        used = [i for i in ids if i not in skipped]  # photo_k in the request is the k-th of these
        if not used:
            print(f"{case['name']}: no photo with sky after tracing")
            continue
        (OUT / f"{case['name']}.json").write_text(json.dumps({
            'case': case['name'], 'photo_ids': used, 'skipped_photos': skipped, 'request': body,
        }), encoding='utf-8')
        built += 1
        print(f"{case['name']}: {len(used)} photo(s)" + (f", {len(skipped)} without sky" if skipped else ''))
    print(f'{built} request(s) in {OUT}')
    return 0


if __name__ == '__main__':
    sys.exit(main())
