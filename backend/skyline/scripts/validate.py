"""Validation: real Perseverance photos with known positions, through the whole chain.

For each rover pose (site/drive) in the case list:
  photos -> skyline step -> the POST /locate body the app sends -> the engine (backend/marsloc, unchanged)
  -> compare with the truth: position error in metres, whether the truth lies inside the stated
     uncertainty circles, and each photo's heading error.

The truth (NASA's localized waypoint for the pose, and each camera's heading from its label) is read
only here, for scoring. It is never put in the request the engine sees.

Case list: work/m20_candidates.json (raw Navcam images from https://mars.nasa.gov/mars2020/multimedia/raw-images/
with the rover waypoint for their site/drive). Photos and their raw-image records are downloaded into
backend/skyline/samples/ (git-ignored).

Needs the CTX DEM and the precomputed horizons (see backend/skyline/README.md).
Run from the repo root:
    py -3.10 backend/skyline/scripts/validate.py --out backend/skyline/out/validation.json \\
        --app-copy frontend/public/validation.json
"""

from __future__ import annotations

import argparse
import json
import math
import sys
import time
from collections import OrderedDict
from datetime import datetime, timezone
from pathlib import Path

import numpy as np

HERE = Path(__file__).resolve().parent
BACKEND = HERE.parents[1]
REPO = BACKEND.parent
sys.path.insert(0, str(BACKEND))
sys.path.insert(0, str(HERE))

from engine_result import locate_body, observations, result_json  # noqa: E402
from fetch_samples import FEED, SAMPLES, get  # noqa: E402
from marsloc import geo  # noqa: E402
from marsloc.horizon.store import HorizonStore  # noqa: E402
from marsloc.match.matcher import Matcher  # noqa: E402
from marsloc.terrain import Terrain  # noqa: E402
from skyline.camera import Cahvore  # noqa: E402

CASES = REPO / 'work' / 'm20_candidates.json'


def download(image_id: str, url: str) -> bool:
    """Photo and its raw-image record into samples/."""
    png, meta = SAMPLES / f'{image_id}.png', SAMPLES / f'{image_id}.json'
    if not meta.exists():
        reply = json.loads(get(FEED.format(id=image_id)))
        record = reply['image'][0] if 'image' in reply else reply
        meta.write_text(json.dumps(record, indent=1), encoding='utf-8')
    record = json.loads(meta.read_text())
    if not png.exists():
        png.write_bytes(get(record['image_files'].get('full_res') or url))
    return True


def true_heading(image_id: str) -> float:
    """Where the camera truly pointed, from the label's attitude (for scoring only)."""
    rec = json.loads((SAMPLES / f'{image_id}.json').read_text())
    w, x, y, z = (float(v) for v in rec['attitude'].strip('()').split(','))
    R = np.array([[1 - 2 * (y * y + z * z), 2 * (x * y - w * z), 2 * (x * z + w * y)],
                  [2 * (x * y + w * z), 1 - 2 * (x * x + z * z), 2 * (y * z - w * x)],
                  [2 * (x * z - w * y), 2 * (y * z + w * x), 1 - 2 * (x * x + y * y)]])  # rover -> north, east, down
    A = Cahvore.from_components(rec['camera']['camera_model_component_list'], 1280, 960).A
    a = R @ A
    return float(np.degrees(np.arctan2(a[1], a[0])) % 360)


