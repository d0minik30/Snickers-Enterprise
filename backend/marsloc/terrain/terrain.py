"""Terrain: heights from every source, the finest available at each spot."""
import hashlib
import json
from pathlib import Path

import numpy as np

from ..constants import MARS_RADIUS_M
from .manifest import Manifest, SourceSpec, TerrainError, TileSpec, find_manifest
from .source import Source


# A source's blend band, when its manifest entry gives none: this many cells of the source
# that lies beneath it (150 m onto 20 m data, 1.5 km onto 200 m data).
DEFAULT_BLEND_CELLS = 7.5


class Terrain:
    """Height lookup over all sources of a terrain folder.

    At each spot the source with the highest priority that has data there wins; where it has
    none, the next one is used (CONTRACTS.md, section 1).

    Two sources can differ by tens of metres where they meet, which would put a false cliff
    into every horizon that looks across the join. So along the edge of its bounds a source
    is blended into whatever lies beneath it: at the edge the height is the lower source's,
    edge_blend_m further in it is the source's own, with a smooth ramp in between.
    """

    def __init__(self, manifest, arrays=None, edge_blend_m=None):
        """edge_blend_m: None = each source's manifest value, else the default; a number = that
        width for every source (0 switches blending off); a dict {source id: width} = overrides."""
        self.manifest = manifest
        self.sources = sorted((Source(spec, manifest.root, arrays) for spec in manifest.sources),
                              key=lambda s: -s.priority)
        self.blend_m = []
        for number, source in enumerate(self.sources):
            width = source.spec.edge_blend_m
            if isinstance(edge_blend_m, dict):
                width = edge_blend_m.get(source.id, width)
            elif edge_blend_m is not None:
                width = float(edge_blend_m)
            if width is None:
                beneath = self.sources[number + 1:]
                width = DEFAULT_BLEND_CELLS * beneath[0].cell_m if beneath else 0.0
            self.blend_m.append(float(width) if number + 1 < len(self.sources) else 0.0)

    @classmethod
    def open(cls, root=None, edge_blend_m=None):
        """Terrain of a folder (default: $MARS_TERRAIN_DIR or backend/data_local/terrain/)."""
        return cls(find_manifest(root), edge_blend_m=edge_blend_m)

    @classmethod
    def from_arrays(cls, sources, edge_blend_m=None):
        """Terrain from in-memory grids, for tests.

        sources: list of dicts with id, priority, bounds [[lat_min, lon_min], [lat_max, lon_max]],
        data (2-D heights, row 0 = north, NaN = no data), and optionally vertical_offset_m,
        edge_blend_m and cell_size_m. edge_blend_m: as in __init__.
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
                                    vertical_offset_m=float(s.get("vertical_offset_m", 0.0)),
                                    edge_blend_m=s.get("edge_blend_m")))
        return cls(Manifest(sources=tuple(specs)), arrays=arrays, edge_blend_m=edge_blend_m)

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
        parts = [json.dumps(self.manifest.to_json(), sort_keys=True), "blend:%r" % (self.blend_m,)]
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

        out = self._height_from(0, lat_f, lon_f, cell_f)
        return out.reshape(shape) if shape else float(out[0])

    def _height_from(self, number, lat, lon, cell):
        """Heights (1-D) from source `number` and everything beneath it. cell: min_cell_m as a
        float or as an array per point."""
        if number >= len(self.sources) or lat.size == 0:
            return np.full(lat.shape, np.nan)
        source = self.sources[number]
        per_point = np.ndim(cell) > 0
        if (lat.max() < source.lat_min or lat.min() > source.lat_top
                or lon.max() < source.lon_left or lon.min() > source.lon_max):
            return self._height_from(number + 1, lat, lon, cell)
        if per_point:
            unique_cells = np.unique(cell)
            levels = np.array([source.level_for(c) for c in unique_cells])
            out = np.full(lat.shape, np.nan)
            for level in np.unique(levels):
                pick = np.isin(cell, unique_cells[levels == level])
                out[pick] = source.sample(lat[pick], lon[pick], int(level))
        else:
            out = source.sample(lat, lon, source.level_for(cell))
        out = out + source.vertical_offset_m
        if number + 1 >= len(self.sources):
            return out

        missing = np.isnan(out)
        width = self.blend_m[number]
        if width > 0:
            ramp = np.clip(source.edge_distance_m(lat, lon) / width, 0.0, 1.0)
            own = ramp * ramp * (3.0 - 2.0 * ramp)       # 0 at the edge, 1 from `width` inwards
            band = ~missing & (own < 1.0)
        else:
            band = np.zeros(lat.shape, dtype=bool)
        beneath = np.flatnonzero(missing | band)
        if beneath.size:
            lower = self._height_from(number + 1, lat[beneath], lon[beneath],
                                      cell[beneath] if per_point else cell)
            mine = out[beneath]
            if width > 0:
                share = own[beneath]
                mixed = share * mine + (1.0 - share) * lower
                # blend only where both exist; otherwise whichever exists
                out[beneath] = np.where(np.isnan(mine), lower, np.where(np.isnan(lower), mine, mixed))
            else:
                out[beneath] = lower
        return out

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
