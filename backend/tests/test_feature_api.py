"""The dominant feature, the request checks and the HTTP server."""
import math
from types import SimpleNamespace

import numpy as np
import pytest
from fastapi.testclient import TestClient

from conftest import grid_around, one_source
from marsloc import api, geo
from marsloc.constants import LANDING_SITE_LAT, LANDING_SITE_LON
from marsloc.feature import distance_from_angle, dominant_feature, prominence
from marsloc.horizon import RenderConfig, render_horizon

LAT0, LON0 = LANDING_SITE_LAT, LANDING_SITE_LON


# ---------------------------------------------------------------- dominant feature

def test_prominence_of_peaks():
    rise = prominence([0.0, 1.0, 0.0, 3.0, 0.5, 2.0, 0.0])
    assert rise[3] == 3.0            # the highest: above the lowest point on its lower side
    assert rise[1] == 1.0            # separated from the 3 by a 0
    assert rise[5] == 1.5            # separated from the 3 by 0.5
    assert rise[0] == 0.0 and rise[2] == 0.0
    split = prominence([1.0, 2.0, np.nan, 5.0, 4.0])
    assert math.isnan(split[2]) and split[1] == 1.0 and split[3] == 1.0


def test_distance_from_angle_inverts_the_elevation_formula():
    cam, top = -2565.5, -1978.0
    for d in (3000.0, 9530.0, 25000.0):
        elev = float(geo.elevation_angle_deg(cam, top, d))
        assert distance_from_angle(cam, top, elev) == pytest.approx(d, rel=0.005)
    assert math.isnan(distance_from_angle(0.0, -100.0, 5.0))       # lower ground can't stand 5 deg high


def cone_view(apex_m=300.0, d_row=-130, d_col=220, heading=40.0):
    """A cone on flat ground and the horizon a camera at (LAT0, LON0) sees, as a stand-in for
    a matched photo. Returns (terrain, fit, apex_lat, apex_lon)."""
    bounds, lat2d, lon2d = grid_around(LAT0, LON0, 300, 300, 20.0)
    apex_lat, apex_lon = float(lat2d[300 + d_row, 300 + d_col]), float(lon2d[300 + d_row, 300 + d_col])
    data = -2567.0 + np.maximum(0.0, apex_m * (1.0 - geo.distance_m(apex_lat, apex_lon, lat2d, lon2d) / 1000.0))
    terrain = one_source(bounds, data)
    offsets = np.arange(-30.0, 30.01, 0.25)
    horizon = render_horizon(terrain, LAT0, LON0, 1.7, RenderConfig(max_range_m=5500.0),
                             azimuths_deg=(heading + offsets) % 360.0)
    fit = SimpleNamespace(id="photo_1", heading_deg=heading, az_offset_deg=offsets,
                          model_elev_deg=horizon.elev_deg, distance_m=np.nan_to_num(horizon.dist_m, nan=1e9))
    return terrain, fit, apex_lat, apex_lon


def test_the_dominant_feature_is_the_cone_and_both_distances_agree():
    terrain, fit, apex_lat, apex_lon = cone_view()
    places = [("Test Butte", apex_lat + 0.001, apex_lon), ("Far Away", apex_lat + 1.0, apex_lon)]
    feature = dominant_feature(terrain, LAT0, LON0, 1.7, [fit], places)
    true_dist = float(geo.distance_m(LAT0, LON0, apex_lat, apex_lon))
    true_bearing = float(geo.bearing_deg(LAT0, LON0, apex_lat, apex_lon))
    assert float(geo.distance_m(apex_lat, apex_lon, feature["lat"], feature["lon"])) < 40.0
    assert feature["distance_m"] == pytest.approx(true_dist, abs=40.0)
    assert feature["distance_check_m"] == pytest.approx(feature["distance_m"], rel=0.03)
    assert feature["elevation_m"] == pytest.approx(-2267.0, abs=8.0)
    assert feature["azimuth_deg"] == pytest.approx(true_bearing, abs=0.3)
    assert feature["az_offset_deg"] == pytest.approx(true_bearing - 40.0, abs=0.3)
    assert feature["elev_angle_deg"] == pytest.approx(3.4, abs=0.1) and feature["prominence_deg"] > 3.0
    assert feature["photo_id"] == "photo_1" and feature["name"] == "Test Butte"
    east, north = geo.latlon_to_local(feature["lat"], feature["lon"])
    assert feature["east_m"] == pytest.approx(float(east)) and feature["north_m"] == pytest.approx(float(north))
    assert dominant_feature(terrain, LAT0, LON0, 1.7, [fit])["name"] is None


