"""Height steps where terrain sources join.

CTX and HiRISE heights may sit on different zero levels. Where two sources overlap, this
compares them and reports the offset, so Person 2 can fix the data or set vertical_offset_m.
"""
from dataclasses import asdict, dataclass

import numpy as np

STEP_WARNING_M = 2.0   # report a pair as a problem above this
EDGE_CELLS = 3         # "at the join" = within this many coarse cells of the finer source's edge


@dataclass(frozen=True)
class SeamReport:
    upper: str            # id of the source that wins in the overlap
    lower: str            # id of the source underneath
    n: int                # points compared
    median_m: float       # upper minus lower over the whole overlap
    spread_m: float       # robust spread of that difference (1.4826 * MAD)
    p05_m: float
    p95_m: float
    n_edge: int           # points within EDGE_CELLS cells of the upper source's edge
    edge_median_m: float  # upper minus lower there: the step a traveller would see at the join
    problem: bool

    def to_json(self):
        return asdict(self)

    def describe(self):
        text = ("%s over %s: %s is %+.2f m higher (median of %d points, spread %.2f m, "
                "5-95 %%: %+.2f to %+.2f m)"
                % (self.upper, self.lower, self.upper, self.median_m, self.n, self.spread_m,
                   self.p05_m, self.p95_m))
        if self.n_edge:
            text += "; at the join %+.2f m (%d points)" % (self.edge_median_m, self.n_edge)
        return text + ("  <-- STEP, tell Person 2" if self.problem else "")


def compare_sources(terrain, max_points=250000):
    """A SeamReport for every pair of sources that overlap; an empty list if none do.

    Both sources are read at the coarser one's cell size, at that grid's cell centres, with
    each source's vertical_offset_m applied (so a correct offset in the manifest reports 0).
    """
    reports = []
    sources = terrain.sources  # highest priority first
    for i, upper in enumerate(sources):
        for lower in sources[i + 1:]:
            lat_min = max(upper.lat_min, lower.lat_min)
            lat_max = min(upper.lat_top, lower.lat_top)
            lon_min = max(upper.lon_left, lower.lon_left)
            lon_max = min(upper.lon_max, lower.lon_max)
            if lat_min >= lat_max or lon_min >= lon_max:
                continue
            coarse = upper if upper.cell_m >= lower.cell_m else lower
            n_lat = max(1, int((lat_max - lat_min) / coarse.dlat))
            n_lon = max(1, int((lon_max - lon_min) / coarse.dlon))
            stride = max(1, int(np.ceil(np.sqrt(n_lat * n_lon / max_points))))
            lats = lat_max - (np.arange(0, n_lat, stride) + 0.5) * coarse.dlat
            lons = lon_min + (np.arange(0, n_lon, stride) + 0.5) * coarse.dlon
            lat, lon = (a.reshape(-1) for a in np.meshgrid(lats, lons, indexing="ij"))

            def read(source, la, lo):
                return source.sample(la, lo, source.level_for(coarse.cell_m)) + source.vertical_offset_m

            up, low = read(upper, lat, lon), read(lower, lat, lon)
            both = np.isfinite(up) & np.isfinite(low)
            if not both.any():
                continue
            diff = up[both] - low[both]
            median = float(np.median(diff))
            spread = float(1.4826 * np.median(np.abs(diff - median)))

            # Points near the edge of the upper source's data: a neighbour a few cells away has none.
            near_edge = np.zeros(lat.shape, dtype=bool)
            for d_row, d_col in ((-1, 0), (1, 0), (0, -1), (0, 1)):
                shifted = read(upper, lat + d_row * EDGE_CELLS * coarse.dlat,
                               lon + d_col * EDGE_CELLS * coarse.dlon)
                near_edge |= ~np.isfinite(shifted)
            edge = both & near_edge
            n_edge = int(edge.sum())
            edge_median = float(np.median(up[edge] - low[edge])) if n_edge else float("nan")
            step = edge_median if n_edge >= 20 else median
            reports.append(SeamReport(
                upper=upper.id, lower=lower.id, n=int(both.sum()), median_m=median, spread_m=spread,
                p05_m=float(np.percentile(diff, 5)), p95_m=float(np.percentile(diff, 95)),
                n_edge=n_edge, edge_median_m=edge_median,
                problem=bool(abs(step) > STEP_WARNING_M or abs(median) > STEP_WARNING_M)))
    return reports
