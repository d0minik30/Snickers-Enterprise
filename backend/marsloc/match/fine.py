"""Fine search: around a candidate from the coarse search, with horizons rendered live.

The precomputed candidates are 200 m apart. Starting from one of them, the position is
improved by a shrinking pattern search: score the 3 x 3 positions around the current best,
move to the best of them, halve the spacing, repeat (100 m down to about 3 m). Every position
needs one live render of the part of the horizon the photos cover. Heading is continuous
here: the rendered horizon is interpolated at each heading tried.

As the spacing shrinks, so does the allowance for "the true position is only near this one"
(score.extra_variance). Bins formed by near terrain, which say nothing at 100 m spacing,
become informative, and the fit sharpens level by level.
"""
import math
from dataclasses import dataclass, field

import numpy as np

from .. import geo
from ..horizon.render import render_horizon
from .resample import bin_group
from .score import base_variance, bias_grid, extra_variance, fit_terms, heading_penalty, logsumexp, score_sum


@dataclass
class PhotoFit:
    """How one photo fits the horizon at a matched position."""
    id: str
    heading_deg: float                 # direction of the optical axis, clockwise from north
    horizon_shift_deg: float           # fitted constant up/down shift (0 unless allowed)
    az_offset_deg: np.ndarray          # per bin: azimuth relative to the optical axis
    observed_elev_deg: np.ndarray      # what the photo shows (NaN in gaps)
    model_elev_deg: np.ndarray         # what the terrain gives
    residual_deg: np.ndarray           # observed - shift - model (NaN in gaps)
    distance_m: np.ndarray             # how far away the terrain forming the horizon is
    sigma_deg: np.ndarray              # tolerance: expected size of the residual
    trust: np.ndarray                  # the photo's weight x how informative the bin is, 0..1
    used: np.ndarray                   # bool: trusted and within 3 sigma
    photo_weight: float = 0.0          # sum of the photo's bin weights (its usable size)
    horizon_tilt_deg: float = 0.0      # fitted tilt t (elevation off by t * sin(az_offset)); 0 unless allowed
    bins_total: int = 0                # bins across the photo's field of view, gaps included

    @property
    def inlier_fraction(self):
        """Share of the trusted skyline (by trust) that fits within 3 sigma."""
        total = self.trust.sum()
        return float(self.trust[self.used].sum() / total) if total > 0 else 0.0

    @property
    def fit_z(self):
        """How far the trusted skyline misses, in tolerances (rms, each bin capped at 3).
        About 1 for a true match with honest noise settings; 2 and more is a poor fit."""
        total = self.trust.sum()
        if total <= 0:
            return float("nan")
        z = np.where(self.trust > 0, np.nan_to_num(self.residual_deg) / self.sigma_deg, 0.0)
        return float(np.sqrt((self.trust * np.minimum(z * z, 9.0)).sum() / total))

    @property
    def support(self):
        """Share of the photo's usable skyline that is informative at the matched position."""
        return float(self.trust.sum() / self.photo_weight) if self.photo_weight > 0 else 0.0

    @property
    def coverage(self):
        """Share of the photo's field of view with a usable skyline (weight above 0)."""
        return float(self.photo_weight / self.bins_total) if self.bins_total else 0.0

    @property
    def rms_residual_deg(self):
        return float(np.sqrt(np.mean(self.residual_deg[self.used] ** 2))) if self.used.any() else float("nan")

    @property
    def median_abs_residual_deg(self):
        return float(np.median(np.abs(self.residual_deg[self.used]))) if self.used.any() else float("nan")


@dataclass
class ModeFit:
    """A refined candidate position."""
    lat: float
    lon: float
    loglike: float
    headings_deg: list                  # per group
    spread_m: float                     # rms size of the likelihood peak around the position
    photos: list = field(default_factory=list)     # PhotoFit per photo
    renders: int = 0
    refined: bool = True


