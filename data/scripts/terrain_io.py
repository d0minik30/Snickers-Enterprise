"""Plumbing for the engine terrain build (fetch_terrain.py): downloads, pixel checksums, map
projections, windows and GeoTIFF tiles.

Every failure raises TerrainBuildError with a message naming the file and the reason, so the build
stops loudly instead of installing half a terrain.
"""
import hashlib
import math
import os
import urllib.error
import urllib.request
from pathlib import Path

import numpy as np
import rasterio
from affine import Affine
from rasterio.windows import Window

R = 3396190.0                     # Mars 2000 sphere, metres (backend/CONTRACTS.md, section 0)
USER_AGENT = "terrain-fetch/1.0"  # generic on purpose: no names in requests to outside services
TILE_PX = 2048                    # the contract suggests tiles of at most 2048 x 2048 pixels
CHUNK_BYTES = 8 << 20
EPS_PX = 1e-6                     # how close to a pixel edge counts as on it


class TerrainBuildError(RuntimeError):
    """A step of the terrain build failed; the message says which file and why."""


def human_bytes(n):
    for unit, size in (("GB", 1e9), ("MB", 1e6), ("KB", 1e3)):
        if n >= size:
            return "%.2f %s" % (n / size, unit)
    return "%d B" % n


# ---------------------------------------------------------------- downloads

