"""The whole chain on synthetic photos of known geometry: the angles must come back."""

import numpy as np
import pytest

from fixtures import navcam_record
from skyline.camera import Pinhole
from skyline.level import gravity_from_pitch_roll, level_from_gravity
from skyline.metadata import camera_setup
from skyline.pipeline import process
from synth import render, skyline_wave


def errors(photo, truth=skyline_wave, min_weight=0.5):
    s = [x for x in photo['samples'] if x['weight'] >= min_weight]
    az = np.array([x['az_offset_deg'] for x in s])
    el = np.array([x['elev_deg'] for x in s])
    return np.abs(el - truth(az)), az


@pytest.mark.parametrize('pitch,roll', [(0, 0), (6, 0), (-4, 3), (2, -5)])
def test_pinhole_with_distortion_pitch_and_roll(pitch, roll):
    cam = Pinhole.from_fov(960, 720, 60, k=(-0.08, 0.01, 0.0))
    level = level_from_gravity(gravity_from_pitch_roll(pitch, roll), cam.forward, 'sensor')
    img = render(cam, level)
    setup = camera_setup(960, 720, {'hfov_deg': 60, 'k': [-0.08, 0.01, 0.0], 'pitch_deg': pitch,
                                    'roll_deg': roll, 'level_source': 'sensor'})
    out = process(img, setup)
    err, az = errors(out.photo)
    assert len(err) > 0.7 * len(out.photo['samples'])  # most of the line is trusted
    assert np.median(err) < 0.03 and np.percentile(err, 95) < 0.08  # degrees (1 px = 0.06 deg)
    assert out.diagnostics['pitch_deg'] == pytest.approx(pitch, abs=1e-6)
    assert out.diagnostics['roll_deg'] == pytest.approx(roll, abs=1e-6)
    assert out.photo['horizon_uncertainty_deg'] == 1.0  # sensor


def test_perseverance_navcam_model_and_label_levelling():
    record = navcam_record()
    setup = camera_setup(1280, 960, {}, None, record)
    img = render(setup.camera, setup.level)
    out = process(img, setup)
    err, az = errors(out.photo)
    assert np.median(err) < 0.04 and np.percentile(err, 95) < 0.12  # 1 px = 0.075 deg at the centre
    assert az.min() < -35 and az.max() > 35  # most of the 96 degree field is usable
    assert out.diagnostics['camera_source'] == 'label' and out.diagnostics['level_source'] == 'label'
    assert out.photo['eye_height_m'] == pytest.approx(1.97, abs=0.02)
    assert out.photo['camera']['lens_model'] == 'other' and out.photo['horizon_uncertainty_deg'] == 0.3


def test_near_rock_is_not_trusted():
    cam = Pinhole.from_fov(960, 720, 60)
    level = level_from_gravity(gravity_from_pitch_roll(0, 0), cam.forward, 'manual')
    img = render(cam, level, rock=(-5.0, 3.0, 9.0))  # a 8 degree wide rock rising to 9 degrees
    setup = camera_setup(960, 720, {'hfov_deg': 60, 'pitch_deg': 0, 'roll_deg': 0})
    s = process(img, setup).photo['samples']
    over_rock = [x['weight'] for x in s if -4.5 <= x['az_offset_deg'] <= 2.5]
    clear = [x['weight'] for x in s if abs(x['az_offset_deg']) > 9 and abs(x['az_offset_deg']) < 25]
    assert max(over_rock) == 0
    assert np.mean(clear) > 0.8


def test_haze_lowers_trust():
    cam = Pinhole.from_fov(960, 720, 60)
    level = level_from_gravity(gravity_from_pitch_roll(0, 0), cam.forward, 'manual')
    img = render(cam, level, haze=(5.0, 20.0))
    setup = camera_setup(960, 720, {'hfov_deg': 60, 'pitch_deg': 0, 'roll_deg': 0})
    s = process(img, setup).photo['samples']
    hazy = np.mean([x['weight'] for x in s if 7 <= x['az_offset_deg'] <= 18])
    clear = np.mean([x['weight'] for x in s if -20 <= x['az_offset_deg'] <= -5])
    assert hazy < 0.5 * clear


def test_sun_in_the_sky_is_found():
    cam = Pinhole.from_fov(960, 720, 60)
    level = level_from_gravity(gravity_from_pitch_roll(5, 0), cam.forward, 'sensor')
    img = render(cam, level)
    sun_u, sun_v = cam.ray_to_pixel(level.rays(np.array([12.0]), np.array([18.0])))
    yy, xx = np.mgrid[0:720, 0:960]
    img[(xx - sun_u[0]) ** 2 + (yy - sun_v[0]) ** 2 <= 6 ** 2] = 255
    setup = camera_setup(960, 720, {'hfov_deg': 60, 'pitch_deg': 5, 'roll_deg': 0, 'level_source': 'sensor'})
    sun = process(img, setup).photo['sun']
    assert sun['az_offset_deg'] == pytest.approx(12, abs=0.1) and sun['elev_deg'] == pytest.approx(18, abs=0.1)


def test_no_sun_when_none_is_visible():
    cam = Pinhole.from_fov(960, 720, 60)
    level = level_from_gravity(gravity_from_pitch_roll(0, 0), cam.forward, 'manual')
    assert 'sun' not in process(render(cam, level), camera_setup(960, 720, {'hfov_deg': 60})).photo


def test_image_borders_are_not_trusted():
    cam = Pinhole.from_fov(960, 720, 60)
    level = level_from_gravity(gravity_from_pitch_roll(0, 0), cam.forward, 'manual')
    out = process(render(cam, level), camera_setup(960, 720, {'hfov_deg': 60}))
    w = out.trace['weight']
    assert w[0] == 0 and w[-1] == 0
    assert out.diagnostics['level_source'] == 'assumed'  # no tilt given: said so, not hidden
    assert out.photo['horizon_uncertainty_deg'] == 5.0


def test_a_photo_with_no_sky_in_it_is_not_trusted_at_all():
    """A camera pointed well down (or a tile cut from the bottom of the sensor) can't show the skyline."""
    cam = Pinhole.from_fov(960, 720, 60)
    level = level_from_gravity(gravity_from_pitch_roll(-40, 0), cam.forward, 'sensor')
    out = process(render(cam, level), camera_setup(960, 720, {'hfov_deg': 60, 'pitch_deg': -40, 'roll_deg': 0,
                                                             'level_source': 'sensor'}))
    assert out.diagnostics['sky_visible'] is False
    assert all(s['weight'] == 0 for s in out.photo['samples'])
    level_cam = process(render(cam, level_from_gravity(gravity_from_pitch_roll(0, 0), cam.forward, 'm')),
                        camera_setup(960, 720, {'hfov_deg': 60}))
    assert level_cam.diagnostics['sky_visible'] is True
