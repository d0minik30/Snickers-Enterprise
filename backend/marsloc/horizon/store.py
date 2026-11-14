"""Precomputed horizons: the full-circle horizon of every candidate position on a grid.

The matcher's coarse stage compares a photo's skyline with these instead of rendering.
They are stored outside git in backend/cache/ and rebuilt by scripts/build_horizons.py.

A store is a folder with:
  meta.json   grid, settings, terrain fingerprint, build time and size
  elev.npy    int16 [candidates, azimuths]: horizon elevation in steps of 0.01 deg; -32768 = none
  dist.npy    uint16 [candidates, azimuths]: distance to the terrain that forms it, in metres; 0 = none
  ground.npy  float32 [candidates]: terrain height under each candidate; NaN = no terrain there

Candidates are the cell centres of a grid regular in degrees (row 0 = north, col 0 = west),
numbered row * cols + col. The likelihood heatmap of the result uses the same cells.
"""
import datetime
import json
import math
import os
import time
from concurrent.futures import ProcessPoolExecutor, as_completed
from dataclasses import dataclass
from pathlib import Path

import numpy as np

from .. import __version__
from ..constants import DEFAULT_EYE_HEIGHT_M, MARS_RADIUS_M
from .render import RenderConfig, render_horizon

FORMAT_VERSION = 1
ELEV_SCALE_DEG = 0.01
ELEV_NODATA = -32768
DIST_NODATA = 0

# Settings for the stored horizons. Coarser than a live render on purpose: candidates are
# 200 m apart, which alone moves the far horizon by about 0.1 deg.
STORE_CONFIG = RenderConfig(az_step_deg=0.5, step_growth=0.016, refine_top=4, refine_sub=12)


def default_cache_dir():
    """Where stores live: $MARS_CACHE_DIR, else backend/cache/."""
    env = os.environ.get("MARS_CACHE_DIR")
    return Path(env) if env else Path(__file__).resolve().parents[2] / "cache"


def default_store_dir(spacing_m=200.0, az_step_deg=STORE_CONFIG.az_step_deg):
    return default_cache_dir() / ("horizons_%gm_%gdeg" % (spacing_m, az_step_deg))


