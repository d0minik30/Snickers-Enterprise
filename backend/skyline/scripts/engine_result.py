"""Run the real engine on real photos and save its answer in the CONTRACTS.md result format.

Until the engine has its HTTP server, this is how the app gets a real result to build the result
view on. It traces the photos with the skyline step, builds the POST /locate body exactly as the app
does (CONTRACTS.md section 2), hands it to Person 1's matcher (backend/marsloc, used as is), and
writes the answer as CONTRACTS.md section 3 JSON. Nothing in the answer is made up: fields the engine
does not compute yet are null, and the warnings say so.

Needs: the CTX DEM in backend/data_local/terrain/ and the precomputed horizons
(py -3.10 backend/scripts/build_horizons.py), plus the sample photos (scripts/fetch_samples.py).

Run from the repo root:
    py -3.10 backend/skyline/scripts/engine_result.py --pose 3/578 --out backend/skyline/out/engine-sol17-18.json         --app-copy frontend/lib/locate/fixtures/engine-sol17-18.json

--out gets everything (the full request, for replaying it). --app-copy is the copy the app loads: compact,
without the request's samples (the app only needs each photo's camera from the request).
"""

from __future__ import annotations

import argparse
import json
import sys
from datetime import datetime, timezone
from pathlib import Path

import numpy as np

BACKEND = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(BACKEND))

from marsloc import __version__ as ENGINE_VERSION  # noqa: E402
from marsloc.horizon.store import HorizonStore  # noqa: E402
from marsloc.match.matcher import Matcher  # noqa: E402
from marsloc.match.resample import PhotoObservation  # noqa: E402
from marsloc.terrain import Terrain  # noqa: E402
from skyline.metadata import camera_setup, load_image  # noqa: E402
from skyline.pipeline import CONTRACT_VERSION, process  # noqa: E402

SAMPLES = BACKEND / 'skyline' / 'samples'


def relative_headings(diagnostics: list[dict]) -> list[float | None]:
    """Same rule as the app (frontend/lib/locate/session.ts): one rover pose turns together."""
    if not diagnostics:
        return []
    first = diagnostics[0]
    shared = len(diagnostics) > 1 and first['rover_pose'] is not None and all(
        d['rover_pose'] == first['rover_pose'] and d['rover_axis_azimuth_deg'] is not None for d in diagnostics)
    if not shared:
        return [None] * len(diagnostics)
    base = first['rover_axis_azimuth_deg']
    return [round(((d['rover_axis_azimuth_deg'] - base + 540) % 360) - 180, 4) for d in diagnostics]


def locate_body(image_ids: list[str], skipped: list[str] | None = None) -> dict:
    """The POST /locate body for these photos. Photos with no sky in them are left out (and listed in
    `skipped`): their skyline is all weight 0, so they could only add noise."""
    photos, diags = [], []
    for image_id in image_ids:
        png, meta = SAMPLES / f'{image_id}.png', SAMPLES / f'{image_id}.json'
        img, exif = load_image(png.read_bytes())
        try:
            out = process(img, camera_setup(img.shape[1], img.shape[0], {}, exif, json.loads(meta.read_text())))
        except ValueError:  # e.g. the camera points almost straight down: no skyline, no azimuth
            if skipped is not None:
                skipped.append(image_id)
            continue
        if not out.diagnostics['sky_visible'] or not any(s['weight'] > 0 for s in out.photo['samples']):
            if skipped is not None:
                skipped.append(image_id)
            continue
        photos.append(out.photo)
        diags.append(out.diagnostics)
    rel = relative_headings(diags)
    return {
        'contract_version': CONTRACT_VERSION,
        'photos': [{**p, 'id': f'photo_{k + 1}', 'relative_heading_deg': rel[k]} for k, p in enumerate(photos)],
        'options': {'top_k': 5, 'include_likelihood_grid': True, 'include_residuals': True},
    }


def observations(body: dict) -> list[PhotoObservation]:
    obs = []
    for p in body['photos']:
        s = p['samples']
        obs.append(PhotoObservation(
            az_offset_deg=[x['az_offset_deg'] for x in s], elev_deg=[x['elev_deg'] for x in s],
            weight=[x['weight'] for x in s], id=p['id'], eye_height_m=p['eye_height_m'],
            horizon_uncertainty_deg=p['horizon_uncertainty_deg'], relative_heading_deg=p['relative_heading_deg'],
        ))
    return obs


def _f(x: float, nd: int) -> float | None:
    return None if x is None or not np.isfinite(x) else round(float(x), nd)


