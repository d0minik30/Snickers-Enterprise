"""The scoring rule: candidates are compared on how well they fit, and on nothing else."""
import math

import numpy as np
import pytest

from marsloc.match.resample import Binned, PhotoObservation, bin_group, bin_samples, make_groups
from marsloc.match.score import (MatcherConfig, base_variance, bias_grid, extra_variance, fit_terms,
                                 heading_penalty, logsumexp, reliability, score_sum)

CFG = MatcherConfig()
BASE = base_variance(0.05, CFG)          # a photo traced to 0.05 deg


def score(resid, extra, weight=None, config=CFG):
    """Score of one candidate from its per-bin residuals and extra tolerance."""
    resid = np.asarray(resid, dtype=float)
    weight = np.ones(resid.shape) if weight is None else np.asarray(weight, dtype=float)
    fit, counts = fit_terms(resid, BASE, np.broadcast_to(extra, resid.shape), weight, config)
    return float(score_sum(fit, counts, weight, config))


# ---------------------------------------------------------------- the bug this replaces

@pytest.mark.parametrize("times_worse", [2.0, 3.0])
def test_a_truth_on_near_terrain_beats_a_far_terrain_look_alike_that_fits_worse(times_worse):
    # 120 bins. The true position's horizon is formed by near terrain: it tolerates a lot
    # (extra variance of 0.5 deg^2), and it fits to 0.03 deg. The look-alike's horizon is far
    # terrain with no extra tolerance, and it fits 2 or 3 times worse.
    rng = np.random.default_rng(0)
    noise = rng.normal(0.0, 1.0, 120)
    truth = score(0.03 * noise, extra=0.5)
    look_alike = score(times_worse * 0.03 * noise, extra=0.0)
    assert truth > look_alike


@pytest.mark.parametrize("extra", [0.0, 0.01, 0.5, 25.0])
def test_a_perfect_fit_scores_the_same_whatever_the_tolerance(extra):
    # No reward for a narrow tolerance (far terrain), no penalty for a broad one (near terrain).
    assert score(np.zeros(100), extra) == pytest.approx(100 * CFG.best_fit)


def test_between_two_far_terrain_candidates_the_smaller_residual_wins():
    rng = np.random.default_rng(1)
    noise = rng.normal(0.0, 1.0, 120)
    assert score(0.03 * noise, 0.0) > score(0.06 * noise, 0.0) > score(0.12 * noise, 0.0)


def test_a_broad_tolerance_is_not_a_way_to_win():
    # A candidate whose whole horizon tolerates anything "fits" garbage. It must not beat a
    # candidate that really fits: it has too little informative skyline to judge and counts
    # as a mediocre fit instead.
    rng = np.random.default_rng(2)
    garbage_on_broad = score(rng.normal(0.0, 1.5, 120), extra=100.0)
    good_on_narrow = score(rng.normal(0.0, 0.05, 120), extra=0.0)
    assert good_on_narrow > garbage_on_broad
    # mediocre, give or take the few bins that land within the base tolerance by chance
    assert garbage_on_broad == pytest.approx(120 * CFG.neutral_fit, rel=0.12)
    assert CFG.best_fit > CFG.neutral_fit > math.log(CFG.outlier_floor)


def test_a_few_lucky_bins_cannot_carry_a_candidate():
    # 6 tight bins that fit exactly; the other 114 tolerate anything and miss by half a degree,
    # so they say nothing: below min_support.
    tight = np.arange(120) < 6
    lucky = score(np.where(tight, 0.0, 0.5), np.where(tight, 0.0, 1e6))
    solid = score(np.full(120, 0.05), 0.0)          # every bin tight, each about 1 tolerance off
    assert lucky < solid
    # what can't be judged counts as mediocre, so more confirmed skyline is always better
    more = score(np.where(np.arange(120) < 60, 0.0, 0.5), np.where(np.arange(120) < 60, 0.0, 1e6))
    full = score(np.zeros(120), 0.0)
    assert lucky < more < full == pytest.approx(120 * CFG.best_fit)
    assert lucky == pytest.approx(6 * CFG.best_fit + 114 * CFG.neutral_fit, rel=1e-3)


# ---------------------------------------------------------------- weights and outliers

def test_weight_0_bins_have_no_influence_whatever_was_traced_there():
    resid = np.full(60, 0.02)
    weight = np.ones(60)
    weight[20:30] = 0.0
    a = resid.copy()
    b = resid.copy()
    a[20:30], b[20:30] = 0.0, 47.0
    assert score(a, 0.0, weight) == score(b, 0.0, weight)
    fit_a, info = fit_terms(a, BASE, 0.0, weight, CFG)
    assert (info[20:30] == 0).all() and (info[:20] == 1).all()


