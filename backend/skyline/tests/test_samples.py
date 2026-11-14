"""Real Perseverance Navcam photos (scripts/fetch_samples.py). Skipped when they are not downloaded.

Checks that hold for these photos whatever small tuning changes: the rim on sol 47-48 sits a few
degrees above the horizontal; the robotic arm, which crosses the horizon in the sol 17-18 shots, is
never trusted; the line runs where the photo changes from sky to ground (checked at a few columns
read off the photos by eye).
"""

import json
from pathlib import Path

import numpy as np
import pytest

from skyline.metadata import camera_setup, load_image
from skyline.pipeline import process

SAMPLES = Path(__file__).resolve().parents[1] / 'samples'


def run(image_id):
    png, meta = SAMPLES / f'{image_id}.png', SAMPLES / f'{image_id}.json'
    if not png.exists() or not meta.exists():
        pytest.skip('sample photos not downloaded (py -3.10 backend/skyline/scripts/fetch_samples.py)')
    img, exif = load_image(png.read_bytes())
    setup = camera_setup(img.shape[1], img.shape[0], {}, exif, json.loads(meta.read_text()))
    return process(img, setup)


@pytest.mark.parametrize('image_id', [
    'NLF_0047_0671121153_414ECM_N0031708NCAM00405_01_295J',
    'NLF_0048_0671201674_630ECM_N0031708NCAM00296_01_295J',
])
def test_clean_rim_horizon(image_id):
    out = run(image_id)
    s = out.skyline['samples']
    trusted = [x for x in s if x['weight'] >= 0.5]
    assert len(trusted) > 0.5 * len(s)
    el = np.array([x['elev_deg'] for x in trusted])
    assert 1.5 < np.median(el) < 7  # the western rim and delta, kilometres away
    assert np.ptp(el) < 6


@pytest.mark.parametrize('image_id,arm_columns', [
    ('NLF_0017_0668451937_008ECM_N0030578NCAM00195_01_290J', (600, 980)),
    ('NLF_0017_0668453452_115ECM_N0030578NCAM00186_01_290J', (560, 940)),
    ('NLF_0018_0668545642_177ECM_N0030578NCAM00190_01_290J', (380, 820)),
])
def test_robotic_arm_is_not_trusted(image_id, arm_columns):
    out = run(image_id)
    a, b = arm_columns
    w = np.array(out.trace['weight'][a:b])
    assert np.mean(w == 0) > 0.9
    assert {'near'} <= set(r for r in out.trace['reason'][a:b] if r)


def test_line_follows_the_horizon_where_read_by_eye():
    # Sol 48: horizon rows read by eye off 4x enlarged crops of the photo (reading good to about +-2 rows).
    out = run('NLF_0048_0671201674_630ECM_N0031708NCAM00296_01_295J')
    y = np.array(out.trace['y'])
    for col, row in EYE_READ_SOL48.items():
        assert abs(y[col] - row) <= 4, (col, y[col], row)


# Columns across the photo: a flat stretch, the slope under the bright glow, and a softer slope.
EYE_READ_SOL48: dict[int, float] = {250: 373.5, 640: 379.5, 1050: 392.5}
