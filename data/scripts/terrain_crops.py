"""The crop steps of fetch_terrain.py (until 15 Nov 2026 backend/scripts/download_hirise_crop.py and
download_mola_crop.py, now removed): cut what the engine needs out of the official mosaics, on the
contract grid (backend/CONTRACTS.md, section 1), without resampling. Every failure raises
TerrainBuildError.
"""
from pathlib import Path

import numpy as np
import rasterio
from affine import Affine
from rasterio.errors import RasterioIOError
from rasterio.windows import Window

from terrain_io import USER_AGENT, TerrainBuildError, box_window, require_contract_grid

NODATA_BELOW = -1e30       # the USGS float DTMs mark no data with -3.4e38
MIN_KEPT_SHARE = 0.5       # refuse a crop if cutting away the no data would leave less than this


def read_float_window(src, window):
    """Band 1 of an open raster inside window = (row0, col0, rows, cols), as float32 metres with
    NaN for no data."""
    row0, col0, rows, cols = window
    z = src.read(1, window=Window(col0, row0, cols, rows)).astype("float32", copy=False)
    bad = ~np.isfinite(z) | (z < NODATA_BELOW)
    if src.nodata is not None and np.isfinite(src.nodata):
        bad |= z == np.float32(src.nodata)
    z[bad] = np.nan
    return z


def hole_free_window(valid, min_share=MIN_KEPT_SHARE):
    """(r0, c0, r1, c1): a rectangle of the mask with no False in it, found by shaving off, one line
    at a time, the side whose border line has the most no data. The engine blends a source into the
    one beneath only along its rectangle's edge; at a hole it would switch hard, so a source must
    have none."""
    r0, c0, r1, c1 = 0, 0, valid.shape[0], valid.shape[1]
    while r1 > r0 and c1 > c0:
        sides = {"north": int((~valid[r0, c0:c1]).sum()), "south": int((~valid[r1 - 1, c0:c1]).sum()),
                 "west": int((~valid[r0:r1, c0]).sum()), "east": int((~valid[r0:r1, c1 - 1]).sum())}
        worst = max(sides, key=sides.get)
        if sides[worst] == 0:
            break
        if worst == "north":
            r0 += 1
        elif worst == "south":
            r1 -= 1
        elif worst == "west":
            c0 += 1
        else:
            c1 -= 1
    kept = max(r1 - r0, 0) * max(c1 - c0, 0)
    if kept < min_share * valid.size or not valid[r0:r1, c0:c1].all():
        raise TerrainBuildError("the crop has no data inside it that can't be cut away along its edges "
                                "(%.0f %% of it would be left); the engine would switch through such holes "
                                "without blending" % (100.0 * kept / valid.size))
    return r0, c0, r1, c1


def crop_hirise(path, box, log=print):
    """The part of the HiRISE mosaic inside box = (lat_min, lon_min, lat_max, lon_max), cut back to
    where every pixel has data. Returns {"array" (float32), "crs", "transform", "window" (row0,
    col0, rows, cols in the mosaic), "trimmed" (pixels cut from each side)}."""
    name = Path(path).name
    with rasterio.open(path) as src:
        require_contract_grid(src.crs, name)
        window = box_window(src.crs, src.transform, src.height, src.width, *box, clip=True, what=name)
        z = read_float_window(src, window)
        crs = src.crs
        t = src.transform @ Affine.translation(window[1], window[0])
    r0, c0, r1, c1 = hole_free_window(np.isfinite(z))
    trimmed = {"north_px": r0, "south_px": z.shape[0] - r1, "west_px": c0, "east_px": z.shape[1] - c1}
    if any(trimmed.values()):
        log("  HiRISE: cut %s pixels of no data off the crop's edges" %
            ", ".join("%d %s" % (v, k[:-3]) for k, v in trimmed.items() if v))
    z = np.ascontiguousarray(z[r0:r1, c0:c1])
    return {"array": z, "crs": crs, "transform": t @ Affine.translation(c0, r0),
            "window": (window[0] + r0, window[1] + c0, r1 - r0, c1 - c0), "trimmed": trimmed}


def read_blend_window(url, box, what="MOLA-HRSC blend"):
    """A window of the global MOLA-HRSC blend, read over the network (HTTP range requests) instead
    of downloading the 11.4 GB file. Returns {"raw" (int16 as stored), "nodata", "crs", "transform",
    "window"}."""
    env = dict(GDAL_DISABLE_READDIR_ON_OPEN="EMPTY_DIR", GDAL_HTTP_USERAGENT=USER_AGENT,
               GDAL_HTTP_MAX_RETRY="5", GDAL_HTTP_RETRY_DELAY="2", CPL_VSIL_CURL_ALLOWED_EXTENSIONS=".tif")
    try:
        with rasterio.Env(**env), rasterio.open("/vsicurl/" + url) as src:
            require_contract_grid(src.crs, what)
            window = box_window(src.crs, src.transform, src.height, src.width, *box, what=what)
            raw = src.read(1, window=Window(window[1], window[0], window[3], window[2]))
            return {"raw": raw, "nodata": src.nodata, "crs": src.crs, "window": window,
                    "transform": src.transform @ Affine.translation(window[1], window[0])}
    except RasterioIOError as error:
        raise TerrainBuildError("reading the %s window from %s failed: %s" % (what, url, error)) from None


def blend_to_float(raw, nodata):
    """The blend's stored values as float32 metres, NaN for no data."""
    z = raw.astype("float32")
    if nodata is not None:
        z[raw == nodata] = np.nan
    return z
