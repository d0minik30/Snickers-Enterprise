"""Test photos -> skyline requests: run the current skyline step on the manifest's photos.

Reads data/test_photos/manifest.json (backend/CONTRACTS.md section 4; images fetched by
data/scripts/fetch_test_photos.py) and writes, into backend/cache/test_requests/ (git-ignored):
  <case name>.json  the POST /locate body for that rover pose (CONTRACTS.md section 2), exactly as the
                    app would build it: only usable photos that show sky, `relative_heading_deg` from
                    the shared rover pose. The truth is never read here, so it can't leak into a request.
  index.json        per case, which image each photo_k is, which photos were left out and why, and the
                    manifest's SHA-256 (validate.py warns when the manifest changed since).

With --review it also writes a review sheet into backend/cache/test_review/: every photo of the manifest
(usable or not) with its traced skyline drawn on it (green trusted, amber doubtful, magenta weight 0)
and index.html, so a person can confirm each photo's `review` record in the manifest.

Rerun it whenever the skyline step or the manifest changes. Run from the repo root:
    backend/.venv/Scripts/python.exe backend/skyline/scripts/build_test_requests.py --review
"""

from __future__ import annotations

import argparse
import hashlib
import html
import json
import sys
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path

HERE = Path(__file__).resolve().parent
BACKEND = HERE.parents[1]
REPO = BACKEND.parent
sys.path.insert(0, str(BACKEND))
sys.path.insert(0, str(HERE))

from engine_result import relative_headings  # noqa: E402
from skyline.metadata import camera_setup, load_image  # noqa: E402
from skyline.pipeline import CONTRACT_VERSION, process  # noqa: E402

MANIFEST = REPO / 'data' / 'test_photos' / 'manifest.json'
IMAGES = REPO / 'data' / 'test_photos' / 'images'
REQUESTS = BACKEND / 'cache' / 'test_requests'
REVIEW = BACKEND / 'cache' / 'test_review'
OPTIONS = {'top_k': 5, 'include_likelihood_grid': True, 'include_residuals': True}


def manifest_sha256() -> str:
    return hashlib.sha256(MANIFEST.read_bytes()).hexdigest()


def trace_photo(photo: dict) -> dict:
    """Run the skyline step on one photo. Returns what the request and the review sheet need."""
    image_id = photo['image_id']
    png, label = IMAGES / f'{image_id}.png', IMAGES / f'{image_id}.label.json'
    if not png.is_file() or not label.is_file():
        raise FileNotFoundError(f'{image_id}: image or label missing; run data/scripts/fetch_test_photos.py')
    data = png.read_bytes()
    if hashlib.sha256(data).hexdigest() != photo['image_sha256']:
        raise ValueError(f'{image_id}: image does not match the manifest checksum; rerun fetch_test_photos.py')
    img, exif = load_image(data)
    try:
        out = process(img, camera_setup(img.shape[1], img.shape[0], {}, exif, json.loads(label.read_text(encoding='utf-8'))))
    except ValueError as e:  # e.g. the camera points almost straight down: no skyline, no azimuth
        return {'out': None, 'error': str(e), 'sky_visible': False, 'n': 0, 'trusted': 0, 'zero': 0, 'reasons': {}}
    s = out.photo['samples']
    return {
        'out': out, 'error': None, 'sky_visible': bool(out.diagnostics['sky_visible']), 'n': len(s),
        'trusted': sum(1 for x in s if x['weight'] >= 0.5), 'zero': sum(1 for x in s if x['weight'] <= 0),
        'reasons': dict(Counter(r for r in out.trace['reason'] if r)),
    }


def why_left_out(photo: dict, t: dict) -> str | None:
    if photo['review'].get('usable') is False:
        return 'review: not usable'
    if t['out'] is None:
        return f"skyline step refused it: {t['error']}"
    if not t['sky_visible']:
        return 'no sky in the photo (sky_visible false)'
    if t['n'] - t['zero'] == 0:
        return 'every skyline sample has weight 0'
    return None


def build_case(case: dict, traced: dict[str, dict]) -> tuple[dict, dict]:
    """(POST /locate body, index entry) for one rover pose."""
    photos, diags, ids, skipped = [], [], [], []
    for photo in case['photos']:
        t = traced[photo['image_id']]
        reason = why_left_out(photo, t)
        if reason:
            skipped.append({'image_id': photo['image_id'], 'reason': reason})
            continue
        photos.append(t['out'].photo)
        diags.append(t['out'].diagnostics)
        ids.append(photo['image_id'])
    rel = relative_headings(diags)
    body = {
        'contract_version': CONTRACT_VERSION,
        'photos': [{**p, 'id': f'photo_{k + 1}', 'relative_heading_deg': rel[k]} for k, p in enumerate(photos)],
        'options': dict(OPTIONS),
    }
    samples = [s for p in body['photos'] for s in p['samples']]
    entry = {
        'pose': case['pose'], 'sol': case['sol'], 'request': f"{case['name']}.json",
        'photos': [{'id': f'photo_{k + 1}', 'image_id': i} for k, i in enumerate(ids)],
        'skipped': skipped,
        'trusted_share': round(sum(s['weight'] >= 0.5 for s in samples) / max(1, len(samples)), 3),
    }
    return body, entry


