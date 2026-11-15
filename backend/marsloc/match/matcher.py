"""The matcher: photos in, position, heading, look-alike places and uncertainty out.

Stages (each explained in its module):
1. coarse.py, pass 1: a cheap cost of every candidate of the precomputed horizons at every
   heading; keeps the best share.
2. coarse.py, pass 2: the full likelihood of the survivors. This gives the likelihood map.
3. likelihood.py: the map is split into separate places (modes).
4. fine.py: the most likely modes are refined with live rendering, well below the 200 m grid.
5. The refined fits decide how the likelihood is shared among the refined modes: a
   look-alike place that fits at 200 m but not at 12 m loses its share here.
"""
import math
import time
from dataclasses import dataclass, field

import numpy as np

from .. import geo
from .coarse import CoarseIndex, best_shifts
from .fine import FineSearch
from .likelihood import find_modes, posterior, radius_for_mass
from .resample import bin_group, make_groups
from .score import MatcherConfig


@dataclass
class Candidate:
    rank: int
    lat: float
    lon: float
    east_m: float               # metres east / north of the landing site
    north_m: float
    ground_m: float             # terrain height there
    heading_deg: float          # direction the first photo faced, clockwise from north
    probability: float          # this place's share of the total likelihood
    score: float                # share of the trusted skyline that fits within 3 sigma
    spread_m: float             # rms size of the likelihood peak (NaN if not refined)
    refined: bool               # improved by the fine search
    photos: list = field(default_factory=list)   # fine.PhotoFit per photo
    fit_z: float = float("nan")     # how far the trusted skyline misses, in tolerances (rms); about 1 is a true match
    support: float = 0.0        # share of the usable skyline that is informative at this position
    coverage: float = 0.0       # share of the photos' field of view with a usable skyline


@dataclass
class MatchResult:
    status: str                 # "ok", "ambiguous" or "no_match"
    warnings: list
    best: Candidate
    candidates: list            # most likely first; candidates[0] is best
    uncertainty_m: float        # radius around best that holds 68 % of the likelihood
    uncertainty_95_m: float     # ... and 95 %
    likelihood: np.ndarray      # float32 [grid.rows, grid.cols], relative to the best cell (0..1)
    grid: object                # horizon.store.CandidateGrid of the likelihood
    timing_ms: dict
    stats: dict                 # candidates searched, kept, renders, ...


