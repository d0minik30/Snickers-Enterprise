"""How well a photo's skyline fits a horizon: the settings and the per-bin fit.

The rule that everything here follows: candidates are compared on how well they FIT, and on
nothing else. A candidate must never score higher because its horizon is far away, or lower
because it is close.

Each observed bin is compared with the horizon value at the same azimuth:

    z = (observed - horizon) / tolerance
    fit = log( inlier * exp(-z^2 / 2) + floor )

- inlier = (1 - outlier_fraction) x the sample's weight. A bin with weight 0 has the same fit
  whatever the horizon is, so it has no influence at all.
- floor = exp(-outlier_z^2 / 2) caps the cost: a nearby rock or a haze segment costs as much
  as a 3-tolerance miss, no matter how far off it is.
- A perfect fit gives the same value for every bin of every candidate. There is no
  1 / tolerance factor: that factor (the height of a Gaussian's peak) would reward candidates
  for having a narrow tolerance, i.e. for having far terrain.

The tolerance is the photo's angle error plus the renderer's (model_sigma_deg), the same for
all candidates, plus what this candidate's horizon can be off by because the candidate is only
NEAR the true position (parallax: every feature shifts sideways and changes height in the view
when the camera moves, more so for near terrain).

That extra part can make a bin UNINFORMATIVE: a bin that tolerates 2 degrees "fits" anything.
So each bin COUNTS with a weight between 0 and the sample's weight. It counts in full if its
tolerance is as tight as the base tolerance, or if it actually fits to within the base
tolerance however much it would have been allowed; otherwise in proportion to how tight its
tolerance is. What does not count is scored as a mediocre fit (neutral_z):

    score = sum over bins of  counts * fit + (weight - counts) * mediocre

So a true position whose near terrain fits gets full credit for it; near-terrain bins that
miss neither help nor hurt much (they can't be judged); and a candidate cannot win by
tolerating everything: at best it is mediocre throughout.
"""
import math
from dataclasses import dataclass, field

import numpy as np

from ..horizon.render import RenderConfig
from ..horizon.store import STORE_CONFIG


@dataclass(frozen=True)
class MatcherConfig:
    # --- tolerance
    model_sigma_deg: float = 0.03      # what a rendered horizon is off by even at the right place
    # Optional extra tolerance for terrain close to the camera. Both are OFF until the validation
    # harness shows they help (scripts/validate.py reports the effect).
    near_field_m: float = 0.0          # trust falls off below this distance; 0 = rule off
    near_weight: float = 0.1           # how much a bin closer than half of near_field_m counts
    dem_height_error_m: float = 0.0    # height error of the elevation data; 0 = none assumed

    # --- robust scoring
    outlier_fraction: float = 0.1      # share of trusted samples expected to be wrong anyway
    outlier_z: float = 3.0             # an outlier costs as much as a miss of this many sigma
    neutral_z: float = 1.5             # the "mediocre fit" given to what can't be judged
    min_support: float = 0.2           # share of the usable skyline that must count for a verdict
    correlation_deg: float = 1.0       # neighbouring bins err together over about this much azimuth

    # --- coarse search on the precomputed horizons
    position_factor: float = 0.41      # rms distance to the nearest grid point, in grid spacings
    prefilter_pool: int = 4            # first pass: bins of this many stored bins (4 x 0.5 = 2 deg)
    prefilter_keep: float = 0.20       # share of the candidates that go on to the second pass ...
    prefilter_min_keep: int = 1500     # ... but at least this many
    prefilter_headings: int = 3        # headings per candidate that go on
    coarse_offset_m: float = 115.0     # how far the true position is expected from a candidate (rms)
    coarse_fit_error_m: float = 30.0   # position error left after the offset fit of pass 2
    linear_distance_m: float = 1000.0  # terrain closer than this hardly steers the offset fit

    # --- fine search with live rendering
    fine_modes: int = 3                # how many separate places to refine
    fine_min_probability: float = 0.02  # ... if they hold at least this share of the likelihood
    fine_start_m: float = 200.0        # first step of the search around a candidate
    fine_levels: int = 7               # the step halves each level: 200, 100, 50, ... 6.3, 3.1 m
    fine_az_step_deg: float = 0.25
    fine_heading_window_deg: float = 1.5
    fine_heading_step_deg: float = 0.05
    fine_render: RenderConfig = field(default_factory=lambda: STORE_CONFIG)

    # --- separate places ("modes") in the likelihood map
    mode_separation_m: float = 600.0   # peaks closer than this are one place
    max_modes: int = 12

    # --- verdict
    ambiguous_below: float = 0.6       # the best place holds less than this share of the likelihood
    min_coverage: float = 0.5          # ambiguous if less than this share of the photos' skyline is usable
    no_match_below: float = 0.5        # less than this share of the usable skyline fits
    no_match_fit_z: float = 2.0        # or the usable skyline misses by more than this many sigma (rms)

    @property
    def outlier_floor(self):
        return math.exp(-0.5 * self.outlier_z ** 2)

    @property
    def neutral_fit(self):
        """The fit of a bin that misses by neutral_z tolerances."""
        inlier = 1.0 - self.outlier_fraction
        return math.log(inlier * math.exp(-0.5 * self.neutral_z ** 2) + self.outlier_floor)

    @property
    def best_fit(self):
        """The fit of a fully trusted bin that matches exactly: the most any bin can score."""
        return math.log(1.0 - self.outlier_fraction + self.outlier_floor)


