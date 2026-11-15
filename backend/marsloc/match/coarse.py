"""Coarse search: every candidate of the precomputed horizons against the photos.

Heading is unknown, so each photo is slid around each candidate's full-circle horizon. Doing
that at full detail for every candidate and every heading costs billions of operations, so it
runs in two passes:

1. Prefilter, all candidates. Horizons and photos are averaged into wide bins (2 deg) and
   compared at every heading with a cheap robust cost. Only the best share of the candidates,
   each with its few best headings, goes on. This pass only screens: it is generous on purpose.
2. Likelihood, the survivors, at the stored bin width (0.5 deg), for headings around the ones
   the prefilter found.

The candidates are 200 m apart, so the true position is up to 140 m from the nearest one, and
from there every skyline feature sits a little to the side and a little higher or lower
(parallax). Those shifts are not independent noise: they all follow from one unknown, the
offset between the candidate and the true position. So pass 2 solves for it. The stored
distance and slope of each horizon bin say how the bin changes per metre moved east or north;
a small least-squares fit finds the offset (and the heading within its bin, and each photo's
up/down shift) that best explains the photo, and the fit is scored on what is left.

The index convention everywhere: at heading index s, the bin at group azimuth j * step is
compared with horizon bin (s + j), so the group's heading is s * step (plus phase_deg in the
prefilter, whose wide bins are centred between stored bins).
"""
import math

import numpy as np

from .score import (base_variance, extra_variance, fit_terms, heading_penalty, logsumexp, score_sum)

_CHUNK = 1024


