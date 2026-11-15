"""terrain.json: which height tiles exist and where they sit. See CONTRACTS.md, section 1."""
import json
import math
import os
from dataclasses import dataclass
from pathlib import Path

from ..constants import CONTRACT_VERSION, MARS_RADIUS_M

MANIFEST_NAME = "terrain.json"

# Until Person 2 delivers a terrain folder with a manifest, the engine builds one for this
# single file (relative to the terrain folder).
DEFAULT_CTX_FILE = "ctx_20m/jezero_ctx_dem_20m.tif"


class TerrainError(Exception):
    """The terrain folder or its manifest can't be used as it is."""


@dataclass(frozen=True)
class TileSpec:
    file: str          # path relative to the terrain folder
    lat_min: float     # outer edges of the outer pixels, degrees
    lon_min: float
    lat_max: float
    lon_max: float
    rows: int
    cols: int

    @property
    def bounds(self):
        return [[self.lat_min, self.lon_min], [self.lat_max, self.lon_max]]


@dataclass(frozen=True)
class SourceSpec:
    id: str
    priority: int
    cell_size_m: float
    tiles: tuple
    description: str = ""
    nodata: float | None = None
    vertical_offset_m: float = 0.0
    edge_blend_m: float | None = None   # width of the blend band along the source's edge; None = default


@dataclass(frozen=True)
class Manifest:
    sources: tuple
    root: Path | None = None
    vertical_datum: str = "mars_areoid_mola"

    def to_json(self):
        """The manifest as the dict that terrain.json holds."""
        sources = []
        for s in self.sources:
            entry = {"id": s.id, "description": s.description, "priority": s.priority,
                     "cell_size_m": s.cell_size_m}
            if s.nodata is not None:
                entry["nodata"] = s.nodata
            entry["vertical_offset_m"] = s.vertical_offset_m
            if s.edge_blend_m is not None:
                entry["edge_blend_m"] = s.edge_blend_m
            entry["tiles"] = [{"file": t.file, "bounds": t.bounds, "rows": t.rows, "cols": t.cols}
                              for t in s.tiles]
            sources.append(entry)
        return {"contract_version": CONTRACT_VERSION, "sphere_radius_m": MARS_RADIUS_M,
                "vertical_datum": self.vertical_datum, "units": "m", "sources": sources}


def default_terrain_dir():
    """The terrain folder: $MARS_TERRAIN_DIR, else backend/data_local/terrain/."""
    env = os.environ.get("MARS_TERRAIN_DIR")
    if env:
        return Path(env)
    return Path(__file__).resolve().parents[2] / "data_local" / "terrain"


def _tile_from_json(entry, where):
    try:
        (lat_min, lon_min), (lat_max, lon_max) = entry["bounds"]
        tile = TileSpec(file=str(entry["file"]), lat_min=float(lat_min), lon_min=float(lon_min),
                        lat_max=float(lat_max), lon_max=float(lon_max),
                        rows=int(entry["rows"]), cols=int(entry["cols"]))
    except (KeyError, TypeError, ValueError) as error:
        raise TerrainError("%s: a tile needs file, bounds [[lat_min, lon_min], [lat_max, lon_max]], "
                           "rows and cols (%s)" % (where, error)) from None
    if not (tile.lat_min < tile.lat_max and tile.lon_min < tile.lon_max):
        raise TerrainError("%s: tile %s has empty or reversed bounds %s"
                           % (where, tile.file, tile.bounds))
    if tile.rows < 1 or tile.cols < 1:
        raise TerrainError("%s: tile %s has no pixels" % (where, tile.file))
    return tile