class Matcher:
    """Finds where photos were taken. Build once (it prepares the precomputed horizons),
    then call locate() per request."""

    def __init__(self, terrain, store, config=MatcherConfig()):
        if not store.matches(terrain):
            raise ValueError("The precomputed horizons in %s were built from different terrain. "
                             "Rebuild them with scripts/build_horizons.py." % store.directory)
        self.terrain = terrain
        self.store = store
        self.config = config
        self.coarse = CoarseIndex(store, config)

    def locate(self, observations, prior=None, top_k=5):
        """Match photos taken from one position.

        observations: list of resample.PhotoObservation. prior: optional (lat, lon, radius_m):
        only candidates within radius_m of that point are searched. top_k: candidates returned.
        """
        cfg, store, coarse, grid = self.config, self.store, self.coarse, self.store.grid
        observations = list(observations)
        groups = make_groups(observations)
        warnings = _input_warnings(observations)
        clock = time.perf_counter()
        timing = {}

        def lap(name):
            nonlocal clock
            now = time.perf_counter()
            timing[name] = round(1000.0 * (now - clock), 1)
            clock = now

        # --- which candidates to search
        searched = store.valid.copy()
        if prior is not None:
            p_lat, p_lon, radius = prior
            c_lat, c_lon = grid.latlon(np.arange(grid.n))
            away = geo.distance_m(p_lat, p_lon, c_lat, c_lon)
            inside = searched & (away <= radius)
            if not inside.any():
                nearest = int(np.argmin(np.where(searched, away, np.inf)))
                inside[nearest] = True
                warnings.append("no candidate position within the prior radius of %.0f m: searched "
                                "the nearest one, %.0f m from the prior" % (radius, away[nearest]))
            searched = inside
        rows = np.flatnonzero(searched)
        if rows.size == 0:
            raise ValueError("the precomputed horizons hold no candidate position on the terrain")

        meta = [[(observations[i].angle_sigma_deg, observations[i].horizon_uncertainty_deg,
                  observations[i].roll_uncertainty_deg, rel)
                 for i, rel in zip(group.photos, group.relative_deg)] for group in groups]
        priors = [group.priors(observations) for group in groups]

        # --- pass 1: cheap cost, all candidates, all headings
        binned1 = [bin_group(observations, group, coarse.step1_deg) for group in groups]
        cost, cost_by_group = coarse.prefilter(None if rows.size == grid.n else rows, binned1, meta,
                                               priors, coarse.step1_deg / cfg.correlation_deg)
        n_keep = min(rows.size, max(cfg.prefilter_min_keep, math.ceil(cfg.prefilter_keep * rows.size)))
        keep = np.sort(np.argpartition(cost, n_keep - 1)[:n_keep]) if n_keep < rows.size \
            else np.arange(rows.size)
        kept_rows = rows[keep]
        to_stored = int(round(coarse.phase_deg / coarse.step_deg))
        centres = [best_shifts(c[keep], min(cfg.prefilter_headings, coarse.n1 // 3)) * coarse.pool + to_stored
                   for c in cost_by_group]
        lap("prefilter")

        # --- pass 2: full likelihood of the survivors
        binned2 = [bin_group(observations, group, coarse.step_deg) for group in groups]
        loglike_kept, headings_kept = coarse.likelihood(kept_rows, binned2, meta, priors, centres,
                                                        coarse.step_deg / cfg.correlation_deg)
        loglike = np.full(grid.n, -np.inf)
        loglike[kept_rows] = loglike_kept
        share = posterior(loglike)
        modes = find_modes(grid, share, cfg.mode_separation_m, cfg.max_modes)
        lap("likelihood")

        # --- fine search on the most likely modes
        fine = FineSearch(self.terrain, cfg, observations, groups)
        wanted = max(top_k, 1)
        fits = []            # (mode, ModeFit)
        for k, mode in enumerate(modes[:max(wanted, cfg.fine_modes)]):
            at = int(np.searchsorted(kept_rows, mode.peak))
            lat, lon = (float(v) for v in grid.latlon(mode.peak))
            headings = [float(h[at]) for h in headings_kept]
            fit = None
            if k < cfg.fine_modes and (k == 0 or mode.mass >= cfg.fine_min_probability):
                fit = fine.refine(lat, lon, headings)
            elif k < wanted:
                fit = fine.evaluate(lat, lon, headings, coarse.position_error_m)
            if fit is not None and np.isfinite(fit.loglike):
                fits.append((mode, fit))
        lap("fine")

        # --- share the likelihood among the refined modes by how well they fit when refined
        refined = [(mode, fit) for mode, fit in fits if fit.refined]
        final_share = {id(mode): mode.mass for mode, _ in fits}
        if refined:
            pool_share = sum(mode.mass for mode, _ in refined)
            evidence = np.array([fit.loglike + math.log(2.0 * math.pi * fit.spread_m ** 2)
                                 for _, fit in refined])
            weights = np.exp(evidence - evidence.max())
            for (mode, _), w in zip(refined, weights / weights.sum()):
                final_share[id(mode)] = pool_share * float(w)
        adjusted = share.copy()
        for mode, _ in refined:
            if mode.mass > 0:
                adjusted[mode.cells] *= final_share[id(mode)] / mode.mass

        fits.sort(key=lambda pair: -final_share[id(pair[0])])
        if not fits:
            raise ValueError("no candidate position could be scored")
        candidates = [self._candidate(rank, fit, final_share[id(mode)])
                      for rank, (mode, fit) in enumerate(fits[:wanted], start=1)]
        best_mode, best_fit = fits[0]
        best = candidates[0]

        status = verdict(best, candidates, cfg)

        # --- uncertainty: how big a circle around best holds 68 % / 95 % of the likelihood
        def circles(mode_share, cell_share):
            """(radius68, radius95) with the given share per refined mode and per grid cell."""
            others = np.ones(grid.n, dtype=bool)
            other_dist, other_share = [], []
            for mode, fit in refined:
                others[mode.cells] = False
                if mode is not best_mode:
                    other_dist.append(float(geo.distance_m(best.lat, best.lon, fit.lat, fit.lon)))
                    other_share.append(mode_share[id(mode)])
            if best_fit.refined:
                # A fit worse than the noise settings promise means the noise is bigger than
                # assumed: widen the peak by the same factor.
                stretch = max(1.0, best.fit_z / cfg.expected_fit_z) if np.isfinite(best.fit_z) else 1.0
                peak_share, peak_spread, pad = mode_share[id(best_mode)], best.spread_m * stretch, 0.0
            else:                   # no refinement: the grid cells are all there is
                peak_share, peak_spread = 0.0, 1.0
                pad = 0.5 * math.hypot(*grid.cell_size_m.values())
            cells = np.flatnonzero(others & (cell_share > 0))
            c_lat, c_lon = grid.latlon(cells)
            dist = np.concatenate([other_dist, geo.distance_m(best.lat, best.lon, c_lat, c_lon)])
            mass = np.concatenate([other_share, cell_share[cells]])
            return (radius_for_mass(0.68, peak_share, peak_spread, dist, mass) + pad,
                    radius_for_mass(0.95, peak_share, peak_spread, dist, mass) + pad)

        radius68, radius95 = circles(final_share, adjusted)
        if status != "ok":
            # The refined fit decided how the likelihood is shared, but that fit is not good
            # enough to be trusted with it: don't let it shrink the circles below what the
            # coarse map says.
            coarse68, coarse95 = circles({id(mode): mode.mass for mode, _ in fits}, share)
            radius68, radius95 = max(radius68, coarse68), max(radius95, coarse95)

        if status == "no_match":
            warnings.append("the best place fits poorly (%.0f %% of the usable skyline within tolerance, "
                            "missing by %.1f tolerances): do not trust it" % (100 * best.score, best.fit_z))
        for fit, photo in zip(best.photos, observations):
            limit = photo.horizon_uncertainty_deg
            if limit > 0 and abs(fit.horizon_shift_deg) >= 0.999 * limit:
                warnings.append("%s: the fitted up/down shift is at its limit (%+.2f deg): the photo's "
                                "horizontal may be further off than horizon_uncertainty_deg says"
                                % (photo.id, fit.horizon_shift_deg))
        if best.coverage < cfg.min_coverage:
            warnings.append("only %.0f %% of the photos' field of view has a usable skyline"
                            % (100 * best.coverage))
        lap("summary")
        timing["total"] = round(sum(timing.values()), 1)
        relative = (adjusted / adjusted.max()).astype(np.float32).reshape(grid.rows, grid.cols)
        return MatchResult(
            status=status, warnings=warnings, best=best, candidates=candidates,
            uncertainty_m=float(radius68), uncertainty_95_m=float(radius95), likelihood=relative,
            grid=grid, timing_ms=timing,
            stats={"candidates_searched": int(rows.size), "candidates_kept": int(kept_rows.size),
                   "modes": len(modes), "modes_refined": len(refined), "renders": fine.renders,
                   "groups": len(groups)})

    def _candidate(self, rank, fit, probability):
        east, north = geo.latlon_to_local(fit.lat, fit.lon)
        trust = np.array([p.trust.sum() for p in fit.photos])
        fraction = np.array([p.inlier_fraction for p in fit.photos])
        score = float((trust * fraction).sum() / trust.sum()) if trust.sum() > 0 else 0.0
        z = np.array([p.fit_z if np.isfinite(p.fit_z) else 0.0 for p in fit.photos])
        fit_z = float(np.sqrt((trust * z * z).sum() / trust.sum())) if trust.sum() > 0 else float("nan")
        usable = sum(p.photo_weight for p in fit.photos)
        bins = sum(p.bins_total for p in fit.photos)
        return Candidate(rank=rank, lat=fit.lat, lon=fit.lon, east_m=float(east), north_m=float(north),
                         ground_m=float(self.terrain.height(fit.lat, fit.lon)),
                         heading_deg=fit.photos[0].heading_deg, probability=float(probability),
                         score=score, spread_m=float(fit.spread_m), refined=fit.refined,
                         photos=fit.photos, fit_z=fit_z,
                         support=float(trust.sum() / usable) if usable > 0 else 0.0,
                         coverage=float(usable / bins) if bins else 0.0)


def verdict(best, candidates, config):
    """"ok", "ambiguous" or "no_match" for the best candidate.

    no_match: the best place does not fit: too little of the usable skyline is within
    tolerance, or it misses by too much, or too little of it can be judged at all.
    ambiguous: it isn't clearly the place: its share of the likelihood is low, another separate
    place holds a real share, the fit is only fair, part of the skyline can't be judged there,
    or under half of the photos' field of view has a usable skyline.
    ok: none of the above.
    """
    if (best.score < config.no_match_below or not best.fit_z <= config.no_match_fit_z
            or best.support < config.min_support):
        return "no_match"
    rival = max((c.probability for c in candidates[1:]), default=0.0)
    if (best.probability < config.ambiguous_below or rival > 0.5 * best.probability
            or best.fit_z > config.ok_fit_z or best.support < config.ok_support
            or best.coverage < config.min_coverage):
        return "ambiguous"
    return "ok"


def _input_warnings(observations):
    """Plain-English warnings about the photos themselves."""
    warnings = []
    for photo in observations:
        trusted = photo.weight > 0
        if trusted.mean() < 0.5:
            warnings.append("%s: %.0f %% of the skyline was given weight 0"
                            % (photo.id, 100.0 * (1.0 - trusted.mean())))
        if trusted.sum() >= 2:
            low, high = np.percentile(photo.elev_deg[trusted], [5, 95])
            if high - low < 0.3:
                warnings.append("%s: the skyline is nearly flat (%.2f deg of relief): the position "
                                "is weakly constrained" % (photo.id, high - low))
            spacing = np.median(np.diff(photo.az_offset_deg[trusted]))
            if spacing > 0.5:
                warnings.append("%s: samples are %.1f deg apart; about 0.1 deg gives a better match"
                                % (photo.id, spacing))
    return warnings