def reliability(dist_m, config):
    """Trust in a horizon bin, near_weight..1, from the distance of the terrain forming it
    (the optional near-field rule). 1 everywhere when the rule is off."""
    dist = np.asarray(dist_m, dtype=np.float64)
    if config.near_field_m <= 0:
        return np.ones(dist.shape)
    half = 0.5 * config.near_field_m
    ramp = np.clip((dist - half) / half, 0.0, 1.0)
    return config.near_weight + (1.0 - config.near_weight) * ramp


def extra_variance(elev_deg, dist_m, step_deg, position_error_m, heading_error_deg, config,
                   circular=True):
    """Variance (deg^2) of what a candidate's horizon can be off by beyond the base tolerance,
    per bin, along the last axis.

    elev_deg, dist_m: the horizon and the distance of its terrain, with bins step_deg apart.
    position_error_m: how far the true position may be from this one (rms).
    heading_error_deg: how far the true heading may be from the one tried (rms).
    circular: the last axis is the full circle (its ends are neighbours).

    Parallax: the horizon profile slides sideways (by position_error / dist, and by the heading
    error) times its slope, and a feature's elevation angle changes as the camera moves toward
    or away from it. Plus, only if switched on: the DEM's height error seen from dist, and the
    near-field rule (a bin trusted `t` gets the tolerance that makes it count about `t`).
    """
    elev = np.asarray(elev_deg, dtype=np.float64)
    dist = np.maximum(np.asarray(dist_m, dtype=np.float64), 1.0)
    if circular:
        ahead = np.roll(elev, -1, axis=-1) - elev
        behind = elev - np.roll(elev, 1, axis=-1)
    else:
        ahead = np.diff(elev, axis=-1, append=elev[..., -1:])
        behind = np.diff(elev, axis=-1, prepend=elev[..., :1])
    slope_sq = 0.5 * (ahead ** 2 + behind ** 2) / step_deg ** 2          # (deg per deg)^2
    parallax_deg = np.degrees(position_error_m / dist)
    extra = slope_sq * (parallax_deg ** 2 + heading_error_deg ** 2) + (elev * position_error_m / dist) ** 2
    if config.dem_height_error_m > 0:
        extra = extra + np.degrees(config.dem_height_error_m / dist) ** 2
    if config.near_field_m > 0:
        trust = reliability(dist, config)
        extra = extra + (1.0 / trust - 1.0) * (0.1 ** 2 + extra)   # relative to a 0.1 deg tolerance
    return extra


def base_variance(angle_sigma_deg, config):
    """The tolerance every candidate gets (deg^2): the photo's angle error and the renderer's."""
    return angle_sigma_deg ** 2 + config.model_sigma_deg ** 2


def fit_terms(resid, base_var, extra_var, weight, config):
    """Per bin: (fit, how much the bin counts).

    resid: observed minus horizon (deg). base_var: base_variance(). extra_var: extra_variance()
    at the bin, or 0. weight: the photo's weight for the bin (0..1; 0 where there is no
    horizon to compare with).
    """
    total = base_var + extra_var
    inlier = weight * (1.0 - config.outlier_fraction)
    fit = np.log(inlier * np.exp(-0.5 * resid * resid / total) + config.outlier_floor)
    tight = base_var / total
    fits = np.exp(-0.5 * resid * resid / base_var)
    return fit, weight * np.maximum(tight, fits)


def score_sum(fit, counts, weight, config, axis=-1):
    """A candidate's score from its bins: the fit of what counts plus a mediocre fit for what
    doesn't (see the module text). Bins with weight 0 add nothing."""
    return (counts * fit + (weight - counts) * config.neutral_fit).sum(axis=axis, dtype=np.float64)


def bias_grid(horizon_uncertainty_deg, sigma_deg, per_sigma=2.0, limit=41):
    """Up/down shifts to try for a photo whose horizontal may be off: -u..+u in steps of about
    sigma / per_sigma. Just [0] when the photo declares no uncertainty."""
    if horizon_uncertainty_deg <= 0:
        return np.zeros(1)
    half = min((limit - 1) // 2, max(1, math.ceil(horizon_uncertainty_deg * per_sigma / sigma_deg)))
    return np.linspace(-horizon_uncertainty_deg, horizon_uncertainty_deg, 2 * half + 1)


def logsumexp(values, axis=-1):
    """log(sum(exp(values))) along an axis, safe for very negative values and -inf."""
    values = np.asarray(values, dtype=np.float64)
    top = np.max(values, axis=axis, keepdims=True)
    top = np.where(np.isfinite(top), top, 0.0)
    with np.errstate(divide="ignore"):
        out = np.log(np.sum(np.exp(values - top), axis=axis, keepdims=True)) + top
    return np.squeeze(out, axis=axis)


def heading_penalty(heading_deg, priors):
    """Sum over the heading hints of ((heading - hint) / sigma)^2; 0 without hints."""
    heading = np.asarray(heading_deg, dtype=np.float64)
    total = np.zeros(heading.shape)
    for mean, sigma in priors:
        diff = np.mod(heading - mean + 180.0, 360.0) - 180.0
        total += (diff / sigma) ** 2
    return total
