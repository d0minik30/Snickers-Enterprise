"""The 20 m CTX source of the engine terrain (ctx_20m), built by fetch_terrain.py:

- the USGS TRN CTX DTM (soc_008) where it exists, unchanged except in its outer 1 km;
- around it the JPL "Mars 2020 Science Investigation CTX DEM Mosaic", resampled onto the soc_008
  grid, shifted to soc_008's level, and cleaned of stereo blunders: cells that stick out of their
  neighbourhood or make impossible steps, and areas thick with them, are replaced by the
  MOLA-HRSC blend shifted to the surrounding CTX level, faded in over 400 m;
- cut to the 80 x 80 km box and to where CTX has data, as one rectangle without holes.

Without a JPL product it is soc_008 alone.
"""
import numpy as np
import rasterio
from affine import Affine
from rasterio.warp import Resampling, reproject
from scipy import ndimage

from terrain_crops import hole_free_window, read_float_window
from terrain_io import R, TerrainBuildError, extend_grid, projection, require_contract_grid
from terrain_offsets import median_offset

SPIKE_M = 15.0            # a cell this far from the median of its 7 x 7 neighbourhood is a blunder
MEDIAN_CELLS = 7
MAX_STEP_DEG = 60.0       # steeper than this between 20 m neighbours is not real terrain
DENSITY_CELLS = 25        # where more than BAD_DENSITY of a 25 x 25 window is bad ...
BAD_DENSITY = 0.02
GROW_AREA_CELLS = 12      # ... the whole area is replaced, plus 12 cells (240 m) around it
GROW_BAD_CELLS = 2        # single bad cells are replaced with 2 cells around them
ROUNDS = 10               # replace again until no step is steeper than MAX_STEP_DEG
OFFSET_SIGMA_CELLS = 25   # the replacement follows the surrounding level, smoothed over ~500 m
FILL_FADE_M = 400.0       # and fades into the kept heights over 400 m
FEATHER_M = 1000.0        # soc_008 is blended into the JPL mosaic over its outer 1 km

SOC, JPL, JPL_REPLACED = 1, 2, 3     # source codes of the ctx_20m cells (for the report)


def row_spacing(transform, rows):
    """(north-south pixel size in m, east-west pixel size in m for each row) of a grid on the
    contract's equirectangular projection (standard parallel 0)."""
    lat = np.degrees((transform.f + (np.arange(rows) + 0.5) * transform.e) / R)
    return abs(transform.e), transform.a * np.cos(np.radians(lat))


def _steps(z, dy, dx):
    with np.errstate(invalid="ignore"):
        east = np.degrees(np.arctan(np.abs(np.diff(z, axis=1)) / np.asarray(dx)[:, None]))
        south = np.degrees(np.arctan(np.abs(np.diff(z, axis=0)) / dy))
    return east, south


def steep_mask(z, dy, dx, limit_deg=MAX_STEP_DEG):
    """Cells with a neighbour (north, south, east or west) at a slope steeper than limit_deg."""
    east, south = _steps(z, dy, dx)
    with np.errstate(invalid="ignore"):
        e, s = east > limit_deg, south > limit_deg
    m = np.zeros(z.shape, bool)
    m[:, :-1] |= e
    m[:, 1:] |= e
    m[:-1, :] |= s
    m[1:, :] |= s
    return m


def steepest_step_deg(z, dy, dx):
    """The steepest slope between two neighbouring cells, in degrees."""
    east, south = _steps(z, dy, dx)
    return float(max(np.nanmax(east), np.nanmax(south)))


def spike_mask(z, fill):
    """Cells more than SPIKE_M from the median of their 7 x 7 neighbourhood. No-data cells take
    `fill` (an array or a number) for the median."""
    zz = np.where(np.isfinite(z), z, fill)
    zz = np.where(np.isfinite(zz), zz, np.nanmedian(z))
    med = ndimage.median_filter(zz.astype("float32"), size=MEDIAN_CELLS, mode="nearest")
    with np.errstate(invalid="ignore"):
        return np.isfinite(z) & (np.abs(z - med) > SPIKE_M)


def blunder_mask(z, dy, dx, fill=np.nan):
    """The cells to replace: spikes and impossible steps with a 2-cell margin, and every area where
    they are dense, with a 12-cell margin."""
    bad = spike_mask(z, fill) | steep_mask(z, dy, dx)
    density = ndimage.uniform_filter(bad.astype("float32"), size=DENSITY_CELLS, mode="constant")
    area = ndimage.binary_dilation(density > BAD_DENSITY, iterations=GROW_AREA_CELLS)
    near = ndimage.binary_dilation(bad, iterations=GROW_BAD_CELLS)
    return (area | near) & np.isfinite(z)