def result_json(res, terrain, spacing_m: float) -> dict:
    """MatchResult -> CONTRACTS.md section 3."""
    best = res.best
    grid = res.grid
    scale = 255
    q = np.rint(np.nan_to_num(res.likelihood, nan=0.0) * scale).astype(int)
    rows, cols = np.nonzero(q > 0)
    if rows.size:
        r0, r1, c0, c1 = rows.min(), rows.max() + 1, cols.min(), cols.max() + 1
    else:
        r0, r1, c0, c1 = 0, grid.rows, 0, grid.cols
    lat_top = grid.lat_max - r0 * grid.dlat
    lon_left = grid.lon_min + c0 * grid.dlon
    likelihood_grid = {
        'bounds': [[round(lat_top - (r1 - r0) * grid.dlat, 7), round(lon_left, 7)],
                   [round(lat_top, 7), round(lon_left + (c1 - c0) * grid.dlon, 7)]],
        'rows': int(r1 - r0), 'cols': int(c1 - c0),
        'cell_size_m': {k: round(v, 1) for k, v in grid.cell_size_m.items()},
        'scale': scale,
        'values': q[r0:r1, c0:c1].tolist(),
    }
    photos = []
    for fit in best.photos:
        bins = np.flatnonzero(np.isfinite(fit.observed_elev_deg))
        photos.append({
            'id': fit.id,
            'heading_deg': _f(fit.heading_deg % 360, 2),
            'horizon_shift_deg': _f(fit.horizon_shift_deg, 3),
            'rms_residual_deg': _f(fit.rms_residual_deg, 3),
            'median_abs_residual_deg': _f(fit.median_abs_residual_deg, 3),
            'inlier_fraction': _f(fit.inlier_fraction, 3),
            'residuals': [{
                'az_offset_deg': _f(fit.az_offset_deg[i], 2), 'observed_elev_deg': _f(fit.observed_elev_deg[i], 3),
                'model_elev_deg': _f(fit.model_elev_deg[i], 3), 'residual_deg': _f(fit.residual_deg[i], 3),
                'distance_m': _f(fit.distance_m[i], 0), 'used': bool(fit.used[i]),
            } for i in bins],
        })
    return {
        'contract_version': CONTRACT_VERSION,
        'status': res.status,
        'warnings': list(res.warnings) + ['dominant_feature: not computed by this engine version yet'],
        'best': {
            'lat': _f(best.lat, 6), 'lon': _f(best.lon, 6), 'east_m': _f(best.east_m, 1), 'north_m': _f(best.north_m, 1),
            'ground_elevation_m': _f(best.ground_m, 1), 'heading_deg': _f(best.heading_deg % 360, 2),
            'score': _f(best.score, 3), 'probability': _f(best.probability, 3),
            'uncertainty_m': _f(res.uncertainty_m, 0), 'uncertainty_95_m': _f(res.uncertainty_95_m, 0),
        },
        'candidates': [{
            'rank': c.rank, 'lat': _f(c.lat, 6), 'lon': _f(c.lon, 6), 'east_m': _f(c.east_m, 1), 'north_m': _f(c.north_m, 1),
            'heading_deg': _f(c.heading_deg % 360, 2), 'score': _f(c.score, 3), 'probability': _f(c.probability, 3),
        } for c in res.candidates],
        'likelihood_grid': likelihood_grid,
        'dominant_feature': None,
        'photos': photos,
        'engine': {
            'version': ENGINE_VERSION, 'terrain_sources': list(terrain.source_ids),
            'candidate_spacing_m': spacing_m, 'timing_ms': res.timing_ms,
        },
    }


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.split('\n')[0])
    ap.add_argument('--pose', help='all sample photos taken at this rover pose (site/drive), e.g. 3/578')
    ap.add_argument('--ids', nargs='*', default=[], help='sample image ids instead of --pose')
    ap.add_argument('--out', type=Path, required=True)
    ap.add_argument('--app-copy', type=Path, default=None)
    args = ap.parse_args()

    ids = list(args.ids)
    if args.pose:
        for meta in sorted(SAMPLES.glob('*.json')):
            rec = json.loads(meta.read_text())
            if f"{rec.get('site')}/{rec.get('drive')}" == args.pose:
                ids.append(meta.stem)
    if not ids:
        print('no photos: give --pose or --ids')
        return 1

    body = locate_body(ids)
    terrain = Terrain.open()
    store = HorizonStore.load()
    matcher = Matcher(terrain, store)
    res = matcher.locate(observations(body), prior=None, top_k=body['options']['top_k'])
    spacing = round(store.grid.cell_size_m['north_south'])
    out = {
        'source': {
            'what': 'A real answer of the localization engine (backend/marsloc), saved for building the app.',
            'photos': ids,
            'pose': args.pose,
            'run_utc': datetime.now(timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ'),
            'note': 'No prior and no truth were given to the engine.',
        },
        'request': body,
        'result': result_json(res, terrain, spacing),
    }
    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(json.dumps(out, indent=1), encoding='utf-8')
    if args.app_copy:
        slim = json.loads(json.dumps(out))
        for p in slim['request']['photos']:
            p['samples'] = []
        slim['source']['note'] += ' Request samples left out of this copy (see the full file).'
        args.app_copy.parent.mkdir(parents=True, exist_ok=True)
        args.app_copy.write_text(json.dumps(slim, separators=(',', ':')), encoding='utf-8')
    r = out['result']
    print(f"{r['status']}: best {r['best']['lat']}, {r['best']['lon']} "
          f"({r['best']['east_m']} m E, {r['best']['north_m']} m N of the landing site), heading {r['best']['heading_deg']}, "
          f"±{r['best']['uncertainty_m']} m (95 %: {r['best']['uncertainty_95_m']} m), score {r['best']['score']}, "
          f"p {r['best']['probability']}")
    for w in r['warnings']:
        print('  warning:', w)
    print(f'written to {args.out}' + (f' and {args.app_copy}' if args.app_copy else ''))
    return 0


if __name__ == '__main__':
    sys.exit(main())