def parse_manifest(data, root=None, where=MANIFEST_NAME):
    """Manifest from the parsed JSON of a terrain.json. Raises TerrainError if it breaks the contract."""
    if not isinstance(data, dict):
        raise TerrainError("%s: expected a JSON object" % where)
    radius = data.get("sphere_radius_m", MARS_RADIUS_M)
    if abs(float(radius) - MARS_RADIUS_M) > 0.5:
        raise TerrainError("%s: sphere_radius_m is %s, but the engine works on the Mars 2000 sphere "
                           "(%.0f m)" % (where, radius, MARS_RADIUS_M))
    if data.get("units", "m") != "m":
        raise TerrainError("%s: units must be \"m\"" % where)
    entries = data.get("sources")
    if not entries:
        raise TerrainError("%s: no sources" % where)
    sources, seen = [], set()
    for entry in entries:
        try:
            source_id = str(entry["id"])
            priority = int(entry["priority"])
            cell = float(entry["cell_size_m"])
            tiles = entry["tiles"]
        except (KeyError, TypeError, ValueError) as error:
            raise TerrainError("%s: a source needs id, priority, cell_size_m and tiles (%s)"
                               % (where, error)) from None
        if source_id in seen:
            raise TerrainError("%s: source id %r appears twice" % (where, source_id))
        seen.add(source_id)
        if not tiles:
            raise TerrainError("%s: source %r has no tiles" % (where, source_id))
        if cell <= 0:
            raise TerrainError("%s: source %r has cell_size_m <= 0" % (where, source_id))
        nodata = entry.get("nodata")
        blend = entry.get("edge_blend_m")
        if blend is not None and float(blend) < 0:
            raise TerrainError("%s: source %r has edge_blend_m < 0" % (where, source_id))
        sources.append(SourceSpec(
            id=source_id, priority=priority, cell_size_m=cell,
            tiles=tuple(_tile_from_json(t, "%s, source %r" % (where, source_id)) for t in tiles),
            description=str(entry.get("description", "")),
            nodata=None if nodata is None else float(nodata),
            vertical_offset_m=float(entry.get("vertical_offset_m", 0.0)),
            edge_blend_m=None if blend is None else float(blend)))
    return Manifest(sources=tuple(sources), root=None if root is None else Path(root),
                    vertical_datum=str(data.get("vertical_datum", "mars_areoid_mola")))


def geotiff_grid(path):
    """(lat_min, lon_min, lat_max, lon_max, rows, cols, nodata) of a north-up GeoTIFF.

    Accepts a grid in degrees, or in metres of the equirectangular projection with standard
    parallel 0 on the Mars 2000 sphere (x = R * lon, y = R * lat in radians), which is how
    the CTX DEM comes. Returns None for the bounds if the file has no usable georeferencing.
    """
    import rasterio

    with rasterio.open(path) as src:
        t, rows, cols, nodata = src.transform, src.height, src.width, src.nodata
        if t.b != 0 or t.d != 0 or t.a <= 0 or t.e >= 0 or t.is_identity:
            return None, None, None, None, rows, cols, nodata
        left, top = t.c, t.f
        right, bottom = t.c + cols * t.a, t.f + rows * t.e
        if src.crs is not None:
            in_degrees = src.crs.is_geographic
        else:
            # No CRS: coordinates that fit on a globe are degrees; map metres at Jezero are millions
            in_degrees = max(abs(left), abs(right)) <= 360.0 and max(abs(top), abs(bottom)) <= 90.0
    if in_degrees:
        return bottom, left, top, right, rows, cols, nodata
    to_deg = lambda metres: math.degrees(metres / MARS_RADIUS_M)
    return to_deg(bottom), to_deg(left), to_deg(top), to_deg(right), rows, cols, nodata


def default_manifest(root):
    """Manifest for the one CTX file, read from its GeoTIFF header. See CONTRACTS.md, section 1."""
    root = Path(root)
    path = root / DEFAULT_CTX_FILE
    if not path.exists():
        raise TerrainError(
            "No terrain found. Expected %s, or the CTX DEM at %s. Get jezero_ctx_dem_20m.tif "
            "(\"MRO CTX, Jezero DEM, Controlled\", NASA Mars Trek) from Person 2 and put it there."
            % (root / MANIFEST_NAME, path))
    lat_min, lon_min, lat_max, lon_max, rows, cols, nodata = geotiff_grid(path)
    if lat_min is None:
        raise TerrainError("%s has no north-up georeferencing the engine understands" % path)
    cell_m = math.radians((lat_max - lat_min) / rows) * MARS_RADIUS_M
    tile = TileSpec(file=DEFAULT_CTX_FILE, lat_min=lat_min, lon_min=lon_min, lat_max=lat_max,
                    lon_max=lon_max, rows=rows, cols=cols)
    source = SourceSpec(id="ctx_20m", priority=20, cell_size_m=round(cell_m, 3), tiles=(tile,),
                        description="MRO CTX, Jezero DEM, Controlled (NASA Mars Trek)",
                        nodata=None if nodata is None else float(nodata))
    return Manifest(sources=(source,), root=root)


def find_manifest(root=None):
    """The manifest of a terrain folder: its terrain.json, else one built for the CTX file."""
    root = Path(root) if root is not None else default_terrain_dir()
    path = root / MANIFEST_NAME
    if path.exists():
        try:
            data = json.loads(path.read_text(encoding="utf-8"))
        except json.JSONDecodeError as error:
            raise TerrainError("%s is not valid JSON: %s" % (path, error)) from None
        return parse_manifest(data, root=root, where=str(path))
    return default_manifest(root)