def fill_from(z, hole, beneath, dy, dx):
    """z with the hole cells replaced by `beneath` shifted to the level of the surrounding z (z minus
    beneath, smoothed over the good cells), faded into the kept heights over FILL_FADE_M."""
    out = np.array(z, dtype=np.float64, copy=True)
    if not hole.any():
        return out
    good = np.isfinite(z) & ~hole & np.isfinite(beneath)
    w = ndimage.gaussian_filter(good.astype(np.float64), OFFSET_SIGMA_CELLS)
    num = ndimage.gaussian_filter(np.where(good, z - beneath, 0.0), OFFSET_SIGMA_CELLS)
    fill = beneath + num / (w + 0.01)
    dist = ndimage.distance_transform_edt(~hole, sampling=(dy, float(np.mean(dx))))
    keep = np.clip(dist / FILL_FADE_M, 0.0, 1.0)
    mix = np.isfinite(z) & ~hole & (keep < 1.0)
    out[mix] = keep[mix] * z[mix] + (1.0 - keep[mix]) * fill[mix]
    out[hole] = fill[hole]
    return out


def clean_blunders(z, beneath, dy, dx, extra_hole=None):
    """(cleaned z, replaced cells, report). The blunder mask (plus extra_hole, e.g. small gaps) is
    filled from `beneath`; where a step is still impossible, the hole grows and is filled again."""
    hole = blunder_mask(z, dy, dx, fill=beneath)
    first = int(hole.sum())
    if extra_hole is not None:
        hole |= extra_hole
    for rounds in range(1, ROUNDS + 1):
        out = fill_from(z, hole, beneath, dy, dx)
        steep = steep_mask(out, dy, dx)
        if not steep.any():
            break
        hole |= ndimage.binary_dilation(steep, iterations=GROW_BAD_CELLS) & (np.isfinite(z) | hole)
    else:
        raise TerrainBuildError("cleaning the JPL mosaic did not converge: %d cells still have steps over "
                                "%g deg after %d rounds" % (int(steep.sum()), MAX_STEP_DEG, ROUNDS))
    return out, hole, {"rounds": rounds, "blunder_cells_first_pass": first, "replaced_cells": int(hole.sum())}


def feather(top, under, dy, dx, width_m=FEATHER_M):
    """`top` where it has data, blended (smoothstep) into `under` over its outer width_m; `under`
    elsewhere."""
    valid = np.isfinite(top)
    dist = ndimage.distance_transform_edt(valid, sampling=(dy, float(np.mean(dx))))
    w = np.clip(dist / width_m, 0.0, 1.0)
    w = w * w * (3.0 - 2.0 * w)
    out = np.where(valid, top, under).astype(np.float64)
    both = valid & np.isfinite(under) & (w < 1.0)
    out[both] = w[both] * top[both] + (1.0 - w[both]) * under[both]
    return out


def _interior_gaps(valid):
    """No-data areas that don't touch the grid's border: gaps inside a mosaic, to be filled."""
    labels, n = ndimage.label(~valid)
    if n == 0:
        return np.zeros(valid.shape, bool)
    border = np.unique(np.concatenate([labels[0], labels[-1], labels[:, 0], labels[:, -1]]))
    return (labels > 0) & ~np.isin(labels, border)


