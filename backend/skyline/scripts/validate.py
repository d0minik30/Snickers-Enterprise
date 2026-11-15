"""Validation: real Perseverance photos with known positions, through the whole chain.

For each rover pose (case) in the test-photo manifest:
  the generated POST /locate body (the skyline step's output for the case's usable photos) -> the engine
  (backend/marsloc, unchanged) -> compare with the truth: position error in metres, whether the truth lies
  inside the stated uncertainty circles, each photo's heading error, and how well the traced skyline fits
  the terrain at the true position.

Inputs (backend/CONTRACTS.md section 4):
  data/test_photos/manifest.json       the cases and their truth (NASA's localized waypoint for the pose,
                                       each camera's heading from its label). Read only here, for scoring;
                                       never put in a request.
  backend/cache/test_requests/         the requests, generated from the manifest by
                                       build_test_requests.py (rerun it after the skyline step changes).

Needs the CTX DEM and the precomputed horizons (see backend/skyline/README.md).
Run from the repo root:
    backend/.venv/Scripts/python.exe backend/skyline/scripts/build_test_requests.py
    backend/.venv/Scripts/python.exe backend/skyline/scripts/validate.py --out backend/skyline/out/validation.json \
        --app-copy frontend/public/validation.json
"""

from __future__ import annotations

import argparse
import hashlib
import json
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

import numpy as np

HERE = Path(__file__).resolve().parent
BACKEND = HERE.parents[1]
REPO = BACKEND.parent
sys.path.insert(0, str(BACKEND))
sys.path.insert(0, str(HERE))

from engine_result import observations, result_json  # noqa: E402
from marsloc import geo  # noqa: E402
from marsloc.horizon.render import render_horizon  # noqa: E402
from marsloc.horizon.store import HorizonStore  # noqa: E402
from marsloc.match.matcher import Matcher  # noqa: E402
from marsloc.terrain import Terrain  # noqa: E402

MANIFEST = REPO / 'data' / 'test_photos' / 'manifest.json'
REQUESTS = BACKEND / 'cache' / 'test_requests'
MATCHER_NOTE = 'The matcher is not yet validated (known to be uncalibrated): read these errors as a baseline to rerun after the engine fixes.'


def fit_at_truth(terrain, body: dict, ids: list[str], truth: dict) -> dict:
    """How well the traced skylines match the terrain AT THE TRUE position and headings.

    Small residuals here mean the skyline step did its job, so any position error is the search's.
    Split by the distance of the terrain forming the horizon: 20 m elevation data can't show what is
    within about 2 km (rocks, ledges), so 'far' is the fair measure.
    """
    far_res, near_res = [], []
    for photo, image_id in zip(body['photos'], ids):
        s = [x for x in photo['samples'] if x['weight'] >= 0.5]
        if not s:
            continue
        az = np.array([x['az_offset_deg'] for x in s])
        el = np.array([x['elev_deg'] for x in s])
        hz = render_horizon(terrain, truth['lat'], truth['lon'], eye_height_m=photo['eye_height_m'],
                            azimuths_deg=(truth['headings_deg'][image_id] + az) % 360)
        res = el - hz.elev_deg
        ok = np.isfinite(res)
        far = ok & (hz.dist_m > 2000)
        far_res += res[far].tolist()
        near_res += res[ok & ~far].tolist()

    def stats(r):
        if not r:
            return None
        r = np.array(r)
        med = float(np.median(r))
        return {'n': int(r.size), 'median_deg': round(med, 3), 'mad_deg': round(float(np.median(np.abs(r - med))), 3)}
    return {'far': stats(far_res), 'near': stats(near_res)}


def load_cases() -> tuple[list[dict], dict]:
    """(manifest cases, request index). Stops with a hint when the requests haven't been built."""
    index_path = REQUESTS / 'index.json'
    if not index_path.is_file():
        raise SystemExit('No generated requests: run backend/skyline/scripts/build_test_requests.py first.')
    index = json.loads(index_path.read_text(encoding='utf-8'))
    if index.get('manifest_sha256') != hashlib.sha256(MANIFEST.read_bytes()).hexdigest():
        raise SystemExit('The manifest changed since the requests were built: rerun build_test_requests.py.')
    return json.loads(MANIFEST.read_text(encoding='utf-8'))['cases'], index


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
    cases, index = load_cases()
    for case in cases:
        pose = case['pose']
        if args.only and pose not in args.only:
            continue
        entry = index['cases'][case['name']]
        skipped = [s['image_id'] for s in entry['skipped']]
        if not entry['request']:
            print(f'{pose}: no usable photo showing sky, skipped')
            continue
        t0 = time.perf_counter()
        body = json.loads((REQUESTS / entry['request']).read_text(encoding='utf-8'))
        ids = [p['image_id'] for p in entry['photos']]  # photo_k is the k-th photo that went to the engine
        assert [p['id'] for p in body['photos']] == [p['id'] for p in entry['photos']], case['name']
        res = result_json(matcher.locate(observations(body), prior=None, top_k=5), terrain, spacing)
        truth = case['truth']
        best = res['best']
        err = float(geo.distance_m(truth['lat'], truth['lon'], best['lat'], best['lon']))
        bearing = float(geo.bearing_deg(truth['lat'], truth['lon'], best['lat'], best['lon']))
        headings = []
        for k, image_id in enumerate(ids):
            found = next(p['heading_deg'] for p in res['photos'] if p['id'] == f'photo_{k + 1}')
            true = case['truth']['headings_deg'][image_id]
            headings.append({'id': f'photo_{k + 1}', 'image_id': image_id, 'true_deg': round(true, 2),
                             'found_deg': found, 'error_deg': round(((found - true + 540) % 360) - 180, 2)})
        trusted = [s['weight'] >= 0.5 for p in body['photos'] for s in p['samples']]
        results.append({
            'name': f"site {pose.split('/')[0]} drive {pose.split('/')[1]} (sol {case['sol']})",
            'pose': pose, 'sol': case['sol'],
            'truth': {'lat': truth['lat'], 'lon': truth['lon'], 'source': 'NASA Mars 2020 rover waypoint (localized)'},
            'photos': ids,
            'skipped_photos': skipped,  # not usable per the manifest's review, or no sky in them
            'trusted_share': round(sum(trusted) / max(1, len(trusted)), 3),
            'error_m': round(err, 1),
            'error_bearing_deg': round(bearing, 1),
            'inside_68': err <= best['uncertainty_m'],
            'inside_95': err <= best['uncertainty_95_m'],
            'headings': headings,
            'skyline_at_truth': fit_at_truth(terrain, body, ids, truth),
            'seconds': round(time.perf_counter() - t0, 1),
            'request': body,
            'result': res,
        })
        h = ', '.join(f"{x['error_deg']:+.1f}" for x in headings)
        far = results[-1]['skyline_at_truth']['far']
        h += f"  skyline vs truth (far) {far['median_deg']:+.2f}±{far['mad_deg']:.2f}" if far else '  skyline vs truth: no far samples'
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
            'cases_from': f"data/test_photos/manifest.json (requests built {index['generated_utc']} by build_test_requests.py)",
            'run_utc': datetime.now(timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ'),
            'note': 'No prior and no truth were given to the engine; the truth is used only for scoring. ' + MATCHER_NOTE,
            'matcher_validated': False,
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