class CoarseIndex:
    """The precomputed horizons prepared for searching. Built once per store."""

    def __init__(self, store, config):
        self.store = store
        self.config = config
        self.step_deg = store.az_step_deg
        self.n_az = store.n_az
        pool = config.prefilter_pool
        if pool < 1 or self.n_az % pool:
            raise ValueError("prefilter_pool must divide the %d azimuth bins" % self.n_az)
        self.pool = pool
        self.step1_deg = self.step_deg * pool
        self.n1 = self.n_az // pool
        self.phase_deg = 0.5 * (pool - 1) * self.step_deg     # centre of wide bin 0
        self.spacing_m = float(store.meta["spacing_m"])
        self.position_error_m = config.position_factor * self.spacing_m
        az = np.radians(np.arange(self.n_az) * self.step_deg)
        self._sin_az, self._cos_az = np.sin(az), np.cos(az)

        n = store.grid.n
        self.mean1 = np.zeros((n, self.n1), dtype=np.float32)   # horizon in wide bins
        self.extra1 = np.zeros((n, self.n1), dtype=np.float32)  # what it can be off by (variance)
        self.known1 = np.zeros((n, self.n1), dtype=np.float32)  # share of the wide bin that has a horizon
        for start in range(0, n, 2048):
            rows = slice(start, min(n, start + 2048))
            h = self.horizons(rows, self.position_error_m, self.step1_deg / math.sqrt(12.0))
            wide = h["elev"].reshape(-1, self.n1, pool)
            self.mean1[rows] = wide.mean(axis=2)
            self.extra1[rows] = h["extra"].reshape(-1, self.n1, pool).mean(axis=2) + wide.var(axis=2)
            self.known1[rows] = h["known"].reshape(-1, self.n1, pool).mean(axis=2)

    def horizons(self, rows, position_error_m, heading_error_deg, jacobian=False):
        """The stored horizons of the given candidates as float32 [rows, n_az] arrays:

        elev   the horizon (0 where there is none)
        known  1 where there is one
        extra  variance of what it can be off by for that position and heading error
        With jacobian=True also, per bin, how the horizon changes when the camera moves or turns:
        d_east, d_north  degrees per metre moved east / north
        slope            degrees per degree turned clockwise
        linear           0..1: how far that first-order description can be trusted
        """
        cfg = self.config
        elev = self.store.elev_deg(rows)
        dist = self.store.dist_m(rows)
        known = np.isfinite(elev) & np.isfinite(dist)
        elev = np.where(known, elev, 0.0).astype(np.float64)
        dist = np.where(known, dist, 1e9).astype(np.float64)
        extra = extra_variance(elev, dist, self.step_deg, position_error_m, heading_error_deg, cfg,
                               circular=True)
        out = {"elev": elev.astype(np.float32), "known": known.astype(np.float32),
               "extra": np.where(known, extra, 0.0).astype(np.float32)}
        if jacobian:
            slope = (np.roll(elev, -1, axis=1) - np.roll(elev, 1, axis=1)) / (2.0 * self.step_deg)
            # Moving the camera by `across` metres to the right of a feature's direction makes the
            # feature appear across / dist radians further left: the profile slides left, so the
            # horizon at a fixed azimuth changes by slope * degrees(across / dist). Moving `toward`
            # metres closer raises the feature's elevation angle by elev * toward / dist.
            per_m = np.degrees(1.0 / dist)
            out["d_east"] = (slope * per_m * self._cos_az + elev / dist * self._sin_az).astype(np.float32)
            out["d_north"] = (-slope * per_m * self._sin_az + elev / dist * self._cos_az).astype(np.float32)
            out["slope"] = slope.astype(np.float32)
            out["linear"] = (known / (1.0 + (cfg.linear_distance_m / dist) ** 2)).astype(np.float32)
        return out

    # ------------------------------------------------------------ pass 1

    def prefilter_cost(self, rows, binned, base_var, horizon_uncertainty_deg):
        """Cost of one photo for every candidate in rows and every heading index: float32
        [len(rows), n1], lower is better.

        Per wide bin: the squared miss in tolerances, capped, plus log(tolerance): a horizon
        that tolerates a lot is worth less when it fits. This is only a screen; pass 2 scores
        on fit alone. binned: the photo in bins of step1_deg, in its group's frame. Column t is
        the group heading t * step1_deg + phase_deg.
        """
        mean = self.mean1 if rows is None else self.mean1[rows]
        total = (self.extra1 if rows is None else self.extra1[rows]) + np.float32(base_var)
        known = self.known1 if rows is None else self.known1[rows]
        gain = np.sqrt(known / total)                       # residual x gain = z (0 without a horizon)
        norm = known * np.log(total / np.float32(base_var))
        cap = np.float32(self.config.outlier_z ** 2)

        k = binned.n
        obs = binned.elev.astype(np.float32)
        weight = binned.weight.astype(np.float32)
        n = mean.shape[0]
        out = np.empty((n, self.n1), dtype=np.float32)
        for start in range(0, n, _CHUNK):
            stop = min(n, start + _CHUNK)
            wrap = lambda a: np.concatenate([a[start:stop], a[start:stop, :k]], axis=1)
            mean_w, gain_w, norm_w = wrap(mean), wrap(gain), wrap(norm)
            for t in range(self.n1):
                resid = obs - mean_w[:, t:t + k]
                g = gain_w[:, t:t + k]
                if horizon_uncertainty_deg > 0:
                    precision = g * g
                    shift = (resid * precision) @ weight / np.maximum(precision @ weight, 1e-12)
                    resid -= np.clip(shift, -horizon_uncertainty_deg, horizon_uncertainty_deg)[:, None]
                z = resid * g
                z *= z
                np.minimum(z, cap, out=z)
                out[start:stop, t] = z @ weight + norm_w[:, t:t + k] @ weight
        # Above, column t' compared photo bin j with horizon bin t' + j. The photo's first bin
        # sits at group azimuth k0 * step, so group heading index t is column t + k0.
        return np.roll(out, -binned.k0, axis=1)

    def prefilter(self, rows, groups_binned, groups_meta, groups_priors, temper):
        """Rank candidates by the cheap cost.

        groups_binned: per group, its photos in bins of step1_deg. groups_meta: per group,
        [(angle_sigma_deg, horizon_uncertainty_deg)] per photo. groups_priors: per group,
        heading hints [(heading, sigma)]. temper: factor on the photo cost (bins err together).
        Returns (score [n], per group the cost [n, n1]); lower is better.
        """
        total = None
        per_group = []
        headings = np.arange(self.n1) * self.step1_deg + self.phase_deg
        for binned_list, meta, priors in zip(groups_binned, groups_meta, groups_priors):
            cost = None
            for binned, (sigma, bias, *_) in zip(binned_list, meta):
                part = self.prefilter_cost(rows, binned, base_variance(sigma, self.config), bias)
                cost = part if cost is None else cost + part
            cost = temper * cost + heading_penalty(headings, priors).astype(np.float32)[None, :]
            per_group.append(cost)
            best = cost.min(axis=1)
            total = best if total is None else total + best
        return total, per_group

    # ------------------------------------------------------------ pass 2

    def _group_scores(self, h, fitted, binned_list, meta, shifts):
        """Score of a group of photos for some candidates at some heading indices.

        h: horizons(..., jacobian=True) of the candidates. fitted: the extra variance that
        remains after the offset fit. meta: per photo (angle sigma, horizon uncertainty, roll
        uncertainty, heading relative to the group). shifts: int [m, S]. Returns (score [m, S],
        heading correction in degrees [m, S]).
        """
        cfg = self.config
        m, n_shifts = shifts.shape
        row = np.arange(m)[:, None, None]
        n_par = 3 + 2 * len(binned_list)       # east, north, heading; per photo an up/down shift and a tilt
        loose = [v for _, bias, roll, _ in meta for v in (max(bias, 1e-4), max(roll, 1e-4))]
        prior = np.array([cfg.coarse_offset_m, cfg.coarse_offset_m, self.step_deg / math.sqrt(12.0)]
                         + loose) ** -2.0
        normal = np.zeros((m, n_shifts, n_par, n_par))
        normal[:, :, np.arange(n_par), np.arange(n_par)] = prior
        rhs = np.zeros((m, n_shifts, n_par))

        gathered = []
        for p, (binned, (sigma, _, _, relative)) in enumerate(zip(binned_list, meta)):
            index = np.mod(shifts[:, :, None] + (binned.k0 + np.arange(binned.n))[None, None, :], self.n_az)
            base = np.float32(base_variance(sigma, cfg))
            photo_weight = binned.weight.astype(np.float32)
            resid = binned.elev.astype(np.float32) - h["elev"][row, index]
            weight = h["known"][row, index] * photo_weight
            # How much each bin may steer the offset fit: not if it looks like an outlier even with
            # the full coarse tolerance, and not if it is too close for a first-order description.
            z2 = resid * resid / (base + h["extra"][row, index])
            keep = np.exp(-0.5 * z2)
            steer = weight * h["linear"][row, index] * keep / (keep + np.float32(cfg.outlier_floor)) \
                / (base + fitted[row, index])
            tilt = np.sin(np.radians(binned.offsets_deg - relative)).astype(np.float32)[None, None, :]
            columns = [h["d_east"][row, index], h["d_north"][row, index], h["slope"][row, index],
                       np.float32(1.0), tilt]
            where = [0, 1, 2, 3 + 2 * p, 4 + 2 * p]
            for a in range(5):
                weighted = steer * columns[a]
                rhs[:, :, where[a]] += (weighted * resid).sum(axis=2, dtype=np.float64)
                for b in range(a, 5):
                    value = (weighted * columns[b]).sum(axis=2, dtype=np.float64)
                    normal[:, :, where[a], where[b]] += value
                    if b != a:
                        normal[:, :, where[b], where[a]] += value
            gathered.append((resid, weight, columns, base, fitted[row, index]))

        theta = np.linalg.solve(normal, rhs[..., None])[..., 0]
        limit = np.array([2.0 * cfg.coarse_offset_m, 2.0 * cfg.coarse_offset_m, self.step_deg]
                         + [v for _, bias, roll, _ in meta for v in (max(bias, 0.0), max(roll, 0.0))])
        theta = np.clip(theta, -limit, limit)

        score = np.zeros((m, n_shifts))
        for p, (resid, weight, columns, base, more) in enumerate(gathered):
            left = resid - (columns[0] * theta[:, :, 0, None] + columns[1] * theta[:, :, 1, None]
                            + columns[2] * theta[:, :, 2, None] + theta[:, :, 3 + 2 * p, None]
                            + columns[4] * theta[:, :, 4 + 2 * p, None]).astype(np.float32)
            fit, counts = fit_terms(left, base, more, weight, cfg)
            score += score_sum(fit, counts, weight, cfg, axis=2)
        return score, theta[:, :, 2]

    def likelihood(self, rows, groups_binned, groups_meta, groups_priors, groups_centres, temper):
        """Log-likelihood of each candidate in rows, with heading summed out.

        groups_centres: per group, int [len(rows), C]: heading indices (in stored bins) to
        search around; every index within half a wide bin of one is tried.
        Returns (loglike [n], per group the best heading in degrees [n]).
        """
        cfg = self.config
        heading_error = self.step_deg / math.sqrt(12.0)
        reach = max(1, self.pool // 2 + 1)
        window = np.arange(-reach, reach + 1)
        n = len(rows)
        total = np.zeros(n)
        headings = [np.zeros(n) for _ in groups_binned]
        for start in range(0, n, 192):
            part = rows[start:start + 192]
            h = self.horizons(part, self.position_error_m, heading_error, jacobian=True)
            fitted = np.where(h["known"] > 0, extra_variance(
                h["elev"], np.where(h["known"] > 0, self.store.dist_m(part), 1e9), self.step_deg,
                cfg.coarse_fit_error_m, 0.0, cfg, circular=True), 0.0).astype(np.float32)
            for g, (binned_list, meta, priors, centres) in enumerate(
                    zip(groups_binned, groups_meta, groups_priors, groups_centres)):
                shifts = np.mod(centres[start:start + 192, :, None] + window[None, None, :], self.n_az)
                shifts = np.sort(shifts.reshape(len(part), -1), axis=1)
                repeat = np.zeros(shifts.shape, dtype=bool)
                repeat[:, 1:] = shifts[:, 1:] == shifts[:, :-1]      # overlapping windows: count once
                score, turn = self._group_scores(h, fitted, binned_list, meta, shifts)
                heading = shifts * self.step_deg + turn
                ll = temper * score - 0.5 * heading_penalty(heading, priors)
                ll[repeat] = -np.inf
                total[start:start + 192] += logsumexp(ll, axis=1) + math.log(self.step_deg)
                top = np.argmax(ll, axis=1)[:, None]
                headings[g][start:start + 192] = np.mod(np.take_along_axis(heading, top, axis=1)[:, 0], 360.0)
        return total, headings


def best_shifts(cost, count):
    """The `count` lowest-cost heading indices of each row, no two of them neighbours.
    cost: [n, n1]. Returns int [n, count]."""
    cost = cost.copy()
    n, n1 = cost.shape
    out = np.empty((n, count), dtype=np.int64)
    rows = np.arange(n)
    for k in range(count):
        pick = np.argmin(cost, axis=1)
        out[:, k] = pick
        for d in (-1, 0, 1):
            cost[rows, np.mod(pick + d, n1)] = np.inf
    return out