def build_ctx(soc_path, jpl_path, blend, box, log=print):
    """The ctx_20m grid. blend: {"array", "crs", "transform"} of the MOLA-HRSC window (used to fill
    blunders); box: (lat_min, lon_min, lat_max, lon_max) to cover. Returns {"array" (float32),
    "crs", "transform", "codes" (uint8: 1 soc_008, 2 JPL, 3 JPL replaced from the blend),
    "report"}."""
    with rasterio.open(soc_path) as src:
        require_contract_grid(src.crs, "soc_008")
        soc_crs, soc_t = src.crs, src.transform
        soc = read_float_window(src, (0, 0, src.height, src.width))
    if np.isnan(soc).any():
        raise TerrainBuildError("soc_008 has %d cells without data" % int(np.isnan(soc).sum()))
    if jpl_path is None:
        log("  CTX: soc_008 alone, %d x %d px" % soc.shape[::-1])
        return {"array": soc, "crs": soc_crs, "transform": soc_t, "codes": np.full(soc.shape, SOC, "uint8"),
                "report": {"products": ["soc_008"]}}

    t, rows, cols = extend_grid(soc_crs, soc_t, *box)
    r_off, c_off = round((soc_t.f - t.f) / t.e), round((soc_t.c - t.c) / t.a)
    if r_off < 0 or c_off < 0 or r_off + soc.shape[0] > rows or c_off + soc.shape[1] > cols:
        raise TerrainBuildError("soc_008 does not lie inside the CTX box %s" % (box,))
    big_soc = np.full((rows, cols), np.nan, "float32")
    big_soc[r_off:r_off + soc.shape[0], c_off:c_off + soc.shape[1]] = soc
    log("  CTX: target grid %d x %d px of 20 m (soc_008 grid, extended to the box)" % (cols, rows))

    jpl = np.full((rows, cols), np.nan, "float32")
    with rasterio.open(jpl_path) as src:
        p = projection(src.crs, "JPL mosaic")
        log("  CTX: JPL mosaic is equirectangular with standard parallel %g, central meridian %g: "
            "resampling it (bilinear) onto the soc_008 grid" % (p["lat_ts"], p["lon_0"]))
        reproject(rasterio.band(src, 1), jpl, src_nodata=src.nodata, dst_transform=t, dst_crs=soc_crs,
                  dst_nodata=np.nan, resampling=Resampling.bilinear)
    jpl[~(jpl > -1e30)] = np.nan
    beneath = np.full((rows, cols), np.nan, "float32")
    reproject(np.asarray(blend["array"], dtype="float32"), beneath, src_transform=blend["transform"],
              src_crs=blend["crs"], src_nodata=np.nan, dst_transform=t, dst_crs=soc_crs, dst_nodata=np.nan,
              resampling=Resampling.bilinear)
    if np.isnan(beneath).any():
        raise TerrainBuildError("the MOLA-HRSC window does not cover the CTX box")

    jpl_offset, jpl_sigma, jpl_n = median_offset(big_soc, jpl)
    jpl = jpl + np.float32(jpl_offset)
    log("  CTX: JPL mosaic shifted %+.2f m to soc_008 (spread %.2f m over %d cells)" % (jpl_offset, jpl_sigma, jpl_n))
    blend_offset, blend_sigma, blend_n = median_offset(jpl, beneath)
    beneath = beneath + np.float32(blend_offset)

    dy, dx = row_spacing(t, rows)
    gaps = _interior_gaps(np.isfinite(jpl))
    clean, replaced, clean_report = clean_blunders(jpl.astype(np.float64), beneath.astype(np.float64), dy, dx,
                                                   extra_hole=gaps)
    log("  CTX: replaced %d JPL cells (%.2f %%) from the blend in %d round(s); %d were interior gaps"
        % (int(replaced.sum()), 100.0 * replaced.sum() / max(1, np.isfinite(jpl).sum()), clean_report["rounds"],
           int(gaps.sum())))

    merged = feather(big_soc.astype(np.float64), clean, dy, dx, FEATHER_M)
    codes = np.zeros((rows, cols), "uint8")
    codes[np.isfinite(clean)] = JPL
    codes[replaced] = JPL_REPLACED
    codes[np.isfinite(big_soc)] = SOC
    r0, c0, r1, c1 = hole_free_window(np.isfinite(merged))
    trimmed = {"north_px": r0, "south_px": rows - r1, "west_px": c0, "east_px": cols - c1}
    log("  CTX: cut to the rectangle with data everywhere: %s" %
        (", ".join("%d px off the %s" % (v, k[:-3]) for k, v in trimmed.items() if v) or "nothing cut"))
    out_t = t @ Affine.translation(c0, r0)
    z = merged[r0:r1, c0:c1].astype("float32")
    codes = codes[r0:r1, c0:c1]
    dy2, dx2 = row_spacing(out_t, z.shape[0])
    report = {"products": ["soc_008", "jpl_m20"], "box_px": [rows, cols], "trimmed": trimmed,
              "jpl_offset_to_soc_m": round(jpl_offset, 3), "jpl_offset_spread_m": round(jpl_sigma, 3),
              "jpl_offset_cells": jpl_n, "blend_offset_to_jpl_m": round(blend_offset, 3),
              "blend_offset_spread_m": round(blend_sigma, 3), "cleaning": clean_report,
              "interior_gap_cells": int(gaps.sum()),
              "share_pct": {name: round(100.0 * float((codes == code).mean()), 2)
                            for name, code in (("soc_008", SOC), ("jpl", JPL), ("jpl_replaced_from_blend", JPL_REPLACED))},
              "steepest_step_deg": round(steepest_step_deg(z, dy2, dx2), 2),
              "feather_m": FEATHER_M, "fill_fade_m": FILL_FADE_M}
    return {"array": z, "crs": soc_crs, "transform": out_t, "codes": codes, "report": report}