def test_a_rock_costs_a_bounded_amount_however_tall_it_is():
    clean = np.full(120, 0.02)
    rock8, rock40 = clean.copy(), clean.copy()
    rock8[50:54], rock40[50:54] = 8.0, 40.0           # a nearby rock over 4 bins, weight 1
    assert score(rock8, 0.0) == pytest.approx(score(rock40, 0.0), abs=1e-9)
    per_bin_cost = (score(clean, 0.0) - score(rock8, 0.0)) / 4
    assert 0 < per_bin_cost < 0.5 * CFG.outlier_z ** 2 + 0.2      # about a 3-tolerance miss each
    # 4 rock bins of 120 must matter less than fitting everything twice as badly
    assert score(rock8, 0.0) > score(np.full(120, 0.09), 0.0)


def test_half_weight_counts_half():
    good, bad = np.full(50, 0.02), np.full(50, 0.15)
    full_gap = score(good, 0.0) - score(bad, 0.0)
    half_gap = score(good, 0.0, np.full(50, 0.5)) - score(bad, 0.0, np.full(50, 0.5))
    assert 0 < half_gap < 0.6 * full_gap          # a half-trusted photo separates candidates less
    fit, info = fit_terms(bad, BASE, 0.0, np.full(50, 0.5), CFG)
    assert info == pytest.approx(0.5)             # and its bins count half in the mean


def test_a_bin_counts_if_its_tolerance_is_tight_or_if_it_fits_anyway():
    resid = np.array([0.4, 0.4, 0.01])
    extra = np.array([0.0, 100.0, 100.0])
    _, counts = fit_terms(resid, BASE, extra, np.ones(3), CFG)
    assert counts[0] == pytest.approx(1.0)                     # tight tolerance: it counts (as a miss)
    assert counts[1] < 0.01                                    # tolerates anything, and misses: can't be judged
    assert counts[2] > 0.95                                    # tolerates anything, but fits anyway: it counts


# ---------------------------------------------------------------- tolerance from parallax

def test_extra_tolerance_grows_for_near_terrain_and_steep_skylines():
    elev = np.array([[1.0, 1.0, 1.0, 2.0, 3.0, 3.0, 3.0, 3.0]])     # a ramp in the middle
    for dist in (300.0, 3000.0, 30000.0):
        extra = extra_variance(elev, np.full(elev.shape, dist), 0.5, 80.0, 0.1, CFG, circular=False)
        assert (extra[0, 3] > extra[0, 0]).all()                    # steeper = less certain
    near = extra_variance(elev, np.full(elev.shape, 300.0), 0.5, 80.0, 0.1, CFG, circular=False)
    far = extra_variance(elev, np.full(elev.shape, 30000.0), 0.5, 80.0, 0.1, CFG, circular=False)
    assert (near > 100 * far).all()
    here = extra_variance(elev, np.full(elev.shape, 300.0), 0.5, 0.0, 0.0, CFG, circular=False)
    assert (here == 0).all()             # at the exact position and heading: nothing extra


def test_flat_terrain_at_the_horizon_needs_no_extra_tolerance():
    flat = np.zeros((1, 20))
    assert (extra_variance(flat, np.full(flat.shape, 500.0), 0.5, 80.0, 0.5, CFG) == 0).all()


def test_near_field_rule_and_dem_error_are_off_by_default():
    assert CFG.near_field_m == 0.0 and CFG.dem_height_error_m == 0.0
    dist = np.array([100.0, 800.0, 1200.0, 5000.0])
    assert (reliability(dist, CFG) == 1.0).all()
    on = MatcherConfig(near_field_m=1500.0, near_weight=0.1)
    assert reliability(dist, on) == pytest.approx([0.1, 0.16, 0.64, 1.0])
    flat = np.zeros((1, 4))
    assert (extra_variance(flat, dist[None, :], 0.5, 0.0, 0.0, on)[0, :3] > 0).all()
    with_dem = MatcherConfig(dem_height_error_m=2.0)
    assert extra_variance(flat, dist[None, :], 0.5, 0.0, 0.0, with_dem)[0, 0] == pytest.approx(
        math.degrees(2.0 / 100.0) ** 2)


# ---------------------------------------------------------------- small helpers

def test_bias_grid_covers_the_declared_uncertainty():
    assert bias_grid(0.0, 0.1).tolist() == [0.0]
    grid = bias_grid(0.3, 0.1)
    assert grid[0] == -0.3 and grid[-1] == 0.3 and 0.0 in grid and np.diff(grid).max() <= 0.05 + 1e-12
    assert bias_grid(5.0, 0.01).size == 41          # capped


def test_logsumexp_and_heading_penalty():
    assert logsumexp(np.array([0.0, 0.0])) == pytest.approx(math.log(2.0))
    assert logsumexp(np.array([-1e9, 3.0, -np.inf])) == pytest.approx(3.0)
    assert np.isneginf(logsumexp(np.array([-np.inf, -np.inf])))
    assert heading_penalty(np.array([10.0, 350.0]), []).tolist() == [0.0, 0.0]
    penalty = heading_penalty(np.array([10.0, 350.0, 190.0]), [(0.0, 5.0)])
    assert penalty == pytest.approx([4.0, 4.0, (170.0 / 5.0) ** 2])


# ---------------------------------------------------------------- photo samples into bins