def test_no_dominant_feature_on_a_flat_or_only_near_skyline():
    terrain, fit, _, _ = cone_view(apex_m=0.0)                       # flat ground: nothing stands out
    assert dominant_feature(terrain, LAT0, LON0, 1.7, [fit]) is None
    terrain, fit, _, _ = cone_view(d_row=-20, d_col=30)              # the cone is 700 m away: not distant
    assert dominant_feature(terrain, LAT0, LON0, 1.7, [fit]) is None


# ---------------------------------------------------------------- the request checks and the server

def body(n=60, **changes):
    samples = [{"az_offset_deg": -30 + k, "elev_deg": 1.0 + 0.01 * k, "weight": 1.0} for k in range(n)]
    photo = {"id": "photo_1", "camera": {"hfov_deg": 60, "vfov_deg": 45, "width_px": 4000, "height_px": 3000,
                                         "lens_model": "rectilinear"}, "samples": samples}
    out = {"contract_version": "0.1", "photos": [photo]}
    out.update(changes)
    return out


@pytest.fixture(scope="module")
def client():
    with TestClient(api.app) as c:
        yield c


def test_health_reports_what_is_loaded(client):
    reply = client.get("/health").json()
    assert reply["contract_version"] == "0.3" and reply["status"] in ("ok", "not_ready")
    assert reply["terrain_loaded"] == reply["skylines_loaded"] == (reply["status"] == "ok")
    assert (reply["detail"] is None) == (reply["status"] == "ok")


def test_cors_allows_the_app(client):
    reply = client.get("/health", headers={"Origin": "http://localhost:3000"})
    assert reply.headers["access-control-allow-origin"] == "http://localhost:3000"
    assert "access-control-allow-origin" not in client.get("/health", headers={"Origin": "http://evil.example"}).headers


def where(reply):
    return [".".join(str(part) for part in item["loc"]) for item in reply.json()["detail"]]


@pytest.mark.parametrize("bad, field", [
    (body(contract_version="9.9"), "body.contract_version"),
    (body(n=5), "body.photos.0.samples"),
    ({"contract_version": "0.2"}, "body.photos"),
    (body(photos=[]), "body.photos"),
])
def test_a_request_that_breaks_the_contract_gets_422_naming_the_field(client, bad, field):
    reply = client.post("/locate", json=bad)
    assert reply.status_code == 422 and field in where(reply)


def test_422_for_bad_values_inside_a_photo(client):
    for change, field in (({"camera": {"hfov_deg": 60, "vfov_deg": 45, "width_px": 4000, "height_px": 3000,
                                       "lens_model": "pinhole"}}, "body.photos.0.camera.lens_model"),
                          ({"relative_heading_deg": 20.0}, "body.photos"),
                          ({"time_utc": "yesterday"}, "body.photos.0.time_utc"),
                          ({"horizon_uncertainty_deg": -1}, "body.photos.0.horizon_uncertainty_deg")):
        bad = body()
        bad["photos"][0].update(change)
        reply = client.post("/locate", json=bad)
        assert reply.status_code == 422 and field in where(reply), change