@dataclass(frozen=True)
class CandidateGrid:
    """Grid regular in degrees whose cell centres are the candidate positions."""
    lat_max: float     # northern edge of row 0
    lon_min: float     # western edge of col 0
    dlat: float        # cell size in degrees
    dlon: float
    rows: int
    cols: int

    @classmethod
    def cover(cls, bounds, spacing_m, margin_m=0.0):
        """Grid with cells of about spacing_m x spacing_m inside bounds
        ([[lat_min, lon_min], [lat_max, lon_max]]), kept margin_m away from its edges."""
        (lat_min, lon_min), (lat_max, lon_max) = bounds
        mid = math.radians((lat_min + lat_max) / 2)
        dlat = math.degrees(spacing_m / MARS_RADIUS_M)
        dlon = dlat / math.cos(mid)
        pad_lat = math.degrees(margin_m / MARS_RADIUS_M)
        pad_lon = pad_lat / math.cos(mid)
        lat_min, lat_max = lat_min + pad_lat, lat_max - pad_lat
        lon_min, lon_max = lon_min + pad_lon, lon_max - pad_lon
        rows = int(math.floor((lat_max - lat_min) / dlat + 1e-9))
        cols = int(math.floor((lon_max - lon_min) / dlon + 1e-9))
        if rows < 1 or cols < 1:
            raise ValueError("No room for a %g m grid inside %s with a %g m margin"
                             % (spacing_m, bounds, margin_m))
        # Centre the grid in the room there is
        top = (lat_min + lat_max) / 2 + rows * dlat / 2
        left = (lon_min + lon_max) / 2 - cols * dlon / 2
        return cls(lat_max=top, lon_min=left, dlat=dlat, dlon=dlon, rows=rows, cols=cols)

    @property
    def n(self):
        return self.rows * self.cols

    @property
    def lats(self):
        """Latitude of each row's cell centres, north to south."""
        return self.lat_max - (np.arange(self.rows) + 0.5) * self.dlat

    @property
    def lons(self):
        """Longitude of each column's cell centres, west to east."""
        return self.lon_min + (np.arange(self.cols) + 0.5) * self.dlon

    @property
    def bounds(self):
        return [[self.lat_max - self.rows * self.dlat, self.lon_min],
                [self.lat_max, self.lon_min + self.cols * self.dlon]]

    @property
    def cell_size_m(self):
        mid = math.radians(self.lat_max - self.rows * self.dlat / 2)
        north_south = math.radians(self.dlat) * MARS_RADIUS_M
        return {"north_south": north_south,
                "east_west": math.radians(self.dlon) * MARS_RADIUS_M * math.cos(mid)}

    def latlon(self, index):
        """(lat, lon) of candidates by number (row * cols + col); scalars or arrays."""
        row, col = np.divmod(np.asarray(index), self.cols)
        return self.lat_max - (row + 0.5) * self.dlat, self.lon_min + (col + 0.5) * self.dlon

    def nearest(self, lat, lon):
        """Number of the candidate whose cell holds the point; -1 outside the grid."""
        row = np.floor((self.lat_max - np.asarray(lat, dtype=float)) / self.dlat).astype(np.int64)
        col = np.floor((np.asarray(lon, dtype=float) - self.lon_min) / self.dlon).astype(np.int64)
        inside = (row >= 0) & (row < self.rows) & (col >= 0) & (col < self.cols)
        index = np.where(inside, row * self.cols + col, -1)
        return index if index.ndim else int(index)

    def to_json(self):
        size = self.cell_size_m
        return {"bounds": self.bounds, "rows": self.rows, "cols": self.cols,
                "cell_size_deg": {"lat": self.dlat, "lon": self.dlon},
                "cell_size_m": {k: round(v, 3) for k, v in size.items()}}

    @classmethod
    def from_json(cls, data):
        return cls(lat_max=data["bounds"][1][0], lon_min=data["bounds"][0][1],
                   dlat=data["cell_size_deg"]["lat"], dlon=data["cell_size_deg"]["lon"],
                   rows=data["rows"], cols=data["cols"])


def quantize_elev(elev_deg):
    """Elevation angles as int16 steps of 0.01 deg; NaN becomes ELEV_NODATA."""
    steps = np.round(np.asarray(elev_deg, dtype=np.float64) / ELEV_SCALE_DEG)
    return np.where(np.isfinite(steps), np.clip(steps, -32767, 32767), ELEV_NODATA).astype(np.int16)


def dequantize_elev(elev_q):
    """int16 steps back to degrees (float32); ELEV_NODATA becomes NaN."""
    elev_q = np.asarray(elev_q)
    return np.where(elev_q == ELEV_NODATA, np.float32(np.nan),
                    elev_q.astype(np.float32) * np.float32(ELEV_SCALE_DEG))


def quantize_dist(dist_m, scale_m=1.0):
    """Distances as uint16 steps of scale_m metres (at least 1 step); NaN becomes DIST_NODATA."""
    steps = np.round(np.asarray(dist_m, dtype=np.float64) / scale_m)
    return np.where(np.isfinite(steps), np.clip(steps, 1, 65535), DIST_NODATA).astype(np.uint16)


def dequantize_dist(dist_q, scale_m=1.0):
    dist_q = np.asarray(dist_q)
    return np.where(dist_q == DIST_NODATA, np.float32(np.nan),
                    dist_q.astype(np.float32) * np.float32(scale_m))


def dist_scale_for(max_range_m):
    """Metres per uint16 step so that max_range_m fits: 1 m up to 65 km."""
    return float(max(1, math.ceil(max_range_m / 65000.0)))


# ---------------------------------------------------------------- building

_worker_terrain = None


def _init_worker(terrain_root):
    global _worker_terrain
    from ..terrain import Terrain
    _worker_terrain = Terrain.open(terrain_root)