def test_binning_averages_trusted_samples_and_ignores_weight_0():
    az = np.array([-0.2, -0.1, 0.0, 0.1, 0.2, 0.9, 1.0, 1.1])
    elev = np.array([1.0, 1.0, 1.0, 9.0, 1.0, 2.0, 2.0, 2.0])
    weight = np.array([1.0, 1.0, 1.0, 0.0, 1.0, 1.0, 1.0, 1.0])       # the 9.0 is a flagged rock
    binned = bin_samples(az, elev, weight, 0.5)
    assert binned.k0 == 0 and binned.n == 3
    assert binned.offsets_deg.tolist() == [0.0, 0.5, 1.0]
    assert binned.elev[0] == pytest.approx(1.0)              # the rock didn't leak into the mean
    assert binned.weight[0] == pytest.approx(0.8)            # 4 of the bin's 5 samples trusted
    assert binned.elev[2] == pytest.approx(2.0) and binned.weight[2] == 1.0
    # the empty middle bin is filled from the line between the samples at 0.2 and 0.9 deg
    assert binned.elev[1] == pytest.approx(1.0 + 0.3 / 0.7) and binned.weight[1] == 1.0


def test_sparse_samples_are_joined_but_real_gaps_stay_gaps():
    az = np.array([0.0, 0.8, 1.6, 6.0, 6.8])                 # 0.8 deg apart, then a 4.4 deg hole
    binned = bin_samples(az, np.array([1.0, 2.0, 3.0, 5.0, 6.0]), np.ones(5), 0.25)
    offsets = binned.offsets_deg
    assert (binned.weight[offsets <= 1.6] == 1.0).all()
    assert binned.elev[np.isclose(offsets, 0.5)][0] == pytest.approx(1.625)    # on the line from 0 to 0.8 deg
    hole = (offsets > 1.7) & (offsets < 5.9)
    assert hole.sum() > 10 and (binned.weight[hole] == 0).all() and (binned.elev[hole] == 0).all()


def test_a_panorama_longer_than_the_circle_is_folded():
    az = np.arange(-200.0, 200.0, 0.5)
    binned = bin_samples(az, np.ones(az.size), np.ones(az.size), 1.0)
    assert binned.k0 == 0 and binned.n == 360 and (binned.weight > 0).all()


def test_photo_observation_sorts_and_checks_its_samples():
    photo = PhotoObservation(az_offset_deg=[10.0, -10.0, 0.0], elev_deg=[3.0, 1.0, 2.0], weight=[1.0, 2.0, -1.0])
    assert photo.az_offset_deg.tolist() == [-10.0, 0.0, 10.0] and photo.elev_deg.tolist() == [1.0, 2.0, 3.0]
    assert photo.weight.tolist() == [1.0, 0.0, 1.0]          # clipped into 0..1
    assert PhotoObservation([0.0, 1.0], [1.0, 1.0]).weight.tolist() == [1.0, 1.0]
    for bad in (dict(az_offset_deg=[], elev_deg=[]), dict(az_offset_deg=[0.0], elev_deg=[1.0, 2.0]),
                dict(az_offset_deg=[0.0], elev_deg=[float("nan")]),
                dict(az_offset_deg=[0.0], elev_deg=[1.0], angle_sigma_deg=0.0)):
        with pytest.raises(ValueError):
            PhotoObservation(**bad)


def test_photos_with_known_relative_headings_turn_together():
    def photo(rel, **more):
        return PhotoObservation([-1.0, 0.0, 1.0], [1.0, 2.0, 1.0], relative_heading_deg=rel, **more)

    groups = make_groups([photo(None), photo(90.0), photo(None), photo(-45.0, heading_prior_deg=10.0)])
    assert [g.photos for g in groups] == [[0, 1, 3], [2]]
    assert groups[0].relative_deg == [0.0, 90.0, -45.0] and groups[1].relative_deg == [0.0]
    assert make_groups([photo(0.0), photo(30.0)])[0].photos == [0, 1]
    with pytest.raises(ValueError, match="first photo"):
        make_groups([photo(20.0), photo(None)])
    with pytest.raises(ValueError):
        make_groups([])
    # a hint on a photo 45 deg left of the first one puts the group's heading 45 deg right of the hint
    observations = [photo(None), photo(90.0), photo(None), photo(-45.0, heading_prior_deg=10.0)]
    assert groups[0].priors(observations) == [(55.0, 3.0)] and groups[1].priors(observations) == []


def test_a_photo_to_the_right_of_the_first_sits_at_larger_azimuths_in_the_group():
    first = PhotoObservation([-1.0, 0.0, 1.0], [1.0, 2.0, 1.0])
    right = PhotoObservation([-1.0, 0.0, 1.0], [5.0, 6.0, 5.0], relative_heading_deg=90.0)   # clockwise
    a, b = bin_group([first, right], make_groups([first, right])[0], 0.5)
    assert isinstance(a, Binned) and a.offsets_deg[0] == -1.0 and a.offsets_deg[-1] == 1.0
    assert b.offsets_deg[0] == 89.0 and b.offsets_deg[-1] == 91.0
    assert b.elev[np.isclose(b.offsets_deg, 90.0)][0] == 6.0
