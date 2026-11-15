"""The matcher end to end, on the real terrain with simulated photos.

Needs the delivered terrain and the precomputed horizons; skipped without them. The numbers
asserted here are loose bounds around what scripts/validate_sim.py measures.
"""
import numpy as np
import pytest

from marsloc import geo
from marsloc.horizon.store import HorizonStore, default_store_dir
from marsloc.match import Matcher, MatcherConfig
from marsloc.match.fine import FineSearch
from marsloc.match.resample import make_groups
from marsloc.simulate import simulate_photo

# A spot on the crater floor west of the landing site, not on the candidate grid, looking at
# the delta and the western rim.
LAT, LON, HEADING = 18.4531, 77.4317, 265.0

pytestmark = pytest.mark.realdem


@pytest.fixture(scope="module")
def matcher(real_terrain):
    directory = default_store_dir()
    if not (directory / "meta.json").exists():
        pytest.skip("no precomputed horizons; build them with scripts/build_horizons.py")
    store = HorizonStore.load(directory)
    if not store.matches(real_terrain):
        pytest.skip("the precomputed horizons were built from different terrain; rebuild them")
    return Matcher(real_terrain, store)


def photo(matcher, seed=0, **options):
    options.setdefault("noise_sigma_deg", 0.03)
    options.setdefault("angle_sigma_deg", 0.05)
    return simulate_photo(matcher.terrain, LAT, LON, options.pop("heading", HEADING),
                          rng=np.random.default_rng(seed), **options)


def error_m(result):
    return float(geo.distance_m(LAT, LON, result.best.lat, result.best.lon))


def heading_error(result):
    return abs(float(geo.angle_diff(result.best.heading_deg, HEADING)))


def test_a_clean_photo_is_located_with_the_right_heading(matcher):
    result = matcher.locate([photo(matcher)])
    assert error_m(result) < 150.0
    assert heading_error(result) < 0.5              # 265, not its mirror image 95
    assert result.status == "ok"
    assert error_m(result) <= result.uncertainty_95_m
    best = result.best
    assert best.fit_z < 1.2 and best.support > 0.9 and best.score > 0.9 and best.probability >= 0.6
    assert result.candidates[0] is best and best.rank == 1 and best.refined
    assert result.likelihood.shape == (result.grid.rows, result.grid.cols)
    assert result.likelihood.max() == pytest.approx(1.0) and result.likelihood.min() >= 0.0
    east, north = geo.latlon_to_local(best.lat, best.lon)
    assert best.east_m == pytest.approx(float(east)) and best.north_m == pytest.approx(float(north))
    fit = best.photos[0]
    assert fit.id == "photo" and abs(fit.horizon_shift_deg) < 1e-9 and fit.horizon_tilt_deg == 0.0
    assert np.nanmax(np.abs(fit.residual_deg[fit.used])) < 0.5


def test_unflagged_rocks_and_a_gap_do_not_move_the_answer(matcher):
    result = matcher.locate([photo(matcher, seed=3, rocks=2, gaps=1)])
    assert error_m(result) < 200.0 and heading_error(result) < 0.5


def test_what_is_traced_in_a_weight_0_stretch_has_no_effect(matcher):
    a = photo(matcher, seed=4)
    b = photo(matcher, seed=4)
    stretch = (a.az_offset_deg > 5.0) & (a.az_offset_deg < 15.0)
    for p, junk in ((a, 0.0), (b, 37.0)):
        p.weight[stretch] = 0.0
        p.elev_deg[stretch] = junk
    first, second = matcher.locate([a]), matcher.locate([b])
    assert (first.best.lat, first.best.lon, first.best.heading_deg) == \
        (second.best.lat, second.best.lon, second.best.heading_deg)
    assert error_m(first) < 200.0


def test_a_declared_pitch_error_is_fitted_as_a_shift(matcher):
    result = matcher.locate([photo(matcher, seed=5, pitch_error_deg=0.3, horizon_uncertainty_deg=0.5)])
    assert result.best.photos[0].horizon_shift_deg == pytest.approx(0.3, abs=0.08)
    assert error_m(result) < 250.0


def test_a_declared_roll_error_is_fitted_as_a_tilt(matcher):
    tilted = photo(matcher, seed=6)
    tilted.elev_deg += 0.4 * np.sin(np.radians(tilted.az_offset_deg))      # a roll error tilts the skyline
    tilted.roll_uncertainty_deg = 1.0
    result = matcher.locate([tilted])
    assert result.best.photos[0].horizon_tilt_deg == pytest.approx(0.4, abs=0.15)
    assert error_m(result) < 300.0


def test_three_photos_that_turn_together_share_one_position(matcher):
    photos = [photo(matcher, seed=10 + k, heading=HEADING + rel, photo_id="photo_%d" % (k + 1),
                    relative_heading_deg=rel) for k, rel in enumerate((0.0, 120.0, 240.0))]
    result = matcher.locate(photos)
    assert error_m(result) < 100.0 and heading_error(result) < 0.5
    assert result.stats["groups"] == 1
    headings = [p.heading_deg for p in result.best.photos]
    assert float(geo.angle_diff(headings[1], headings[0])) == pytest.approx(120.0, abs=1e-6)


def test_photos_with_unknown_relative_headings_are_each_turned_freely(matcher):
    photos = [photo(matcher, seed=20, photo_id="a"),
              photo(matcher, seed=21, heading=HEADING + 150.0, photo_id="b")]     # relative heading not given
    result = matcher.locate(photos)
    assert result.stats["groups"] == 2
    assert error_m(result) < 200.0
    found = {p.id: p.heading_deg for p in result.best.photos}
    assert abs(float(geo.angle_diff(found["b"], HEADING + 150.0))) < 0.6


def test_a_prior_limits_the_search(matcher):
    result = matcher.locate([photo(matcher, seed=30)], prior=(LAT + 0.005, LON, 2500.0))
    assert result.stats["candidates_searched"] < 600
    assert error_m(result) < 200.0
    far_away = matcher.locate([photo(matcher, seed=30)], prior=(18.30, 77.20, 1500.0))
    assert float(geo.distance_m(18.30, 77.20, far_away.best.lat, far_away.best.lon)) < 2000.0
    assert far_away.status != "ok"                       # the photo wasn't taken there


def test_the_true_position_outscores_other_places_when_refined(matcher):
    # The scoring rule on real terrain: at the true position the fit beats every other place tried.
    shot = photo(matcher, seed=40)
    fine = FineSearch(matcher.terrain, MatcherConfig(), [shot], make_groups([shot]))
    truth = fine.evaluate(LAT, LON, [HEADING], 1.3)
    assert truth.photos[0].fit_z < 1.2 and truth.photos[0].support > 0.9
    for d_lat, d_lon in ((0.02, 0.0), (-0.03, 0.02), (0.0, -0.05), (0.06, 0.06), (-0.05, -0.04), (0.003, 0.003)):
        other = fine.evaluate(LAT + d_lat, LON + d_lon, [HEADING], 1.3)
        assert other.loglike < truth.loglike
