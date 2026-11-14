"""One terrain source: every tile of one resolution, as one virtual grid.

The tiles of a source share one cell size and one grid (CONTRACTS.md, section 1), so a source
is one big grid of pixels regular in degrees, of which each tile holds a block. Tiles are read
from disk the first time a lookup touches them.

Coarser versions ("levels") are made on demand for far-away lookups: level k has cells of
2**k x 2**k pixels, each the mean of its pixels, aligned to the source's grid rather than to
single tiles, so blocks that straddle two tiles are still averaged correctly.
"""
import math
from pathlib import Path

import numpy as np

from ..constants import MARS_RADIUS_M
from .manifest import TerrainError, geotiff_grid

MAX_LEVEL = 6             # coarsest level: 64 x 64 pixels per cell
GRID_TOLERANCE_PX = 0.05  # how far a tile may sit off the source's grid; covers rounded bounds


def read_geotiff(path, spec, nodata):
    """Heights of a tile as float32 with NaN for no data, plus a list of problems found."""
    import rasterio

    issues = []
    if not Path(path).exists():
        raise TerrainError("Tile %s is listed in the manifest but missing" % path)
    with rasterio.open(path) as src:
        if (src.height, src.width) != (spec.rows, spec.cols):
            raise TerrainError("Tile %s is %d x %d pixels (rows x cols), but the manifest says %d x %d"
                               % (path, src.height, src.width, spec.rows, spec.cols))
        data = src.read(1).astype(np.float32, copy=False)
        file_nodata = src.nodata
    bad = ~np.isfinite(data) | (data < -1e30)
    for value in (nodata, file_nodata):
        if value is not None and np.isfinite(value):
            bad |= data == np.float32(value)
    data = np.where(bad, np.float32(np.nan), data)

    lat_min, lon_min, lat_max, lon_max = geotiff_grid(path)[:4]
    if lat_min is None:
        issues.append("%s: the GeoTIFF header has no north-up georeferencing to check the "
                      "manifest against" % spec.file)
    else:
        cell_lat = (spec.lat_max - spec.lat_min) / spec.rows
        cell_lon = (spec.lon_max - spec.lon_min) / spec.cols
        off = max(abs(lat_min - spec.lat_min) / cell_lat, abs(lat_max - spec.lat_max) / cell_lat,
                  abs(lon_min - spec.lon_min) / cell_lon, abs(lon_max - spec.lon_max) / cell_lon)
        if off > 0.5:
            issues.append("%s: the GeoTIFF header places the tile %.1f pixels away from the "
                          "manifest's bounds (header [[%.7f, %.7f], [%.7f, %.7f]]); using the manifest"
                          % (spec.file, off, lat_min, lon_min, lat_max, lon_max))
    return data, issues


class Tile:
    """A block of the source's grid. Loads its file the first time its pixels are needed."""

    def __init__(self, spec, row0, col0, load):
        self.spec = spec
        self.row0, self.col0 = row0, col0      # position of the tile's first pixel in the source grid
        self.rows, self.cols = spec.rows, spec.cols
        self._load = load
        self._levels = {}

    @property
    def loaded(self):
        return bool(self._levels)

    def block_extent(self, level):
        """(first row, first col, rows, cols) of the level's cells that this tile touches.
        Needs no data, so asking does not load the tile."""
        size = 1 << level
        r0, c0 = self.row0 // size, self.col0 // size
        r1 = (self.row0 + self.rows - 1) // size + 1
        c1 = (self.col0 + self.cols - 1) // size + 1
        return r0, c0, r1 - r0, c1 - c0

    def level(self, level):
        """(mean, count) for the level's cells that this tile touches: mean is float32 with
        NaN where the tile has no data, count is how many of the tile's pixels are in each
        mean. count is None at level 0 (one pixel each)."""
        if level not in self._levels:
            if 0 not in self._levels:
                data = np.asarray(self._load(), dtype=np.float32)
                if data.shape != (self.rows, self.cols):
                    raise TerrainError("Tile %s has shape %s, expected (%d, %d)"
                                       % (self.spec.file, data.shape, self.rows, self.cols))
                self._levels[0] = (data, None)
            if level > 0:
                self._levels[level] = self._pooled(level)
        return self._levels[level]

    def _pooled(self, level):
        data = self._levels[0][0]
        size = 1 << level
        r0, c0, n_rows, n_cols = self.block_extent(level)
        pad = ((self.row0 - r0 * size, (r0 + n_rows) * size - (self.row0 + self.rows)),
               (self.col0 - c0 * size, (c0 + n_cols) * size - (self.col0 + self.cols)))
        blocks = np.pad(data, pad, constant_values=np.nan).reshape(n_rows, size, n_cols, size)
        valid = np.isfinite(blocks)
        count = valid.sum(axis=(1, 3))
        total = np.where(valid, blocks, 0.0).sum(axis=(1, 3), dtype=np.float64)
        with np.errstate(invalid="ignore", divide="ignore"):
            mean = np.where(count > 0, total / count, np.nan).astype(np.float32)
        return mean, count.astype(np.float32)