def _render_row(terrain, row, lat, lons, eye_height_m, config):
    """Quantized horizons of one grid row: (row, elev [cols, az], dist [cols, az], ground [cols])."""
    n_az = config.azimuths().size
    scale = dist_scale_for(config.max_range_m)
    elev = np.full((lons.size, n_az), ELEV_NODATA, dtype=np.int16)
    dist = np.full((lons.size, n_az), DIST_NODATA, dtype=np.uint16)
    ground = np.full(lons.size, np.nan, dtype=np.float32)
    heights = terrain.height(np.full(lons.shape, lat), lons)
    for col in np.flatnonzero(np.isfinite(heights)):
        horizon = render_horizon(terrain, lat, lons[col], eye_height_m, config)
        elev[col] = quantize_elev(horizon.elev_deg)
        dist[col] = quantize_dist(horizon.dist_m, scale)
        ground[col] = horizon.ground_m
    return row, elev, dist, ground


def _render_row_in_worker(row, lat, lons, eye_height_m, config):
    return _render_row(_worker_terrain, row, lat, lons, eye_height_m, config)


def build_store(terrain, out_dir, spacing_m=200.0, config=STORE_CONFIG,
                eye_height_m=DEFAULT_EYE_HEIGHT_M, margin_m=0.0, bounds=None, workers=1,
                progress=None):
    """Render the horizon of every candidate on a grid and write a store to out_dir.

    bounds: area to cover, default the terrain's. workers > 1 renders rows in parallel
    processes, which reopen the terrain from its folder (so it must come from files).
    progress: optional function(rows_done, rows_total). Returns the store's meta dict.
    """
    out_dir = Path(out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)
    grid = CandidateGrid.cover(bounds if bounds is not None else terrain.bounds, spacing_m, margin_m)
    n_az = config.azimuths().size
    lats, lons = grid.lats, grid.lons
    started = time.perf_counter()

    elev = np.lib.format.open_memmap(out_dir / "elev.npy", mode="w+", dtype=np.int16,
                                     shape=(grid.n, n_az))
    dist = np.lib.format.open_memmap(out_dir / "dist.npy", mode="w+", dtype=np.uint16,
                                     shape=(grid.n, n_az))
    ground = np.full(grid.n, np.nan, dtype=np.float32)

    def keep(result):
        row, row_elev, row_dist, row_ground = result
        block = slice(row * grid.cols, (row + 1) * grid.cols)
        elev[block], dist[block], ground[block] = row_elev, row_dist, row_ground

    if workers > 1:
        root = terrain.manifest.root
        if root is None:
            raise ValueError("workers > 1 needs a terrain opened from a folder")
        with ProcessPoolExecutor(max_workers=workers, initializer=_init_worker,
                                 initargs=(str(root),)) as pool:
            jobs = [pool.submit(_render_row_in_worker, row, float(lats[row]), lons, eye_height_m, config)
                    for row in range(grid.rows)]
            for done, job in enumerate(as_completed(jobs), start=1):
                keep(job.result())
                if progress:
                    progress(done, grid.rows)
    else:
        for row in range(grid.rows):
            keep(_render_row(terrain, row, float(lats[row]), lons, eye_height_m, config))
            if progress:
                progress(row + 1, grid.rows)

    elev.flush()
    dist.flush()
    del elev, dist
    np.save(out_dir / "ground.npy", ground)
    sizes = {name: (out_dir / name).stat().st_size for name in ("elev.npy", "dist.npy", "ground.npy")}
    meta = {
        "format_version": FORMAT_VERSION,
        "engine_version": __version__,
        "built_utc": datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "terrain_id": terrain.terrain_id(),
        "terrain_sources": terrain.source_ids,
        "grid": grid.to_json(),
        "spacing_m": spacing_m,
        "margin_m": margin_m,
        "eye_height_m": eye_height_m,
        "render": config.to_json(),
        "n_az": int(n_az),
        "elev_scale_deg": ELEV_SCALE_DEG,
        "elev_nodata": ELEV_NODATA,
        "dist_scale_m": dist_scale_for(config.max_range_m),
        "dist_nodata": DIST_NODATA,
        "n_candidates": grid.n,
        "n_valid": int(np.isfinite(ground).sum()),
        "workers": workers,
        "build_seconds": round(time.perf_counter() - started, 1),
        "bytes": {**sizes, "total": sum(sizes.values())},
    }
    (out_dir / "meta.json").write_text(json.dumps(meta, indent=2) + "\n", encoding="utf-8", newline="\n")
    return meta