def download(url, dest, expected_bytes, log=print):
    """Fetch url into dest and check that exactly expected_bytes arrived.

    A cut-off download is resumed from dest + ".part". An existing dest of the right size is kept
    (its pixels are checked by the caller); one of another size is refused.
    """
    dest = Path(dest)
    if dest.exists():
        size = dest.stat().st_size
        if size != expected_bytes:
            raise TerrainBuildError("%s is %d bytes, but the official file has %d bytes; delete it and "
                                    "run again" % (dest, size, expected_bytes))
        log("  have %s (%s)" % (dest.name, human_bytes(size)))
        return dest
    dest.parent.mkdir(parents=True, exist_ok=True)
    part = dest.with_name(dest.name + ".part")
    have = part.stat().st_size if part.exists() else 0
    if have >= expected_bytes:      # a complete download would have been renamed: start over
        part.unlink()
        have = 0
    headers = {"User-Agent": USER_AGENT}
    if have:
        headers["Range"] = "bytes=%d-" % have
    try:
        response = urllib.request.urlopen(urllib.request.Request(url, headers=headers), timeout=120)
    except urllib.error.HTTPError as error:
        raise TerrainBuildError("download of %s failed: HTTP %d %s" % (url, error.code, error.reason)) from None
    except (urllib.error.URLError, OSError) as error:
        raise TerrainBuildError("download of %s failed: %s" % (url, error)) from None
    with response:
        if have and response.status != 206:
            have = 0                # the server ignored the range request: start over
        length = response.headers.get("Content-Length")
        if length is None:
            raise TerrainBuildError("%s: the server sent no Content-Length" % url)
        if have + int(length) != expected_bytes:
            raise TerrainBuildError("%s: the server has %d bytes, but the pinned size is %d; the official "
                                    "file may have changed" % (url, have + int(length), expected_bytes))
        log("  downloading %s (%s%s)" % (dest.name, human_bytes(expected_bytes),
                                         ", resuming at %s" % human_bytes(have) if have else ""))
        done, step = have, max(expected_bytes // 10, 1)
        next_report = (done // step + 1) * step
        with part.open("ab" if have else "wb") as out:
            while True:
                try:
                    chunk = response.read(CHUNK_BYTES)
                except OSError as error:
                    raise TerrainBuildError("download of %s broke off at %d of %d bytes (%s); run again to "
                                            "resume" % (url, done, expected_bytes, error)) from None
                if not chunk:
                    break
                out.write(chunk)
                done += len(chunk)
                if next_report <= done < expected_bytes:
                    log("    %3.0f %%" % (100.0 * done / expected_bytes))
                    next_report = (done // step + 1) * step
    size = part.stat().st_size
    if size != expected_bytes:
        raise TerrainBuildError("download of %s stopped at %d of %d bytes; run again to resume"
                                % (url, size, expected_bytes))
    os.replace(part, dest)
    return dest


# ---------------------------------------------------------------- pixel checksums

def _checksum_header(dtype, rows, cols):
    return ("%s %dx%d\n" % (np.dtype(dtype).newbyteorder("<").str, rows, cols)).encode("ascii")


def array_sha256(array):
    """SHA-256 of a 2-D array's pixels: its dtype and shape, then the values little-endian, row by
    row. The same pixels give the same checksum whatever file format or compression held them."""
    a = np.asarray(array)
    if a.ndim != 2:
        raise ValueError("expected a 2-D array, got shape %s" % (a.shape,))
    digest = hashlib.sha256(_checksum_header(a.dtype, *a.shape))
    digest.update(np.ascontiguousarray(a, dtype=a.dtype.newbyteorder("<")).tobytes())
    return digest.hexdigest()


def pixel_sha256(path, window=None, block_rows=512):
    """array_sha256 of band 1 of a raster, or of window = (row0, col0, rows, cols), read in blocks
    of block_rows rows so big files need little memory."""
    with rasterio.open(path) as src:
        row0, col0, rows, cols = window if window is not None else (0, 0, src.height, src.width)
        dtype = np.dtype(src.dtypes[0])
        digest = hashlib.sha256(_checksum_header(dtype, rows, cols))
        for r in range(row0, row0 + rows, block_rows):
            n = min(block_rows, row0 + rows - r)
            block = src.read(1, window=Window(col0, r, cols, n))
            digest.update(np.ascontiguousarray(block, dtype=dtype.newbyteorder("<")).tobytes())
    return digest.hexdigest()


# ---------------------------------------------------------------- projections

def _unit(parameter):
    unit = parameter.get("unit", "")
    return unit.get("name", "") if isinstance(unit, dict) else str(unit)


def projection(crs, what="raster"):
    """The parameters of a coordinate system this build understands:
    {"kind": "geographic", "radius_m", "prime_meridian"} or {"kind": "eqc", "radius_m",
    "prime_meridian", "lat_ts" (standard parallel), "lon_0" (central meridian), "lat_0", "x_0",
    "y_0"}, all in degrees and metres. Anything else raises TerrainBuildError."""
    if crs is None:
        raise TerrainBuildError("%s has no coordinate system" % what)
    pj = crs.to_dict(projjson=True)
    kind = pj.get("type")
    base = pj.get("base_crs", pj)
    datum = base.get("datum") or base.get("datum_ensemble") or {}
    ellipsoid = datum.get("ellipsoid", {})
    radius = ellipsoid.get("radius")
    if radius is None and "semi_major_axis" in ellipsoid:
        a = float(ellipsoid["semi_major_axis"])
        b = float(ellipsoid.get("semi_minor_axis", a))
        if abs(b - a) < 1e-6 and not ellipsoid.get("inverse_flattening"):
            radius = a
    if radius is None:
        raise TerrainBuildError("%s: the coordinate system is not on a sphere (ellipsoid %s)" % (what, ellipsoid))
    meridian = float((datum.get("prime_meridian") or {}).get("longitude", 0.0))
    out = {"kind": None, "radius_m": float(radius), "prime_meridian": meridian}
    if kind == "GeographicCRS":
        out["kind"] = "geographic"
        return out
    if kind != "ProjectedCRS":
        raise TerrainBuildError("%s: unsupported coordinate system type %s" % (what, kind))
    method = pj["conversion"]["method"]["name"]
    if "Equidistant Cylindrical" not in method and "Equirectangular" not in method:
        raise TerrainBuildError("%s is in the %s projection, not equirectangular; resample it onto the "
                                "contract grid first" % (what, method))
    params = {p["name"]: p for p in pj["conversion"]["parameters"]}

    def value(name, unit):
        p = params.get(name)
        if p is None:
            return 0.0
        if _unit(p) not in (unit, ""):
            raise TerrainBuildError("%s: parameter %r is in %s, expected %s" % (what, name, _unit(p), unit))
        return float(p["value"])

    out.update(kind="eqc", lat_ts=value("Latitude of 1st standard parallel", "degree"),
               lat_0=value("Latitude of natural origin", "degree"),
               lon_0=value("Longitude of natural origin", "degree"),
               x_0=value("False easting", "metre"), y_0=value("False northing", "metre"))
    for axis in pj.get("coordinate_system", {}).get("axis", []):
        if _unit(axis) not in ("metre", ""):
            raise TerrainBuildError("%s: map units are %s, expected metres" % (what, _unit(axis)))
    return out


def to_degrees(p, x, y):
    """Map coordinates of projection p (from projection()) to (lon, lat) in degrees."""
    if p["kind"] == "geographic":
        return np.asarray(x) + p["prime_meridian"], np.asarray(y)
    lon = p["lon_0"] + np.degrees((np.asarray(x) - p["x_0"]) / (p["radius_m"] * math.cos(math.radians(p["lat_ts"]))))
    lat = p["lat_0"] + np.degrees((np.asarray(y) - p["y_0"]) / p["radius_m"])
    return lon + p["prime_meridian"], lat


def to_map(p, lon, lat):
    """(lon, lat) in degrees to map coordinates of projection p."""
    lon = np.asarray(lon, dtype=float) - p["prime_meridian"]
    lat = np.asarray(lat, dtype=float)
    if p["kind"] == "geographic":
        return lon, lat
    x = p["x_0"] + np.radians(lon - p["lon_0"]) * p["radius_m"] * math.cos(math.radians(p["lat_ts"]))
    y = p["y_0"] + np.radians(lat - p["lat_0"]) * p["radius_m"]
    return x, y


def _require_north_up(transform, what):
    t = transform
    if t.b != 0 or t.d != 0 or t.a <= 0 or t.e >= 0:
        raise TerrainBuildError("%s is not a north-up grid (transform %s)" % (what, tuple(t)[:6]))


def degree_bounds(crs, transform, rows, cols, what="raster"):
    """[[lat_min, lon_min], [lat_max, lon_max]] of a north-up grid: the outer edges of its outer
    pixels, for any standard parallel and central meridian."""
    _require_north_up(transform, what)
    p = projection(crs, what)
    t = transform
    lon0, lat0 = to_degrees(p, t.c, t.f + rows * t.e)
    lon1, lat1 = to_degrees(p, t.c + cols * t.a, t.f)
    return [[float(lat0), float(lon0)], [float(lat1), float(lon1)]]


def require_contract_grid(crs, what):
    """Raise unless crs is a grid the engine reads as it is (CONTRACTS.md, section 1): degrees on
    the Mars 2000 sphere, or equirectangular with standard parallel 0 and central meridian 0 on it.
    Returns projection(crs)."""
    p = projection(crs, what)
    if abs(p["radius_m"] - R) > 0.5:
        raise TerrainBuildError("%s is on a sphere of %.0f m; the contract needs the Mars 2000 sphere "
                                "(%.0f m)" % (what, p["radius_m"], R))
    if p["prime_meridian"] != 0:
        raise TerrainBuildError("%s has prime meridian %g; the contract needs 0" % (what, p["prime_meridian"]))
    if p["kind"] == "eqc":
        off = []
        if abs(p["lat_ts"]) > 1e-9:
            off.append("standard parallel %g" % p["lat_ts"])
        if abs(p["lon_0"]) > 1e-9:
            off.append("central meridian %g" % p["lon_0"])
        if abs(p["lat_0"]) > 1e-9:
            off.append("latitude of origin %g" % p["lat_0"])
        if p["x_0"] or p["y_0"]:
            off.append("false easting/northing %g/%g m" % (p["x_0"], p["y_0"]))
        if off:
            raise TerrainBuildError("%s is equirectangular with %s, but the contract grid has standard "
                                    "parallel 0 and central meridian 0; resample it first" % (what, ", ".join(off)))
    return p


# ---------------------------------------------------------------- windows and grids

def _pixel_span(crs, transform, lat_min, lon_min, lat_max, lon_max, what):
    _require_north_up(transform, what)
    p = projection(crs, what)
    xs, ys = to_map(p, [lon_min, lon_max], [lat_min, lat_max])
    t = transform
    col0 = math.floor((xs[0] - t.c) / t.a + EPS_PX)
    col1 = math.ceil((xs[1] - t.c) / t.a - EPS_PX)
    row0 = math.floor((t.f - ys[1]) / -t.e + EPS_PX)
    row1 = math.ceil((t.f - ys[0]) / -t.e - EPS_PX)
    return row0, col0, row1, col1


def box_window(crs, transform, rows, cols, lat_min, lon_min, lat_max, lon_max, clip=False, what="raster"):
    """(row0, col0, n_rows, n_cols): the whole pixels of a grid that cover a box in degrees.
    clip=True cuts the box down to the grid; otherwise a box reaching outside is refused."""
    row0, col0, row1, col1 = _pixel_span(crs, transform, lat_min, lon_min, lat_max, lon_max, what)
    if clip:
        row0, col0, row1, col1 = max(row0, 0), max(col0, 0), min(row1, rows), min(col1, cols)
        if row1 <= row0 or col1 <= col0:
            raise TerrainBuildError("%s: the box lat %.5f..%.5f, lon %.5f..%.5f lies outside the raster"
                                    % (what, lat_min, lat_max, lon_min, lon_max))
    elif row0 < 0 or col0 < 0 or row1 > rows or col1 > cols:
        raise TerrainBuildError("%s: the box lat %.5f..%.5f, lon %.5f..%.5f reaches outside the raster"
                                % (what, lat_min, lat_max, lon_min, lon_max))
    return row0, col0, row1 - row0, col1 - col0


def extend_grid(crs, transform, lat_min, lon_min, lat_max, lon_max, what="grid"):
    """(transform, rows, cols) of the grid with this transform's pixel size and alignment that
    covers the box: the same grid, extended or cut to the box."""
    row0, col0, row1, col1 = _pixel_span(crs, transform, lat_min, lon_min, lat_max, lon_max, what)
    return transform @ Affine.translation(col0, row0), row1 - row0, col1 - col0


def sample_grid(array, crs, transform, lat, lon):
    """Values of a grid at points (degrees), bilinear between pixel centres; NaN outside the grid
    and wherever one of the pixels used is NaN."""
    p = projection(crs)
    x, y = to_map(p, lon, lat)
    t = transform
    c = (x - t.c) / t.a - 0.5
    r = (y - t.f) / t.e - 0.5
    rows, cols = array.shape
    c0, r0 = np.floor(c).astype(np.int64), np.floor(r).astype(np.int64)
    fc, fr = c - c0, r - r0
    inside = (c >= -0.5) & (c <= cols - 0.5) & (r >= -0.5) & (r <= rows - 0.5)
    ca, cb = np.clip(c0, 0, cols - 1), np.clip(c0 + 1, 0, cols - 1)
    ra, rb = np.clip(r0, 0, rows - 1), np.clip(r0 + 1, 0, rows - 1)
    top = array[ra, ca] * (1 - fc) + array[ra, cb] * fc
    bottom = array[rb, ca] * (1 - fc) + array[rb, cb] * fc
    return np.where(inside, top * (1 - fr) + bottom * fr, np.nan)


def pixel_size_m(crs, transform, rows):
    """(north-south pixel size in metres, east-west pixel size in metres for each row) of a
    north-up grid on the sphere."""
    p = projection(crs)
    t = transform
    lat = to_degrees(p, t.c, t.f + (np.arange(rows) + 0.5) * t.e)[1]
    if p["kind"] == "geographic":
        return math.radians(-t.e) * p["radius_m"], math.radians(t.a) * p["radius_m"] * np.cos(np.radians(lat))
    return -t.e, t.a / math.cos(math.radians(p["lat_ts"])) * np.cos(np.radians(lat))


# ---------------------------------------------------------------- GeoTIFF tiles

def write_geotiff(path, array, crs, transform):
    """One float32 GeoTIFF, NaN = no data, lossless deflate compression."""
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    a = np.asarray(array, dtype="float32")
    profile = dict(driver="GTiff", width=a.shape[1], height=a.shape[0], count=1, dtype="float32",
                   crs=crs, transform=transform, nodata=float("nan"), compress="deflate", predictor=3)
    if min(a.shape) >= 256:
        profile.update(tiled=True, blockxsize=256, blockysize=256)
    with rasterio.open(path, "w", **profile) as dst:
        dst.write(a, 1)


def write_tiles(array, crs, transform, root, folder, stem, tile_px=TILE_PX):
    """Write a grid as GeoTIFF tiles of at most tile_px x tile_px into root/folder/. Returns one dict
    per tile for terrain.json: file (relative to root), bounds, rows, cols, pixel_sha256."""
    root = Path(root)
    rows, cols = array.shape
    tiles = []
    for i, r0 in enumerate(range(0, rows, tile_px)):
        for k, c0 in enumerate(range(0, cols, tile_px)):
            block = np.asarray(array[r0:r0 + tile_px, c0:c0 + tile_px], dtype="float32")
            name = "%s/%s_r%02d_c%02d.tif" % (folder, stem, i, k)
            t = transform @ Affine.translation(c0, r0)
            write_geotiff(root / name, block, crs, t)
            tiles.append({"file": name, "bounds": degree_bounds(crs, t, *block.shape, what=name),
                          "rows": int(block.shape[0]), "cols": int(block.shape[1]),
                          "pixel_sha256": array_sha256(block)})
    return tiles
