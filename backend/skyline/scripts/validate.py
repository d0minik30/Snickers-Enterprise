"""Validation: real Perseverance photos with known positions, through the whole chain.

For each case of data/test_photos/manifest.json whose request has been built
(scripts/build_test_requests.py), the request goes to the engine (backend/marsloc, unchanged), and
the answer is compared with the case's truth: position error in metres, whether the truth lies inside
the stated uncertainty circles, each photo's heading error, and how well the traced skyline matches
the terrain at the true position (so a miss can be told apart: the skyline step's, or the search's).

The truth (the manifest's top-level "truth" map) is read only here, for scoring. It is never in the
request the engine sees.

Needs the CTX DEM and the precomputed horizons (see backend/skyline/README.md).
Run from the repo root:
    py -3.10 data/scripts/fetch_test_photos.py
    py -3.10 backend/skyline/scripts/build_test_requests.py
    py -3.10 backend/skyline/scripts/validate.py --out backend/skyline/out/validation.json \\
        --app-copy frontend/lib/locate/fixtures/validation.json
"""

from __future__ import annotations

import argparse
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
REQUESTS = HERE.parent / 'out' / 'test_requests'


def fit_at_truth(terrain, body: dict, headings: list[float | None], truth: dict) -> dict:
    """How well the traced skylines match the terrain AT THE TRUE position and headings.

    Small residuals here mean the skyline step did its job, so any position error is the search's.
    Split by the distance of the terrain forming the horizon: 20 m elevation data can't show what is
    within about 2 km (rocks, ledges), so 'far' is the fair measure.
    """
    far_res, near_res = [], []
    for photo, heading in zip(body['photos'], headings):
        s = [x for x in photo['samples'] if x['weight'] >= 0.5]
        if not s or heading is None:
            continue
        az = np.array([x['az_offset_deg'] for x in s])
        el = np.array([x['elev_deg'] for x in s])
        hz = render_horizon(terrain, truth['lat'], truth['lon'], eye_height_m=photo['eye_height_m'],
                            azimuths_deg=(heading + az) % 360)
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


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.split('\n')[0])
    ap.add_argument('--out', type=Path, required=True)
    ap.add_argument('--app-copy', type=Path, default=None)
    ap.add_argument('--only', nargs='*', default=[], help='case names to run, e.g. site_3_drive_578')
    args = ap.parse_args()

    manifest = json.loads(MANIFEST.read_text(encoding='utf-8'))
    truths = manifest['truth']
    terrain = Terrain.open()
    store = HorizonStore.load()
    matcher = Matcher(terrain, store)
    spacing = round(store.grid.cell_size_m['north_south'])
    results = []
    for case in manifest['cases']:
        name = case['name']
        if args.only and name not in args.only:
            continue
        built = REQUESTS / f'{name}.json'
        if not built.exists():
            print(f'{name}: no request built (no usable photo, or run build_test_requests.py)')
            continue
        req = json.loads(built.read_text(encoding='utf-8'))
        body, ids = req['request'], req['photo_ids']
        truth = truths[name]
        t0 = time.perf_counter()
        res = result_json(matcher.locate(observations(body), prior=None, top_k=5), terrain, spacing)
        best = res['best']
        err = float(geo.distance_m(truth['lat'], truth['lon'], best['lat'], best['lon']))
        bearing = float(geo.bearing_deg(truth['lat'], truth['lon'], best['lat'], best['lon']))
        true_headings = [truth['photo_headings_deg'].get(i) for i in ids]
        headings = []
        for k, (image_id, true) in enumerate(zip(ids, true_headings)):
            found = next(p['heading_deg'] for p in res['photos'] if p['id'] == f'photo_{k + 1}')
            if true is None:
                continue
            headings.append({'id': f'photo_{k + 1}', 'image_id': image_id, 'true_deg': round(true, 2),
                             'found_deg': found, 'error_deg': round(((found - true + 540) % 360) - 180, 2)})
        trusted = [s['weight'] >= 0.5 for p in body['photos'] for s in p['samples']]
        pose = f"{case['pose']['site']}/{case['pose']['drive']}"
        results.append({
            'name': f"site {case['pose']['site']} drive {case['pose']['drive']} (sol {case['sol']})",
            'pose': pose, 'sol': case['sol'],
            'truth': {'lat': truth['lat'], 'lon': truth['lon'], 'source': 'NASA Mars 2020 rover waypoint (localized)'},
            'photos': ids,
            'skipped_photos': req.get('skipped_photos', []),
            'trusted_share': round(sum(trusted) / max(1, len(trusted)), 3),
            'error_m': round(err, 1),
            'error_bearing_deg': round(bearing, 1),
            'inside_68': err <= best['uncertainty_m'],
            'inside_95': err <= best['uncertainty_95_m'],
            'headings': headings,
            'skyline_at_truth': fit_at_truth(terrain, body, true_headings, truth),
            'seconds': round(time.perf_counter() - t0, 1),
            'request': body,
            'result': res,
        })
        h = ', '.join(f"{x['error_deg']:+.1f}" for x in headings)
        far = results[-1]['skyline_at_truth']['far']
        fit = f"skyline vs truth (far) {far['median_deg']:+.2f}±{far['mad_deg']:.2f}" if far else 'no far samples'
        print(f"{pose:>8}  {res['status']:9}  error {err:8.1f} m  (±{best['uncertainty_m']:.0f} / ±{best['uncertainty_95_m']:.0f} m)"
              f"  photos {len(ids)}  heading errors {h}  {fit}", flush=True)

    errors = np.array([r['error_m'] for r in results])
    all_heading = [abs(h['error_deg']) for r in results for h in r['headings']]
    summary = {
        'cases': len(results),
        'median_error_m': round(float(np.median(errors)), 1) if len(errors) else None,
        'mean_error_m': round(float(errors.mean()), 1) if len(errors) else None,
        'within_50_m': int((errors <= 50).sum()), 'within_100_m': int((errors <= 100).sum()),
        'inside_68': int(sum(r['inside_68'] for r in results)), 'inside_95': int(sum(r['inside_95'] for r in results)),
        'median_abs_heading_error_deg': round(float(np.median(all_heading)), 2) if all_heading else None,
    }
    report = {
        'source': {
            'what': 'Validation of the whole chain on real Perseverance Navcam photos with known positions.',
            'cases_from': 'data/test_photos/manifest.json',
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
