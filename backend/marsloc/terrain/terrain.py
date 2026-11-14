"""Terrain: heights from every source, the finest available at each spot."""
import hashlib
import json
from pathlib import Path

import numpy as np

from ..constants import MARS_RADIUS_M
from .manifest import Manifest, SourceSpec, TerrainError, TileSpec, find_manifest
from .source import Source


class Terrain:
    """Height lookup over all sources of a terrain folder.

    At each spot the source with the highest priority that has data there wins; where it has
    none, the next one is used (CONTRACTS.md, section 1). Nothing is blended.
    """

    def __init__(self, manifest, arrays=None):
        self.manifest = manifest
        self.sources = sorted((Source(spec, manifest.root, arrays) for spec in manifest.sources),
                              key=lambda s: -s.priority)

    @classmethod
    def open(cls, root=None):
        """Terrain of a folder (default: $MARS_TERRAIN_DIR or backend/data_local/terrain/)."""
        return cls(find_manifest(root))

    @classmethod
    def from_arrays(cls, sources):
        """Terrain from in-memory grids, for tests.

        sources: list of dicts with id, priority, bounds [[lat_min, lon_min], [lat_max, lon_max]],
        data (2-D heights, row 0 = north, NaN = no data), and optionally vertical_offset_m and
        cell_size_m.
        """
        specs, arrays = [], {}
        for s in sources:
            data = np.asarray(s["data"], dtype=np.float32)
            (lat_min, lon_min), (lat_max, lon_max) = s["bounds"]
            name = "%s.mem" % s["id"]
            arrays[name] = data
            tile = TileSpec(file=name, lat_min=lat_min, lon_min=lon_min, lat_max=lat_max,
                            lon_max=lon_max, rows=data.shape[0], cols=data.shape[1])
            cell = s.get("cell_size_m")
            if cell is None:
                cell = np.radians((lat_max - lat_min) / data.shape[0]) * MARS_RADIUS_M
            specs.append(SourceSpec(id=s["id"], priority=s["priority"], cell_size_m=float(cell),
                                    tiles=(tile,),
                                    vertical_offset_m=float(s.get("vertical_offset_m", 0.0))))
        return cls(Manifest(sources=tuple(specs)), arrays=arrays)

    @property
    def bounds(self):
        """[[lat_min, lon_min], [lat_max, lon_max]] around every source."""
        boxes = [s.bounds for s in self.sources]
        return [[min(b[0][0] for b in boxes), min(b[0][1] for b in boxes)],
                [max(b[1][0] for b in boxes), max(b[1][1] for b in boxes)]]

    @property
    def issues(self):
        """Problems noticed so far while loading tiles (plain-English strings)."""
        return [issue for s in self.sources for issue in s.issues]

    @property
    def tiles_loaded(self):
        return sum(s.tiles_loaded for s in self.sources)

    @property
    def source_ids(self):
        return [s.id for s in self.sources]

    def terrain_id(self):
        """Short fingerprint of the terrain (manifest plus size and date of every file), so
        precomputed horizons can tell whether they were made from this terrain."""
        parts = [json.dumps(self.manifest.to_json(), sort_keys=True)]
        root = self.manifest.root
        for spec in self.manifest.sources:
            for tile in spec.tiles:
                path = None if root is None else Path(root) / tile.file
                if path is not None and path.exists():
                    stat = path.stat()
                    parts.append("%s:%d:%d" % (tile.file, stat.st_size, stat.st_mtime_ns))
        return hashlib.sha256("|".join(parts).encode("utf-8")).hexdigest()[:16]

    def height(self, lat, lon, min_cell_m=0.0):
        """Height in metres above the datum at each point; NaN where no source has data.

        lat, lon: degrees, scalars or arrays that broadcast together. min_cell_m: detail that
        is enough for the caller, a scalar or an array per point. Sources finer than that are
        read from an averaged, coarser level: far-away lookups get smoother, smaller data.
        0 means full detail.
        """
        lat_b, lon_b = np.broadcast_arrays(np.asarray(lat, dtype=np.float64),
                                           np.asarray(lon, dtype=np.float64))
        shape = lat_b.shape
        lat_f, lon_f = lat_b.reshape(-1), lon_b.reshape(-1)
        per_point = np.ndim(min_cell_m) > 0
        cell_f = np.broadcast_to(np.asarray(min_cell_m, dtype=np.float64), shape).reshape(-1) \
            if per_point else float(min_cell_m)

        out = np.full(lat_f.shape, np.nan)
        for number, source in enumerate(self.sources):
            if number == 0:
                index, la, lo = None, lat_f, lon_f
            else:
                index = np.flatnonzero(np.isnan(out))
                if index.size == 0:
                    break
                la, lo = lat_f[index], lon_f[index]
            if (la.size == 0 or la.max() < source.lat_min or la.min() > source.lat_top
                    or lo.max() < source.lon_left or lo.min() > source.lon_max):
                continue
            if per_point:
                cells = cell_f if index is None else cell_f[index]
                unique_cells = np.unique(cells)
                levels = np.array([source.level_for(c) for c in unique_cells])
                values = np.full(la.shape, np.nan)
                for level in np.unique(levels):
                    pick = np.isin(cells, unique_cells[levels == level])
                    values[pick] = source.sample(la[pick], lo[pick], int(level))
            else:
                values = source.sample(la, lo, source.level_for(cell_f))
            values = values + source.vertical_offset_m
            if index is None:
                out = values
            else:
                out[index] = values
        return out.reshape(shape) if shape else float(out[0])

    def source_at(self, lat, lon):
        """Index into self.sources of the source that supplies each point; -1 where none does."""
        lat_b, lon_b = np.broadcast_arrays(np.asarray(lat, dtype=np.float64),
                                           np.asarray(lon, dtype=np.float64))
        shape = lat_b.shape
        lat_f, lon_f = lat_b.reshape(-1), lon_b.reshape(-1)
        out = np.full(lat_f.shape, -1, dtype=np.int64)
        for number, source in enumerate(self.sources):
            index = np.flatnonzero(out < 0)
            if index.size == 0:
                break
            has = np.isfinite(source.sample(lat_f[index], lon_f[index], 0))
            out[index[has]] = number
        return out.reshape(shape) if shape else int(out[0])

    def finest_cell_m(self, lat, lon):
        """Cell size in metres of the source that supplies the point (lat, lon)."""
        number = self.source_at(float(lat), float(lon))
        if number < 0:
            raise TerrainError("No terrain data at lat %.6f, lon %.6f" % (lat, lon))
        return self.sources[number].cell_m
