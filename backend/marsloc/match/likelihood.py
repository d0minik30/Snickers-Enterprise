"""From log-likelihoods to a likelihood map, separate places and an honest uncertainty.

A crater rim looks similar from many places, so the answer is never just the best point.
The likelihood over the candidate grid is split into separate places ("modes"): groups of
cells around a peak. Each mode's share of the total likelihood says how much it competes.
"""
import math
from dataclasses import dataclass

import numpy as np

from ..constants import MARS_RADIUS_M


def posterior(loglike):
    """Share of the total likelihood per candidate: exp(loglike), normalized to sum 1.
    Candidates at -inf (not searched) get 0."""
    loglike = np.asarray(loglike, dtype=np.float64)
    top = np.max(loglike)
    if not np.isfinite(top):
        raise ValueError("no candidate has a likelihood")
    share = np.exp(loglike - top)
    return share / share.sum()


@dataclass
class Mode:
    peak: int             # candidate number of the mode's best cell
    mass: float           # the mode's share of the total likelihood
    cells: np.ndarray     # candidate numbers that belong to it


def find_modes(grid, share, separation_m, max_modes, floor=1e-6):
    """Split the likelihood map into modes, most likely first.

    Cells are taken from the most to the least likely. A cell within separation_m of an
    existing peak joins the nearest one; otherwise it starts a new mode (up to max_modes;
    cells beyond that, and cells below floor x the best, belong to no mode).
    """
    share = np.asarray(share, dtype=np.float64)
    cells = np.flatnonzero(share > floor * share.max())
    cells = cells[np.argsort(-share[cells], kind="stable")]
    lat, lon = grid.latlon(cells)
    mid = math.radians(grid.lat_max - grid.rows * grid.dlat / 2)
    x = np.radians(lon) * math.cos(mid) * MARS_RADIUS_M      # flat metres: fine between cells
    y = np.radians(lat) * MARS_RADIUS_M

    peak_xy, members = [], []
    for i in range(cells.size):
        if peak_xy:
            d = np.hypot(np.array([p[0] for p in peak_xy]) - x[i], np.array([p[1] for p in peak_xy]) - y[i])
            nearest = int(np.argmin(d))
            if d[nearest] < separation_m:
                members[nearest].append(i)
                continue
        if len(peak_xy) < max_modes:
            peak_xy.append((x[i], y[i]))
            members.append([i])
    modes = [Mode(peak=int(cells[m[0]]), mass=float(share[cells[m]].sum()), cells=cells[m]) for m in members]
    modes.sort(key=lambda mode: -mode.mass)
    return modes


def radius_for_mass(fraction, peak_share, peak_spread_m, other_dist_m, other_share):
    """Radius of the circle around the best position that holds `fraction` of the likelihood.

    The best mode is a round Gaussian peak of rms size peak_spread_m (per axis) holding
    peak_share; everything else is point masses other_share at distances other_dist_m. When
    the best mode holds less than `fraction`, the circle has to reach the look-alike places,
    so the radius jumps to their distance: that is the honest answer.
    """
    other_dist_m = np.asarray(other_dist_m, dtype=np.float64)
    other_share = np.asarray(other_share, dtype=np.float64)
    spread = max(float(peak_spread_m), 1e-6)

    def inside(radius):
        peak = peak_share * (1.0 - math.exp(-0.5 * (radius / spread) ** 2))
        return peak + float(other_share[other_dist_m <= radius].sum())

    high = (float(other_dist_m.max()) if other_dist_m.size else 0.0) + 8.0 * spread
    if inside(high) < fraction:      # shares that don't add up to 1: all of it is the best we can say
        return high
    low = 0.0
    for _ in range(60):
        mid = 0.5 * (low + high)
        if inside(mid) >= fraction:
            high = mid
        else:
            low = mid
    return high
