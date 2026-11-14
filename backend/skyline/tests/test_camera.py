import numpy as np
import pytest

from fixtures import NAVCAM_MODEL
from skyline.camera import Cahvore, Pinhole
from skyline.metadata import scaled_cahvore


def grid(w, h, n=9):
    u, v = np.meshgrid(np.linspace(0, w - 1, n), np.linspace(0, h - 1, n))
    return u.ravel(), v.ravel()


def test_pinhole_round_trip_with_distortion():
    cam = Pinhole.from_fov(1200, 900, 70, k=(-0.12, 0.03, 0.0), p=(0.001, -0.0005))
    u, v = grid(1200, 900)
    uu, vv = cam.ray_to_pixel(cam.pixel_to_ray(u, v))
    assert np.max(np.hypot(uu - u, vv - v)) < 1e-6


def test_pinhole_field_of_view():
    cam = Pinhole.from_fov(1000, 750, 60)
    lr = cam.pixel_to_ray(np.array([-0.5, 999.5]), np.array([374.5, 374.5]))  # outer pixel edges
    assert np.degrees(np.arccos(lr[0] @ lr[1])) == pytest.approx(60, abs=1e-6)


def test_navcam_model_round_trip_and_published_field_of_view():
    cam = Cahvore.from_components(NAVCAM_MODEL, 1280, 960)
    assert cam.linearity == 0.0  # mtype 2: fish-eye base with radial terms
    u, v = grid(1280, 960)
    uu, vv = cam.ray_to_pixel(cam.pixel_to_ray(u, v))
    assert np.max(np.hypot(uu - u, vv - v)) < 1e-6
    lr = cam.pixel_to_ray(np.array([0.0, 1279.0]), np.array([479.5, 479.5]))
    tb = cam.pixel_to_ray(np.array([639.5, 639.5]), np.array([0.0, 959.0]))
    # Mars 2020 Navcam is published as 96 x 73 degrees.
    assert np.degrees(np.arccos(lr[0] @ lr[1])) == pytest.approx(96, abs=1)
    assert np.degrees(np.arccos(tb[0] @ tb[1])) == pytest.approx(73, abs=1)


def test_cahvor_without_distortion_equals_pinhole():
    pin = Pinhole.from_fov(800, 600, 50)
    A = np.array([0.0, 0.0, 1.0])
    H = pin.fx * np.array([1.0, 0, 0]) + pin.cx * A
    V = pin.fy * np.array([0, 1.0, 0]) + pin.cy * A
    cahv = Cahvore(800, 600, A, H, V, A, (0.0, 0.0, 0.0), 1.0)
    u, v = grid(800, 600)
    assert np.allclose(cahv.pixel_to_ray(u, v), pin.pixel_to_ray(u, v), atol=1e-12)


def test_scaled_model_sees_the_same_directions():
    cam = Cahvore.from_components(NAVCAM_MODEL, 1280, 960)
    half = scaled_cahvore(cam, 640, 480)
    u, v = grid(1280, 960)
    # pixel centre (u, v) at full size is ((u + 0.5) / 2 - 0.5, ...) at half size
    assert np.allclose(cam.pixel_to_ray(u, v), half.pixel_to_ray((u + 0.5) / 2 - 0.5, (v + 0.5) / 2 - 0.5), atol=1e-9)