class Source:
    """All tiles of one resolution. sample() interpolates heights; NaN means no data."""

    def __init__(self, spec, root=None, arrays=None):
        """spec: SourceSpec. root: the terrain folder. arrays: optional {tile file: 2-D array}
        of heights (NaN = no data) used instead of reading files, for tests."""
        self.spec = spec
        self.id = spec.id
        self.priority = spec.priority
        self.vertical_offset_m = spec.vertical_offset_m
        self.issues = []
        first = spec.tiles[0]
        self.dlat = (first.lat_max - first.lat_min) / first.rows   # degrees per pixel
        self.dlon = (first.lon_max - first.lon_min) / first.cols
        self.lat_top = max(t.lat_max for t in spec.tiles)
        self.lon_left = min(t.lon_min for t in spec.tiles)
        self.lat_min = min(t.lat_min for t in spec.tiles)
        self.lon_max = max(t.lon_max for t in spec.tiles)
        self.cell_m = math.radians(self.dlat) * MARS_RADIUS_M      # north-south size of a pixel
        if abs(self.cell_m - spec.cell_size_m) > 0.05 * spec.cell_size_m:
            self.issues.append("source %s: cell_size_m says %g m but the tiles' bounds give %.2f m"
                               % (self.id, spec.cell_size_m, self.cell_m))

        self.tiles = []
        for tile in spec.tiles:
            row0 = (self.lat_top - tile.lat_max) / self.dlat
            col0 = (tile.lon_min - self.lon_left) / self.dlon
            rows = (tile.lat_max - tile.lat_min) / self.dlat
            cols = (tile.lon_max - tile.lon_min) / self.dlon
            for name, value, whole in (("top edge", row0, round(row0)), ("left edge", col0, round(col0)),
                                       ("height", rows, tile.rows), ("width", cols, tile.cols)):
                if abs(value - whole) > GRID_TOLERANCE_PX:
                    raise TerrainError(
                        "Source %s: tile %s is not on the source's grid (its %s is %.3f pixels, "
                        "expected %d). All tiles of a source must share one cell size and one grid."
                        % (self.id, tile.file, name, value, whole))
            self.tiles.append(Tile(tile, int(round(row0)), int(round(col0)),
                                   self._loader(tile, root, arrays)))

    def _loader(self, tile, root, arrays):
        if arrays is not None and tile.file in arrays:
            data = arrays[tile.file]
            return lambda: data

        def load():
            if root is None:
                raise TerrainError("Source %s has no folder to read %s from" % (self.id, tile.file))
            data, issues = read_geotiff(Path(root) / tile.file, tile, self.spec.nodata)
            self.issues.extend(issues)
            return data
        return load

    @property
    def tiles_loaded(self):
        return sum(1 for tile in self.tiles if tile.loaded)

    @property
    def bounds(self):
        return [[self.lat_min, self.lon_left], [self.lat_top, self.lon_max]]

    def level_for(self, min_cell_m):
        """The coarsest level whose cells are no bigger than min_cell_m (0 = full detail)."""
        if min_cell_m <= self.cell_m:
            return 0
        return min(MAX_LEVEL, int(math.floor(math.log2(min_cell_m / self.cell_m) + 1e-9)))

    def _gather(self, level, rr, cc):
        """Values of the level's cells (rr, cc), 1-D int arrays; NaN where there is no data."""
        if len(self.tiles) == 1:
            tile = self.tiles[0]
            r0, c0, n_rows, n_cols = tile.block_extent(level)
            r, c = rr - r0, cc - c0
            if r.size == 0:
                return np.full(rr.shape, np.nan)
            if r.min() >= 0 and r.max() < n_rows and c.min() >= 0 and c.max() < n_cols:
                return np.take(tile.level(level)[0].reshape(-1), r * n_cols + c)  # the usual case
            outside = (r < 0) | (r >= n_rows) | (c < 0) | (c >= n_cols)
            if outside.all():
                return np.full(rr.shape, np.nan)
            mean = tile.level(level)[0]
            out = np.take(mean.reshape(-1), r * n_cols + c, mode="clip").astype(np.float64)
            out[outside] = np.nan
            return out

        total = np.zeros(rr.shape)
        weight = np.zeros(rr.shape)
        for tile in self.tiles:
            r0, c0, n_rows, n_cols = tile.block_extent(level)
            r, c = rr - r0, cc - c0
            inside = np.flatnonzero((r >= 0) & (r < n_rows) & (c >= 0) & (c < n_cols))
            if inside.size == 0:
                continue  # this tile stays unloaded
            mean, count = tile.level(level)
            flat = r[inside] * n_cols + c[inside]
            values = mean.reshape(-1)[flat].astype(np.float64)
            good = np.isfinite(values)
            n = good.astype(np.float64) if count is None else np.where(good, count.reshape(-1)[flat], 0.0)
            total[inside] += np.where(good, values, 0.0) * n
            weight[inside] += n
        with np.errstate(invalid="ignore", divide="ignore"):
            return np.where(weight > 0, total / weight, np.nan)

    def sample(self, lat, lon, level=0):
        """Heights at the points (1-D arrays of degrees), bilinear between cell centres.

        A point has data if the cell it lies in has data. Where some of the four cells around
        it are missing (holes, the outer half pixel), the ones that exist are used.
        Heights are as stored: vertical_offset_m is not added here.
        """
        scale = 1 << level
        r = (self.lat_top - lat) / (self.dlat * scale) - 0.5
        c = (lon - self.lon_left) / (self.dlon * scale) - 0.5
        r0f, c0f = np.floor(r), np.floor(c)
        fr, fc = r - r0f, c - c0f
        r0, c0 = r0f.astype(np.int64), c0f.astype(np.int64)

        v00 = self._gather(level, r0, c0)
        v01 = self._gather(level, r0, c0 + 1)
        v10 = self._gather(level, r0 + 1, c0)
        v11 = self._gather(level, r0 + 1, c0 + 1)

        # Plain bilinear. It comes out NaN wherever one of the four cells is missing; those
        # points (usually none) are redone with the cells that do exist.
        top = v00 + (v01 - v00) * fc
        bottom = v10 + (v11 - v10) * fc
        out = np.asarray(top + (bottom - top) * fr, dtype=np.float64)
        patchy = np.flatnonzero(~np.isfinite(out))
        if patchy.size:
            out[patchy] = self._bilinear_with_gaps(v00[patchy], v01[patchy], v10[patchy], v11[patchy],
                                                   fr[patchy], fc[patchy])
        # A coarse cell on the source's edge sticks out past the real pixels: stop at the bounds.
        if out.size and (lat.min() < self.lat_min or lat.max() > self.lat_top
                         or lon.min() < self.lon_left or lon.max() > self.lon_max):
            out[(lat < self.lat_min) | (lat > self.lat_top)
                | (lon < self.lon_left) | (lon > self.lon_max)] = np.nan
        return out

    @staticmethod
    def _bilinear_with_gaps(v00, v01, v10, v11, fr, fc):
        """Bilinear over the cells that have data; NaN if the point's own cell has none."""
        num = np.zeros(fr.shape)
        den = np.zeros(fr.shape)
        for value, w in ((v00, (1 - fr) * (1 - fc)), (v01, (1 - fr) * fc),
                         (v10, fr * (1 - fc)), (v11, fr * fc)):
            ok = np.isfinite(value)
            num += np.where(ok, value * w, 0.0)
            den += np.where(ok, w, 0.0)
        own = np.where(fr < 0.5, np.where(fc < 0.5, v00, v01), np.where(fc < 0.5, v10, v11))
        with np.errstate(invalid="ignore", divide="ignore"):
            return np.where(np.isfinite(own) & (den > 0), num / den, np.nan)