def test_every_contract_version_and_lens_model_is_accepted():
    from marsloc.contracts import LocateRequest
    for version in ("0.1", "0.2", "0.3"):
        request = LocateRequest.model_validate(body(contract_version=version))
        assert request.options.top_k == 5 and request.photos[0].eye_height_m == 1.7
    ok = body()
    ok["photos"][0]["camera"]["lens_model"] = "cahvore"
    ok["photos"][0].update(roll_uncertainty_deg=1.0, an_unknown_field=1)
    assert LocateRequest.model_validate(ok).photos[0].roll_uncertainty_deg == 1.0


def test_503_while_the_engine_is_not_ready(client, monkeypatch):
    monkeypatch.setattr(api, "_state", {"engine": None, "error": "no terrain"})
    reply = client.post("/locate", json=body())
    assert reply.status_code == 503 and "no terrain" in reply.json()["detail"]
    assert client.get("/health").json()["status"] == "not_ready"


def test_the_skyline_routes_are_on_the_same_server_when_their_packages_are_installed():
    paths = set(api.app.openapi()["paths"])
    assert {"/locate", "/health"} <= paths
    assert ({"/skyline", "/skyline/convert"} <= paths) == api.SKYLINE_ROUTES


@pytest.mark.realdem
def test_locate_answers_in_the_contract_format(client, real_terrain):
    if client.get("/health").json()["status"] != "ok":
        pytest.skip("the engine is not ready (terrain or precomputed horizons missing)")
    from marsloc.simulate import simulate_photo
    lat, lon, heading = 18.4531, 77.4317, 265.0
    photo = simulate_photo(real_terrain, lat, lon, heading, noise_sigma_deg=0.03, rng=np.random.default_rng(0))
    request = {"contract_version": "0.1", "photos": [{
        "id": "photo_1", "camera": {"hfov_deg": 60, "vfov_deg": 45, "width_px": 4000, "height_px": 3000,
                                    "lens_model": "rectilinear"},
        "samples": [{"az_offset_deg": float(a), "elev_deg": float(e), "weight": float(w)}
                    for a, e, w in zip(photo.az_offset_deg, photo.elev_deg, photo.weight)]}]}
    reply = client.post("/locate", json=request)
    assert reply.status_code == 200
    result = reply.json()
    assert result["contract_version"] == "0.1" and result["status"] in ("ok", "ambiguous", "no_match")
    best = result["best"]
    assert set(best) == {"lat", "lon", "east_m", "north_m", "ground_elevation_m", "heading_deg", "score",
                         "probability", "uncertainty_m", "uncertainty_95_m"}
    assert float(geo.distance_m(lat, lon, best["lat"], best["lon"])) < 200.0
    assert abs(float(geo.angle_diff(best["heading_deg"], heading))) < 0.5
    assert result["candidates"][0]["rank"] == 1 and result["candidates"][0]["lat"] == best["lat"]
    grid = result["likelihood_grid"]
    assert len(grid["values"]) == grid["rows"] and len(grid["values"][0]) == grid["cols"]
    assert max(max(row) for row in grid["values"]) == grid["scale"] == 255
    (shot,) = result["photos"]
    assert shot["id"] == "photo_1" and shot["horizon_tilt_deg"] == 0.0 and len(shot["residuals"]) > 100
    assert set(shot["residuals"][0]) == {"az_offset_deg", "observed_elev_deg", "model_elev_deg", "residual_deg",
                                         "distance_m", "used"}
    feature = result["dominant_feature"]
    assert feature["distance_m"] > 1000 and feature["photo_id"] == "photo_1"
    assert feature["distance_check_m"] == pytest.approx(feature["distance_m"], rel=0.1)
    assert result["engine"]["candidate_spacing_m"] == 200 and "total" in result["engine"]["timing_ms"]

    lean = dict(request, options={"include_likelihood_grid": False, "include_residuals": False, "top_k": 2})
    result = client.post("/locate", json=lean).json()
    assert result["likelihood_grid"] is None and "residuals" not in result["photos"][0]
    assert len(result["candidates"]) <= 2