def load_cases() -> list[dict]:
    """One case per rover pose; one camera per moment (a stereo pair counts once: left preferred)."""
    by_pose: dict[tuple[int, str], dict] = OrderedDict()
    for c in json.loads(CASES.read_text()):
        key = (int(c['site']), str(c['drive']))
        case = by_pose.setdefault(key, {'site': key[0], 'drive': key[1], 'sol': c['sol'], 'truth': c['waypoint'], 'images': {}})
        moment = c['imageid'][9:19]  # spacecraft clock: the two eyes of a stereo pair share it
        prev = case['images'].get(moment)
        if prev is None or (prev['instrument'] != 'NAVCAM_LEFT' and c['instrument'] == 'NAVCAM_LEFT'):
            case['images'][moment] = c
    return sorted(by_pose.values(), key=lambda k: (k['site'], int(k['drive'])))


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.split('\n')[0])
    ap.add_argument('--out', type=Path, required=True)
    ap.add_argument('--app-copy', type=Path, default=None)
    ap.add_argument('--only', nargs='*', default=[], help='site/drive poses to run, e.g. 3/578')
    args = ap.parse_args()

    terrain = Terrain.open()
    store = HorizonStore.load()
    matcher = Matcher(terrain, store)
    spacing = round(store.grid.cell_size_m['north_south'])
    results = []
    for case in load_cases():
        pose = f"{case['site']}/{case['drive']}"
        if args.only and pose not in args.only:
            continue
        ids = [c['imageid'] for c in case['images'].values() if download(c['imageid'], c['url'])]
        if not ids:
            print(f'{pose}: no usable full-frame photo, skipped')
            continue
        t0 = time.perf_counter()
        skipped: list[str] = []
        body = locate_body(ids, skipped)
        ids = [i for i in ids if i not in skipped]  # photo_k is the k-th photo that went to the engine
        if not ids:
            print(f'{pose}: no photo shows any sky, skipped')
            continue
        res = result_json(matcher.locate(observations(body), prior=None, top_k=5), terrain, spacing)
        truth = case['truth']
        best = res['best']
        err = float(geo.distance_m(truth['lat'], truth['lon'], best['lat'], best['lon']))
        bearing = float(geo.bearing_deg(truth['lat'], truth['lon'], best['lat'], best['lon']))
        headings = []
        for k, image_id in enumerate(ids):
            found = next(p['heading_deg'] for p in res['photos'] if p['id'] == f'photo_{k + 1}')
            true = true_heading(image_id)
            headings.append({'id': f'photo_{k + 1}', 'image_id': image_id, 'true_deg': round(true, 2),
                             'found_deg': found, 'error_deg': round(((found - true + 540) % 360) - 180, 2)})
        trusted = [s['weight'] >= 0.5 for p in body['photos'] for s in p['samples']]
        results.append({
            'name': f"site {case['site']} drive {case['drive']} (sol {case['sol']})",
            'pose': pose, 'sol': case['sol'],
            'truth': {'lat': truth['lat'], 'lon': truth['lon'], 'source': 'NASA Mars 2020 rover waypoint (localized)'},
            'photos': ids,
            'skipped_photos': skipped,  # no sky in them (e.g. a tile cut from the lower half of the sensor)
            'trusted_share': round(sum(trusted) / max(1, len(trusted)), 3),
            'error_m': round(err, 1),
            'error_bearing_deg': round(bearing, 1),
            'inside_68': err <= best['uncertainty_m'],
            'inside_95': err <= best['uncertainty_95_m'],
            'headings': headings,
            'seconds': round(time.perf_counter() - t0, 1),
            'request': body,
            'result': res,
        })
        h = ', '.join(f"{x['error_deg']:+.1f}" for x in headings)
        print(f"{pose:>8}  {res['status']:9}  error {err:6.1f} m  (±{best['uncertainty_m']:.0f} / ±{best['uncertainty_95_m']:.0f} m)"
              f"  photos {len(ids)}  trusted {results[-1]['trusted_share']:.0%}  heading errors {h}", flush=True)

    errors = np.array([r['error_m'] for r in results])
    summary = {
        'cases': len(results),
        'median_error_m': round(float(np.median(errors)), 1) if len(errors) else None,
        'mean_error_m': round(float(errors.mean()), 1) if len(errors) else None,
        'within_50_m': int((errors <= 50).sum()), 'within_100_m': int((errors <= 100).sum()),
        'inside_68': int(sum(r['inside_68'] for r in results)), 'inside_95': int(sum(r['inside_95'] for r in results)),
        'median_abs_heading_error_deg': round(float(np.median([abs(h['error_deg']) for r in results for h in r['headings']])), 2)
        if results else None,
    }
    report = {
        'source': {
            'what': 'Validation of the whole chain on real Perseverance Navcam photos with known positions.',
            'cases_from': 'work/m20_candidates.json (raw images with their rover waypoints)',
            'run_utc': datetime.now(timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ'),
            'note': 'No prior and no truth were given to the engine; the truth is used only for scoring.',
            'engine': results[0]['result']['engine'] if results else None,
        },
        'summary': summary,
        'cases': results,
    }
    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(json.dumps(report, indent=1), encoding='utf-8')
    if args.app_copy:
        slim = json.loads(json.dumps(report))
        for r in slim['cases']:
            for p in r['request']['photos']:
                p['samples'] = []
            for p in r['result']['photos']:
                p.pop('residuals', None)
        slim['source']['note'] += ' Samples and residuals left out of this copy (see the full file).'
        args.app_copy.parent.mkdir(parents=True, exist_ok=True)
        args.app_copy.write_text(json.dumps(slim, separators=(',', ':')), encoding='utf-8')
    print(json.dumps(summary, indent=1))
    return 0


if __name__ == '__main__':
    sys.exit(main())