# ---------------------------------------------------------------- reading

class HorizonStore:
    """A store opened for reading. The big arrays are memory-mapped, so opening is instant."""

    def __init__(self, directory, meta, elev_q, dist_q, ground):
        self.directory = Path(directory)
        self.meta = meta
        self.elev_q = elev_q          # int16 [candidates, azimuths]
        self.dist_q = dist_q          # uint16 [candidates, azimuths]
        self.ground = ground          # float32 [candidates]
        self.grid = CandidateGrid.from_json(meta["grid"])
        self.config = RenderConfig(**meta["render"])
        self.az_step_deg = self.config.az_step_deg
        self.n_az = int(meta["n_az"])
        self.eye_height_m = float(meta["eye_height_m"])
        self.dist_scale_m = float(meta["dist_scale_m"])
        self.valid = np.isfinite(ground)   # candidates that stand on terrain

    @classmethod
    def load(cls, directory=None, mmap=True):
        directory = Path(directory) if directory is not None else default_store_dir()
        meta_path = directory / "meta.json"
        if not meta_path.exists():
            raise FileNotFoundError(
                "No precomputed horizons in %s. Build them with: python scripts/build_horizons.py"
                % directory)
        meta = json.loads(meta_path.read_text(encoding="utf-8"))
        if meta.get("format_version") != FORMAT_VERSION:
            raise ValueError("%s has format version %r, this engine reads %d: rebuild it"
                             % (directory, meta.get("format_version"), FORMAT_VERSION))
        mode = "r" if mmap else None
        elev_q = np.load(directory / "elev.npy", mmap_mode=mode)
        dist_q = np.load(directory / "dist.npy", mmap_mode=mode)
        ground = np.load(directory / "ground.npy")
        expected = (meta["n_candidates"], meta["n_az"])
        if elev_q.shape != expected or dist_q.shape != expected or ground.shape != expected[:1]:
            raise ValueError("%s is incomplete or damaged: rebuild it" % directory)
        return cls(directory, meta, elev_q, dist_q, ground)

    @property
    def az_deg(self):
        return np.arange(self.n_az) * self.az_step_deg

    def matches(self, terrain):
        """True if the store was built from exactly this terrain."""
        return self.meta["terrain_id"] == terrain.terrain_id()

    def elev_deg(self, index=None):
        """Horizon elevation in degrees (float32, NaN = none) of all or the given candidates."""
        return dequantize_elev(self.elev_q if index is None else self.elev_q[index])

    def dist_m(self, index=None):
        """Distance in metres to the terrain forming the horizon (float32, NaN = none)."""
        return dequantize_dist(self.dist_q if index is None else self.dist_q[index], self.dist_scale_m)

    def near_fraction(self, threshold_m):
        """Per candidate, the share of its horizon formed by terrain closer than threshold_m
        (NaN for candidates off the terrain)."""
        limit = threshold_m / self.dist_scale_m
        out = np.full(self.grid.n, np.nan)
        for start in range(0, self.grid.n, 4096):
            block = np.asarray(self.dist_q[start:start + 4096])
            seen = block != DIST_NODATA
            count = seen.sum(axis=1)
            with np.errstate(invalid="ignore", divide="ignore"):
                out[start:start + 4096] = np.where(count > 0, ((block < limit) & seen).sum(axis=1) / count,
                                                   np.nan)
        return out
