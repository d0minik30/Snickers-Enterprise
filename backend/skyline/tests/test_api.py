import base64
import io
import json

import numpy as np
import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from PIL import Image

from fixtures import navcam_record
from skyline import api
from skyline.camera import Pinhole
from skyline.level import gravity_from_pitch_roll, level_from_gravity
from skyline.metadata import camera_setup
from synth import render

app = FastAPI()
app.include_router(api.router)
client = TestClient(app)


def png_bytes(img: np.ndarray) -> bytes:
    buf = io.BytesIO()
    Image.fromarray(img).save(buf, format='PNG')
    return buf.getvalue()


@pytest.fixture(scope='module')
def phone_photo() -> bytes:
    cam = Pinhole.from_fov(640, 480, 60)
    return png_bytes(render(cam, level_from_gravity(gravity_from_pitch_roll(3, 0), cam.forward, 'sensor')))


def test_post_skyline_returns_skyline_trace_and_debug_image(phone_photo):
    camera = {'hfov_deg': 60, 'pitch_deg': 3, 'roll_deg': 0, 'level_source': 'sensor', 'time_utc': '2026-11-15T10:00:00Z'}
    r = client.post('/skyline', files={'photo': ('p.png', phone_photo, 'image/png')}, data={'camera': json.dumps(camera)})
    assert r.status_code == 200, r.text
    body = r.json()
    sk = body['skyline']
    assert sk['level_source'] == 'sensor' and sk['time_utc'] == '2026-11-15T10:00:00Z'
    assert sk['eye_height_m'] == 1.7 and sk['camera']['source'] == 'manual'
    assert len(sk['samples']) > 400 and set(sk['samples'][0]) == {'az_offset_deg', 'elev_deg', 'weight'}
    assert len(body['trace']['x']) == 640 and body['trace']['width'] == 640
    head, data = body['debug_image'].split(',', 1)
    assert head == 'data:image/jpeg;base64' and Image.open(io.BytesIO(base64.b64decode(data))).size == (640, 480)


def test_post_skyline_with_a_perseverance_label():
    setup = camera_setup(1280, 960, {}, None, navcam_record())
    photo = png_bytes(render(setup.camera, setup.level))
    label = json.dumps({'image': [navcam_record()]}).encode()  # the feed's by-id reply, as saved
    r = client.post('/skyline', files={'photo': ('p.png', photo, 'image/png'), 'label': ('l.json', label, 'application/json')})
    assert r.status_code == 200, r.text
    sk = r.json()['skyline']
    assert sk['camera']['model'] == 'cahvore' and sk['level_source'] == 'label'
    assert sk['time_utc'] == '2021-04-08T02:34:41.015Z'
    assert 'heading' not in json.dumps(sk) and 'xyz' not in json.dumps(sk)


def test_convert_an_edited_trace(phone_photo):
    r = client.post('/skyline', files={'photo': ('p.png', phone_photo, 'image/png')}, data={'camera': '{"hfov_deg": 60}'})
    trace = r.json()['trace']
    weight = list(trace['weight'])
    weight[200:300] = [0.0] * 100  # the user erases a stretch
    body = {'camera': {'hfov_deg': 60}, 'width': 640, 'height': 480,
            'trace': {'x': trace['x'], 'y': trace['y'], 'weight': weight}}
    r2 = client.post('/skyline/convert', json=body)
    assert r2.status_code == 200, r2.text
    s = r2.json()['skyline']['samples']
    x0, x1 = trace['x'][205], trace['x'][295]
    cam = Pinhole.from_fov(640, 480, 60)
    az0 = np.degrees(np.arctan((x0 - cam.cx) / cam.fx))
    az1 = np.degrees(np.arctan((x1 - cam.cx) / cam.fx))
    assert all(x['weight'] == 0 for x in s if az0 <= x['az_offset_deg'] <= az1)


@pytest.mark.parametrize('camera,code', [
    ('not json', 'bad_input'),
    ('{"preset": "no-such-phone"}', 'bad_input'),
    ('{}', 'bad_input'),  # no field of view and no EXIF
    ('{"hfov_deg": 60, "level_source": "guess", "pitch_deg": 1}', 'bad_input'),
])
def test_bad_camera_info_is_a_clear_400(phone_photo, camera, code):
    r = client.post('/skyline', files={'photo': ('p.png', phone_photo, 'image/png')}, data={'camera': camera})
    assert r.status_code == 400
    assert r.json()['detail']['code'] == code and r.json()['detail']['message']


def test_unreadable_photo_and_bad_label():
    r = client.post('/skyline', files={'photo': ('p.png', b'not an image', 'image/png')}, data={'camera': '{"hfov_deg": 60}'})
    assert r.status_code == 400 and 'photo' in r.json()['detail']['message']
    r = client.post('/skyline', files={'photo': ('p.png', b'x', 'image/png'), 'label': ('l.json', b'{oops', 'application/json')})
    assert r.status_code == 400 and r.json()['detail']['code'] == 'bad_label'


def test_photo_size_limit(monkeypatch, phone_photo):
    monkeypatch.setattr(api, 'MAX_PHOTO_BYTES', 1000)
    r = client.post('/skyline', files={'photo': ('p.png', phone_photo, 'image/png')}, data={'camera': '{"hfov_deg": 60}'})
    assert r.status_code == 413 and r.json()['detail']['code'] == 'too_large'


def test_preset_and_exif_cameras():
    s = camera_setup(4032, 3024, {'preset': 'iphone-main'})
    assert s.camera.width == 4032 and s.camera_source == 'preset'
    hfov = np.degrees(2 * np.arctan(2016 / s.camera.fx))
    assert hfov == pytest.approx(67.30, abs=0.01)  # 26 mm equivalent on 4:3: 2 atan(34.62 / 52)
    e = camera_setup(4032, 3024, {}, {'focal_35mm': 26})
    assert e.camera_source == 'exif' and e.camera.fx == pytest.approx(s.camera.fx)