class FineSearch:
    """Scores positions against the photos with live rendering. One per request."""

    def __init__(self, terrain, config, observations, groups):
        self.terrain = terrain
        self.config = config
        self.observations = observations
        self.groups = groups
        covered = sum(float(np.ptp(o.az_offset_deg)) for o in observations)
        self.step = config.fine_az_step_deg * (2.0 if covered > config.fine_wide_deg else 1.0)
        self.binned = [bin_group(observations, group, self.step) for group in groups]
        self.priors = [group.priors(observations) for group in groups]
        self.temper = self.step / config.correlation_deg
        self.eye_height_m = float(np.mean([o.eye_height_m for o in observations]))
        window, hstep = config.fine_heading_window_deg, config.fine_heading_step_deg
        half = int(round(window / hstep))
        self.heading_offsets = np.arange(-half, half + 1) * hstep
        self.renders = 0

    # ------------------------------------------------------------ rendering

    def render(self, lat, lon, headings_deg):
        """The parts of the horizon the photos cover when the groups face headings_deg.
        Returns one dict per group, or None if the position is off the terrain."""
        out = []
        for group_binned, heading in zip(self.binned, headings_deg):
            low = min(b.offsets_deg[0] for b in group_binned)
            high = max(b.offsets_deg[-1] for b in group_binned)
            margin = self.config.fine_heading_window_deg + 2 * self.step
            start = math.floor((heading + low - margin) / self.step) * self.step
            count = int(math.ceil((high - low + 2 * margin) / self.step)) + 2
            full = count * self.step >= 360.0
            if full:
                start, count = 0.0, int(round(360.0 / self.step))
            azimuths = np.mod(start + np.arange(count) * self.step, 360.0)
            try:
                horizon = render_horizon(self.terrain, lat, lon, self.eye_height_m,
                                         self.config.fine_render, azimuths_deg=azimuths)
            except ValueError:
                return None
            known = np.isfinite(horizon.elev_deg)
            out.append({"start": start, "full": full, "heading": heading, "known": known,
                        "elev": np.where(known, horizon.elev_deg, 0.0),
                        "dist": np.where(known, horizon.dist_m, 1e9)})
        self.renders += 1
        return out

    # ------------------------------------------------------------ scoring

    def _at(self, part, values, azimuths_deg):
        """values (one per rendered ray) interpolated at absolute azimuths."""
        pos = np.mod(azimuths_deg - part["start"], 360.0) / self.step
        n = values.size
        i0 = np.floor(pos).astype(np.int64)
        frac = pos - i0
        if part["full"]:
            return values[i0 % n] * (1 - frac) + values[(i0 + 1) % n] * frac
        i0 = np.clip(i0, 0, n - 2)
        frac = np.clip(pos - i0, 0.0, 1.0)
        return values[i0] * (1 - frac) + values[i0 + 1] * frac

    def score(self, rendered, position_error_m, detail=False):
        """Log-likelihood of a rendered position, heading summed out.

        Returns (loglike, headings per group). With detail=True also the PhotoFit of every
        photo at the best headings.
        """
        if rendered is None:
            return (-np.inf, [], []) if detail else (-np.inf, [])
        cfg = self.config
        total = 0.0
        best_headings = []
        fits = [None] * len(self.observations)
        for group, group_binned, priors, part in zip(self.groups, self.binned, self.priors, rendered):
            known = part["known"].astype(np.float64)
            extra = np.where(part["known"],
                             extra_variance(part["elev"], part["dist"], self.step, position_error_m,
                                            cfg.fine_heading_step_deg / math.sqrt(12.0), cfg,
                                            circular=part["full"]), 0.0)
            headings = part["heading"] + self.heading_offsets
            score = np.zeros(headings.size)
            per_photo = []
            for index, binned, rel in zip(group.photos, group_binned, group.relative_deg):
                photo = self.observations[index]
                az = headings[:, None] + binned.offsets_deg[None, :]
                model = self._at(part, part["elev"], az)
                more = self._at(part, extra, az)
                weight = (self._at(part, known, az) > 0.999) * binned.weight[None, :]   # both rays known
                resid = binned.elev[None, :] - model
                base = base_variance(photo.angle_sigma_deg, cfg)
                # a wrong "horizontal": a constant shift and, for a roll error, a tilt t * sin(az_offset)
                tilt_shape = np.sin(np.radians(binned.offsets_deg - rel))[None, :]
                combos = np.array([(b, t)
                                   for t in bias_grid(photo.roll_uncertainty_deg, photo.angle_sigma_deg, 1.0, 9)
                                   for b in bias_grid(photo.horizon_uncertainty_deg, photo.angle_sigma_deg)])
                by_combo = np.stack([score_sum(*fit_terms(resid - b - t * tilt_shape, base, more, weight, cfg),
                                               weight, cfg) for b, t in combos], axis=1)   # [headings, combos]
                pick = np.argmax(by_combo, axis=1)
                score += by_combo[np.arange(headings.size), pick]
                per_photo.append((index, binned, combos[pick]))
            ll = self.temper * score - 0.5 * heading_penalty(headings, priors)
            total += float(logsumexp(ll)) + math.log(cfg.fine_heading_step_deg)
            top = int(np.argmax(ll))
            best_headings.append(float(headings[top] % 360.0))
            if detail:
                for (index, binned, combo_by_heading), rel in zip(per_photo, group.relative_deg):
                    fits[index] = self._photo_fit(part, extra, known, binned, index, rel, float(headings[top]),
                                                  float(combo_by_heading[top, 0]), float(combo_by_heading[top, 1]))
        return (total, best_headings, fits) if detail else (total, best_headings)

    def _photo_fit(self, part, extra, known, binned, index, relative_deg, group_heading, bias, tilt):
        cfg = self.config
        photo = self.observations[index]
        az = group_heading + binned.offsets_deg
        model = self._at(part, part["elev"], az)
        base = base_variance(photo.angle_sigma_deg, cfg)
        more = self._at(part, extra, az)
        sigma = np.sqrt(base + more)
        seen = binned.weight > 0
        resid = np.where(seen, binned.elev - bias - tilt * np.sin(np.radians(binned.offsets_deg - relative_deg))
                         - model, np.nan)
        _, weight = fit_terms(np.nan_to_num(resid), base, more,
                              (self._at(part, known, az) > 0.999) * binned.weight, cfg)
        used = seen & (weight > 0) & (np.abs(np.where(seen, resid, 0.0)) <= 3.0 * sigma)
        return PhotoFit(id=photo.id, heading_deg=float((group_heading + relative_deg) % 360.0),
                        horizon_shift_deg=bias, az_offset_deg=binned.offsets_deg - relative_deg,
                        observed_elev_deg=np.where(seen, binned.elev, np.nan), model_elev_deg=model,
                        residual_deg=resid, distance_m=self._at(part, part["dist"], az),
                        sigma_deg=sigma, trust=weight, used=used,
                        photo_weight=float(binned.weight.sum()), bins_total=int(binned.n),
                        horizon_tilt_deg=tilt)

    # ------------------------------------------------------------ searching

    def evaluate(self, lat, lon, headings_deg, position_error_m):
        """Score one position without searching around it: a ModeFit with refined=False."""
        before = self.renders
        rendered = self.render(lat, lon, headings_deg)
        loglike, headings, fits = self.score(rendered, position_error_m, detail=True)
        return ModeFit(lat=float(lat), lon=float(lon), loglike=loglike, headings_deg=headings,
                       spread_m=float("nan"), photos=fits, renders=self.renders - before, refined=False)

    def refine(self, lat, lon, headings_deg):
        """Pattern search around (lat, lon). Returns the ModeFit of the best position found,
        or None if the start is off the terrain."""
        cfg = self.config
        before = self.renders
        cache = {}       # (east, north) offset from the start -> (rendered, spacing when added)
        origin = (float(lat), float(lon))

        def rendered_at(point, spacing, headings):
            if point not in cache:
                p_lat, p_lon = geo.local_to_latlon(point[0], point[1], origin=origin)
                cache[point] = (self.render(float(p_lat), float(p_lon), headings), spacing)
            return cache[point][0]

        centre = (0.0, 0.0)
        headings = list(headings_deg)
        spacing = cfg.fine_start_m
        if rendered_at(centre, spacing, headings) is None:
            return None
        for _ in range(cfg.fine_levels):
            error = cfg.position_factor * spacing
            best = (self.score(cache[centre][0], error), centre)
            for i in (-1, 0, 1):
                for j in (-1, 0, 1):
                    point = (round(centre[0] + i * spacing, 3), round(centre[1] + j * spacing, 3))
                    if point == centre:
                        continue
                    result = self.score(rendered_at(point, spacing, headings), error)
                    if result[0] > best[0][0]:
                        best = (result, point)
            (_, headings), centre = best
            last = spacing
            spacing /= 2.0

        # Everything visited, scored alike at the final spacing: the size of the peak.
        error = cfg.position_factor * last
        points = [p for p, (r, _) in cache.items() if r is not None]
        scores = np.array([self.score(cache[p][0], error)[0] for p in points])
        area = np.array([cache[p][1] ** 2 for p in points])
        top = float(scores.max())
        centre = points[int(np.argmax(scores))]
        weight = np.exp(scores - top) * area
        offset_sq = np.array([(p[0] - centre[0]) ** 2 + (p[1] - centre[1]) ** 2 for p in points])
        spread = math.sqrt(float((weight * offset_sq).sum() / (2.0 * weight.sum())))

        loglike, headings, fits = self.score(cache[centre][0], error, detail=True)
        best_lat, best_lon = geo.local_to_latlon(centre[0], centre[1], origin=origin)
        return ModeFit(lat=float(best_lat), lon=float(best_lon), loglike=loglike, headings_deg=headings,
                       spread_m=max(spread, 0.5 * last), photos=fits, renders=self.renders - before)

