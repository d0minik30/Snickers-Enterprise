"""Coarse search: every candidate of the precomputed horizons against the photos.

Heading is unknown, so each photo is slid around each candidate's full-circle horizon. Doing
that at full detail for every candidate and every heading costs billions of operations, so it
runs in two passes:

1. Prefilter, all candidates. Horizons and photos are averaged into wide bins (2 deg) and
   compared at every heading with a cheap robust cost (a capped squared error). Only the best
   share of the candidates, each with its few best headings, goes on.
2. Likelihood, the survivors. The full per-bin likelihood of score.py at the stored bin width
   (0.5 deg), for headings around the ones the prefilter found.

The index convention everywhere: at heading index s, the bin at group azimuth j * step is
compared with horizon bin (s + j), so the group's heading is s * step (plus phase_deg in the
prefilter, whose wide bins are centred between stored bins).
"""
import math

import numpy as np

from .score import (bias_grid, heading_penalty, loglike_terms, logsumexp, model_variance, reliability,
                    trusted_variance)

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
        self.position_error_m = config.position_factor * float(store.meta["spacing_m"])

        n = store.grid.n
        self.mean1 = np.zeros((n, self.n1), dtype=np.float32)   # horizon in wide bins
        self.var1 = np.ones((n, self.n1), dtype=np.float32)     # what it can be off by
        self.trust1 = np.zeros((n, self.n1), dtype=np.float32)  # 0..1
        for start in range(0, n, 2048):
            rows = slice(start, min(n, start + 2048))
            elev, trust, var = self.horizons(rows, heading_error_deg=self.step1_deg / math.sqrt(12.0))
            wide = elev.reshape(-1, self.n1, pool)
            self.mean1[rows] = wide.mean(axis=2)
            self.var1[rows] = var.reshape(-1, self.n1, pool).mean(axis=2) + wide.var(axis=2)
            self.trust1[rows] = trust.reshape(-1, self.n1, pool).mean(axis=2)

    def horizons(self, rows, heading_error_deg):
        """(elev, trust, var) as float32 [rows, n_az] for the given candidates: the stored
        horizon (0 where there is none), how far each bin is trusted (0 where there is none)
        and the variance of what it can be off by."""
        elev = self.store.elev_deg(rows)
        dist = self.store.dist_m(rows)
        known = np.isfinite(elev) & np.isfinite(dist)
        elev = np.where(known, elev, 0.0)
        trust = np.where(known, reliability(dist, self.config), 0.0)
        var = model_variance(elev, np.where(known, dist, 1e9), self.step_deg, self.position_error_m,
                             heading_error_deg, self.config, circular=True)
        return (elev.astype(np.float32), trust.astype(np.float32),
                np.where(known, var, 1.0).astype(np.float32))

    # ------------------------------------------------------------ pass 1

    def prefilter_cost(self, rows, binned, sigma_deg, horizon_uncertainty_deg):
        """Cost of one photo for every candidate in rows and every heading index:
        float32 [len(rows), n1], about -2 x log-likelihood, lower is better.

        binned: the photo in bins of step1_deg, in its group's frame. Column t is the group
        heading t * step1_deg + phase_deg.
        """
        mean = self.mean1 if rows is None else self.mean1[rows]
        trust = self.trust1 if rows is None else self.trust1[rows]
        var, known = trusted_variance((self.var1 if rows is None else self.var1[rows])
                                      + np.float32(sigma_deg ** 2), trust)
        var = var.astype(np.float32)
        gain = np.where(known, 1.0 / np.sqrt(var), 0.0).astype(np.float32)   # residual x gain = z
        cap = np.where(known, np.float32(9.0), np.float32(0.0))   # never more than a 3-sigma miss
        norm = np.where(known, np.log(var), 0.0).astype(np.float32)  # broad predictions fit less sharply

        k = binned.n
        obs = binned.elev.astype(np.float32)
        weight = binned.weight.astype(np.float32)
        n = mean.shape[0]
        out = np.empty((n, self.n1), dtype=np.float32)
        for start in range(0, n, _CHUNK):
            stop = min(n, start + _CHUNK)
            wrap = lambda a: np.concatenate([a[start:stop], a[start:stop, :k]], axis=1)
            mean_w, gain_w, cap_w, norm_w = wrap(mean), wrap(gain), wrap(cap), wrap(norm)
            for t in range(self.n1):
                resid = obs - mean_w[:, t:t + k]
                g = gain_w[:, t:t + k]
                if horizon_uncertainty_deg > 0:
                    precision = g * g
                    shift = (resid * precision) @ weight / np.maximum(precision @ weight, 1e-12)
                    resid -= np.clip(shift, -horizon_uncertainty_deg, horizon_uncertainty_deg)[:, None]
                z = resid * g
                z *= z
                np.minimum(z, cap_w[:, t:t + k], out=z)
                out[start:stop, t] = z @ weight + norm_w[:, t:t + k] @ weight
        # Above, column t' compared photo bin j with horizon bin t' + j. The photo's first bin
        # sits at group azimuth k0 * step, so group heading index t is column t + k0.
        return np.roll(out, -binned.k0, axis=1)

    def prefilter(self, rows, groups_binned, groups_meta, groups_priors, temper):
        """Rank candidates by the cheap cost.

        groups_binned: per group, its photos in bins of step1_deg. groups_meta: per group,
        [(sigma_deg, horizon_uncertainty_deg)] per photo. groups_priors: per group, heading
        hints [(heading, sigma)]. temper: factor on the photo cost (bins err together).
        Returns (score [n], per group the cost [n, n1]); lower is better.
        """
        total = None
        per_group = []
        headings = np.arange(self.n1) * self.step1_deg + self.phase_deg
        for binned_list, meta, priors in zip(groups_binned, groups_meta, groups_priors):
            cost = None
            for binned, (sigma, bias) in zip(binned_list, meta):
                part = self.prefilter_cost(rows, binned, sigma, bias)
                cost = part if cost is None else cost + part
            cost = temper * cost + heading_penalty(headings, priors).astype(np.float32)[None, :]
            per_group.append(cost)
            best = cost.min(axis=1)
            total = best if total is None else total + best
        return total, per_group

    # ------------------------------------------------------------ pass 2

    def photo_loglike(self, elev, trust, var, binned, sigma_deg, horizon_uncertainty_deg, shifts):
        """Log-likelihood of one photo: float64 [candidates, shifts].

        elev, trust, var: from horizons() for the candidates. binned: the photo in bins of
        step_deg in its group's frame. shifts: int [candidates, S], group heading indices.
        A photo whose horizontal may be off gets the best constant shift within its limit.
        """
        cfg = self.config
        n, n_shifts = shifts.shape
        out = np.empty((n, n_shifts))
        obs = binned.elev.astype(np.float32)
        inlier_obs = (binned.weight * (1.0 - cfg.outlier_fraction)).astype(np.float32)
        steps = (binned.k0 + np.arange(binned.n))[None, None, :]
        biases = bias_grid(horizon_uncertainty_deg, sigma_deg, per_sigma=1.0, limit=9)
        for start in range(0, n, 256):
            stop = min(n, start + 256)
            index = np.mod(shifts[start:stop, :, None] + steps, self.n_az)
            row = np.arange(start, stop)[:, None, None]
            total_var, known = trusted_variance(var[row, index] + np.float32(sigma_deg ** 2),
                                                trust[row, index])
            inlier = known * inlier_obs
            base = obs - elev[row, index]
            best = None
            for bias in biases:
                ll = loglike_terms(base - np.float32(bias), total_var, inlier, cfg).sum(axis=2, dtype=np.float64)
                best = ll if best is None else np.maximum(best, ll)
            out[start:stop] = best
        return out

    def likelihood(self, rows, groups_binned, groups_meta, groups_priors, groups_centres, temper):
        """Log-likelihood of each candidate in rows, with heading summed out.

        groups_centres: per group, int [len(rows), C]: heading indices (in stored bins) to
        search around; every index within half a wide bin of one is tried.
        Returns (loglike [n], per group the best heading in degrees [n]).
        """
        elev, trust, var = self.horizons(rows, heading_error_deg=self.step_deg / math.sqrt(12.0))
        reach = max(1, self.pool // 2 + 1)
        window = np.arange(-reach, reach + 1)
        total = np.zeros(len(rows))
        headings = []
        for binned_list, meta, priors, centres in zip(groups_binned, groups_meta, groups_priors,
                                                      groups_centres):
            shifts = np.mod(centres[:, :, None] + window[None, None, :], self.n_az)
            shifts = np.sort(shifts.reshape(len(rows), -1), axis=1)
            repeat = np.zeros(shifts.shape, dtype=bool)
            repeat[:, 1:] = shifts[:, 1:] == shifts[:, :-1]      # overlapping windows: count once
            ll = np.zeros(shifts.shape)
            for binned, (sigma, bias) in zip(binned_list, meta):
                ll += self.photo_loglike(elev, trust, var, binned, sigma, bias, shifts)
            ll = temper * ll - 0.5 * heading_penalty(shifts * self.step_deg, priors)
            ll[repeat] = -np.inf
            total += logsumexp(ll, axis=1) + math.log(self.step_deg)
            headings.append(np.take_along_axis(shifts, np.argmax(ll, axis=1)[:, None], axis=1)[:, 0]
                            * self.step_deg)
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
