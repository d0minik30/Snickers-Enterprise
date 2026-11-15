"""How well a photo's skyline fits a horizon: the settings and the per-bin likelihood.

Each observed bin is compared with the horizon value at the same azimuth. A bin is either

- an inlier: the observed angle is the horizon's plus Gaussian noise, or
- an outlier (a rock near the camera, haze, a wrong trace): the angle could be anything
  within outlier_range_deg.

The chance of being an inlier is (1 - outlier_fraction) x the sample's weight. So a bin with
weight 0 has no influence at all, and a nearby rock costs a bounded amount no matter how tall
it is.

The Gaussian's width combines the photo's own angle error with what the horizon can be off by:
the DEM's height error seen at that distance, and the fact that a candidate position (and
heading) is only near the true one, which shifts every feature by parallax. Horizon bins
formed by terrain close to the camera are trusted less (reliability()): their variance is
divided by that trust, so they pull less on the fit. At 20 m per pixel the elevation data
can't show rocks, ripples and ledges that close.

Trust must widen the Gaussian, never lower the chance of being an inlier: that would cap what
a near-terrain bin can score however well it fits, and every far-terrain look-alike would
beat a true position whose horizon is near terrain.
"""
import math
from dataclasses import dataclass, field

import numpy as np

from ..horizon.render import RenderConfig
from ..horizon.store import STORE_CONFIG


@dataclass(frozen=True)
class MatcherConfig:
    # --- how far a horizon bin is trusted, by the distance of the terrain that forms it
    near_field_m: float = 1500.0       # trusted fully beyond this; 0 switches the rule off
    near_weight: float = 0.1           # trust below half of near_field_m (ramps up in between)
    dem_height_error_m: float = 2.0    # height error of the elevation data

    # --- robust scoring
    outlier_fraction: float = 0.1      # share of trusted samples expected to be wrong anyway
    outlier_range_deg: float = 10.0    # an outlier may sit anywhere in a range this wide
    correlation_deg: float = 1.0       # neighbouring bins err together over about this much azimuth

    # --- coarse search on the precomputed horizons
    position_factor: float = 0.41      # rms distance to the nearest grid point, in grid spacings
    prefilter_pool: int = 4            # first pass: bins of this many stored bins (4 x 0.5 = 2 deg)
    prefilter_keep: float = 0.10       # share of the candidates that go on to the second pass ...
    prefilter_min_keep: int = 1500     # ... but at least this many
    prefilter_headings: int = 3        # headings per candidate that go on

    # --- fine search with live rendering
    fine_modes: int = 3                # how many separate places to refine
    fine_min_probability: float = 0.02  # ... if they hold at least this share of the likelihood
    fine_start_m: float = 100.0        # first step of the search around a candidate
    fine_levels: int = 4               # the step halves this many times: 100, 50, 25, 12.5 m
    fine_az_step_deg: float = 0.25
    fine_heading_window_deg: float = 1.5
    fine_heading_step_deg: float = 0.05
    fine_render: RenderConfig = field(default_factory=lambda: STORE_CONFIG)

    # --- separate places ("modes") in the likelihood map
    mode_separation_m: float = 600.0   # peaks closer than this are one place
    max_modes: int = 12

    # --- verdict
    ambiguous_below: float = 0.6       # best place holds less than this share of the likelihood
    no_match_below: float = 0.5        # less than this share of the trusted skyline fits


def reliability(dist_m, config):
    """Trust in a horizon bin, near_weight..1, from the distance of the terrain forming it.
    0 where there is no terrain (NaN)."""
    dist = np.asarray(dist_m, dtype=np.float64)
    if config.near_field_m <= 0:
        trust = np.ones(dist.shape)
    else:
        half = 0.5 * config.near_field_m
        ramp = np.clip((dist - half) / half, 0.0, 1.0)
        trust = config.near_weight + (1.0 - config.near_weight) * ramp
    return np.where(np.isfinite(dist), trust, 0.0)


def model_variance(elev_deg, dist_m, step_deg, position_error_m, heading_error_deg, config,
                   circular=True):
    """Variance (deg^2) of what a horizon can be off by, per bin, along the last axis.

    elev_deg, dist_m: the horizon and the distance of its terrain, with bins step_deg apart.
    position_error_m: how far the true position may be from this one (rms).
    heading_error_deg: how far the true heading may be from the one tried (rms).
    circular: the last axis is the full circle (its ends are neighbours).

    Three parts: the DEM's height error seen from dist; the horizon profile sliding sideways
    (by parallax, position_error / dist, and by the heading error) times its slope; and the
    feature's elevation angle changing as the camera moves toward or away from it.
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
    slide_sq = parallax_deg ** 2 + heading_error_deg ** 2
    dem_deg = np.degrees(config.dem_height_error_m / dist)
    return dem_deg ** 2 + slope_sq * slide_sq + (elev * position_error_m / dist) ** 2


def trusted_variance(var, trust):
    """Variance widened by the lack of trust: var / trust. Returns (variance, known), where
    known is False for bins without a horizon (trust 0); their variance is a placeholder."""
    known = trust > 0
    return np.where(known, var / np.where(known, trust, 1.0), 1.0), known


def loglike_terms(resid, var, inlier, config):
    """Log-likelihood of each bin. resid: observed minus horizon (deg). var: total variance
    (deg^2). inlier: chance that the bin is an inlier (0..1)."""
    gauss = inlier * np.exp(-0.5 * resid * resid / var) / np.sqrt(2.0 * math.pi * var)
    return np.log(gauss + (1.0 - inlier) / config.outlier_range_deg)


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
