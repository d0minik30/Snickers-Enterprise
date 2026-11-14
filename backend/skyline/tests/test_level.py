import numpy as np
import pytest

from fixtures import navcam_record
from skyline.camera import Pinhole
from skyline.level import gravity_from_pitch_roll, gravity_from_rover_attitude, level_from_gravity
from skyline.metadata import camera_setup
from skyline.pipeline import convert


def quat_mul(a, b):
    w1, x1, y1, z1 = a
    w2, x2, y2, z2 = b
    return (w1 * w2 - x1 * x2 - y1 * y2 - z1 * z2, w1 * x2 + x1 * w2 + y1 * z2 - z1 * y2,
            w1 * y2 - x1 * z2 + y1 * w2 + z1 * x2, w1 * z2 + x1 * y2 - y1 * x2 + z1 * w2)


def yaw_quat(deg):
    h = np.radians(deg) / 2
    return (np.cos(h), 0.0, 0.0, np.sin(h))


def test_level_camera_looks_at_the_horizon():
    cam = Pinhole.from_fov(1000, 800, 60)
    lv = level_from_gravity(gravity_from_pitch_roll(0, 0), cam.forward, 'manual')
    az, el = lv.angles(cam.pixel_to_ray(np.array([499.5, 999.0]), np.array([399.5, 399.5])))
    assert az[0] == pytest.approx(0, abs=1e-9) and el[0] == pytest.approx(0, abs=1e-9)
    assert az[1] == pytest.approx(30, abs=0.1) and el[1] == pytest.approx(0, abs=1e-9)  # right is positive


def test_pitch_and_roll_conventions():
    cam = Pinhole.from_fov(1000, 800, 60)
    centre = cam.pixel_to_ray(np.array([499.5]), np.array([399.5]))
    up = level_from_gravity(gravity_from_pitch_roll(10, 0), cam.forward, 'manual')
    assert up.angles(centre)[1][0] == pytest.approx(10, abs=1e-9)
    # Right side dips: a point on the image's right edge, at the centre row, lies below the horizon.
    rolled = level_from_gravity(gravity_from_pitch_roll(0, 5), cam.forward, 'manual')
    right = cam.pixel_to_ray(np.array([999.0]), np.array([399.5]))
    assert rolled.angles(right)[1][0] < -2


def test_angles_and_rays_are_inverse():
    cam = Pinhole.from_fov(1000, 800, 60)
    lv = level_from_gravity(gravity_from_pitch_roll(7, -3), cam.forward, 'sensor')
    az, el = np.array([-20.0, 0.0, 12.5]), np.array([1.0, -4.0, 9.0])
    assert np.allclose(lv.angles(lv.rays(az, el)), (az, el))


def test_gravity_ignores_the_rover_heading():
    q = (0.81291, -0.010954, 0.0117397, 0.582168)
    g = gravity_from_rover_attitude(q)
    for yaw in (17, 90, 200, -123):
        assert np.allclose(gravity_from_rover_attitude(quat_mul(yaw_quat(yaw), q)), g, atol=1e-12)


def test_skyline_never_depends_on_the_labels_answer():
    """Change the rover heading and position in a label: the skyline must not change at all."""
    trace = {'x': list(np.linspace(0, 1279, 200)), 'y': list(380 + 20 * np.sin(np.linspace(0, 6, 200))),
             'weight': [1.0] * 200}

    def skyline_for(record):
        setup = camera_setup(1280, 960, {}, None, record)
        photo, diagnostics = convert(setup, trace['x'], trace['y'], trace['weight'])
        return {**photo, 'diagnostics': diagnostics}

    base_rec = navcam_record()
    base = skyline_for(base_rec)
    q = tuple(float(x) for x in base_rec['attitude'].strip('()').split(','))
    for yaw in (33, 180, -77):
        other = skyline_for(navcam_record(attitude=quat_mul(yaw_quat(yaw), q), xyz='(-1234.5,987.6,3.2)'))
        # Identical up to floating-point noise (gravity agrees to 1e-12; outputs are rounded to 1e-4).
        assert {k: v for k, v in other.items() if k != 'samples'} == {k: v for k, v in base.items() if k != 'samples'}
        assert len(other['samples']) == len(base['samples'])
        for a, b in zip(other['samples'], base['samples']):
            assert a['az_offset_deg'] == pytest.approx(b['az_offset_deg'], abs=2e-4)
            assert a['elev_deg'] == pytest.approx(b['elev_deg'], abs=2e-4)
            assert a['weight'] == b['weight']


def test_rover_axis_azimuth_gives_relative_heading_without_the_answer():
    """Two cameras on one rover: their axis azimuths in the rover frame differ by their true heading
    difference, whatever the rover's own heading is, and they don't change with that heading."""
    base_rec = navcam_record()
    q = tuple(float(x) for x in base_rec['attitude'].strip('()').split(','))
    a = camera_setup(1280, 960, {}, None, base_rec)
    assert a.rover_pose is None  # the fixture has no site/drive
    turned = camera_setup(1280, 960, {}, None, navcam_record(attitude=quat_mul(yaw_quat(57), q)))
    assert turned.rover_axis_azimuth_deg == pytest.approx(a.rover_axis_azimuth_deg, abs=1e-9)
    # This Navcam frame looks about 100 degrees to the right of the rover's forward direction (mastAz 99.8).
    assert a.rover_axis_azimuth_deg == pytest.approx(99.8, abs=2)