def review_sheet(cases: list[dict], traced: dict[str, dict], index: dict) -> Path:
    REVIEW.mkdir(parents=True, exist_ok=True)
    rows = []
    for case in cases:
        rows.append(f"<h2>{html.escape(case['name'])} <small>pose {case['pose']} · sol {case['sol']}</small></h2><div class=grid>")
        sent = {p['image_id'] for p in index['cases'][case['name']]['photos']}
        for photo in case['photos']:
            i, t, r = photo['image_id'], traced[photo['image_id']], photo['review']
            if t['out'] is not None:
                (REVIEW / f'{i}.jpg').write_bytes(t['out'].debug_jpeg)
                img = f'<a href="{i}.jpg"><img src="{i}.jpg" loading=lazy></a>'
            else:
                img = f"<div class=none>no trace: {html.escape(t['error'] or '')}</div>"
            cam = photo['camera']
            elev = case['truth'].get('axis_elevation_deg', {}).get(i)
            facts = [
                f"{photo['instrument']} · {cam['width_px']}×{cam['height_px']} · hfov {cam['hfov_deg']:.0f}°"
                + (f' · axis {elev:+.0f}°' if elev is not None else ''),
                f"skyline step: sky_visible <b>{t['sky_visible']}</b> · {t['trusted']}/{t['n']} trusted · {t['zero']} at weight 0",
                'cut: ' + (', '.join(f'{k} {v}' for k, v in sorted(t['reasons'].items())) or 'nothing'),
                f"manifest review: usable <b>{r.get('usable')}</b> · skyline_visible {r.get('skyline_visible')}"
                + (f" · {html.escape(r.get('notes') or '')}" if r.get('notes') else ''),
                '<b class=sent>sent to the engine</b>' if i in sent else '<b class=out>left out</b>',
            ]
            rows.append(f"<figure>{img}<figcaption><code>{i}</code><br>{'<br>'.join(facts)}</figcaption></figure>")
        rows.append('</div>')
    page = f"""<!doctype html><meta charset=utf-8><title>Test photo review</title>
<style>body{{font:14px system-ui;margin:16px;background:#111;color:#ddd}}h2{{margin:28px 0 8px}}small{{color:#999;font-weight:normal}}
.grid{{display:grid;grid-template-columns:repeat(auto-fill,minmax(420px,1fr));gap:12px}}figure{{margin:0;background:#1c1c1c;padding:8px}}
img{{width:100%}}code{{font-size:11px;color:#aaa}}.none{{padding:40px;color:#f88}}.sent{{color:#6d6}}.out{{color:#f80}}
.key span{{display:inline-block;width:28px;height:4px;vertical-align:middle;margin:0 4px 0 12px}}</style>
<h1>Test photo review</h1>
<p>From <code>data/test_photos/manifest.json</code>, traced by the current skyline step at {index['generated_utc']}.
Line colour: <span class=key><span style="background:#50e678"></span>trusted<span style="background:#ffb000"></span>doubtful
<span style="background:#ff5ce1"></span>weight 0 (not used)</span>. Set each photo's <code>review</code> in the manifest:
<code>skyline_visible</code> (a real skyline is in the photo), <code>usable</code> (fit for validation), <code>notes</code>.</p>
{''.join(rows)}"""
    path = REVIEW / 'index.html'
    path.write_text(page, encoding='utf-8')
    return path


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.split('\n')[0])
    ap.add_argument('--review', action='store_true', help='also write the review sheet to backend/cache/test_review/')
    args = ap.parse_args()

    cases = json.loads(MANIFEST.read_text(encoding='utf-8'))['cases']
    traced = {}
    for case in cases:
        for photo in case['photos']:
            traced[photo['image_id']] = t = trace_photo(photo)
            print(f"  {photo['image_id'][:40]}  sky {str(t['sky_visible']):5}  {t['trusted']:4d}/{t['n']:<4d} trusted", flush=True)

    REQUESTS.mkdir(parents=True, exist_ok=True)
    for old in REQUESTS.glob('*.json'):
        old.unlink()  # a case removed from the manifest must not leave a stale request behind
    index = {
        'generated_utc': datetime.now(timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ'),
        'manifest': 'data/test_photos/manifest.json', 'manifest_sha256': manifest_sha256(),
        'note': 'Skyline requests generated from the manifest by the current skyline step. No truth in here.',
        'cases': {},
    }
    for case in cases:
        body, entry = build_case(case, traced)
        index['cases'][case['name']] = entry
        if body['photos']:
            (REQUESTS / entry['request']).write_text(json.dumps(body, separators=(',', ':')), encoding='utf-8')
        else:
            entry['request'] = None
        print(f"{case['name']:20} {len(body['photos'])} photo(s) sent, {len(entry['skipped'])} left out, "
              f"trusted {entry['trusted_share']:.0%}")
    (REQUESTS / 'index.json').write_text(json.dumps(index, indent=1), encoding='utf-8')
    print(f'requests written to {REQUESTS}')
    if args.review:
        print(f'review sheet: {review_sheet(cases, traced, index)}')
    return 0


if __name__ == '__main__':
    sys.exit(main())
