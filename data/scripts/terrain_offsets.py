"""The offset step of fetch_terrain.py: how far one terrain source sits above or below another,
over their whole overlap and where they meet along each edge.

The engine adds a source's vertical_offset_m to its heights and blends a source into the one
beneath it along its edge (backend/CONTRACTS.md, section 1); these numbers set and report that.
"""
import math

import numpy as np
from rasterio.warp import Resampling, reproject

from terrain_io import R, TerrainBuildError, degree_bounds, sample_grid


def median_offset(a, b):
    """(median of a - b, robust spread 1.4826 * MAD, number of points), where both are finite."""
    d = np.asarray(a, dtype=np.float64) - np.asarray(b, dtype=np.float64)
    d = d[np.isfinite(d)]
    if d.size == 0:
        raise TerrainBuildError("the two grids have no overlap to measure an offset on")
    median = float(np.median(d))
    return median, float(1.4826 * np.median(np.abs(d - median))), int(d.size)


def overlap_offset(fine, fine_crs, fine_t, coarse, coarse_crs, coarse_t):
    """The offset to add to a fine grid so it matches a coarse one: the fine grid is averaged onto
    the coarse cells it covers completely, then median_offset(coarse, fine average)."""
    avg = np.full(coarse.shape, np.nan, "float32")
    reproject(np.asarray(fine, dtype="float32"), avg, src_transform=fine_t, src_crs=fine_crs, src_nodata=np.nan,
              dst_transform=coarse_t, dst_crs=coarse_crs, dst_nodata=np.nan, resampling=Resampling.average)
    (f_lat0, f_lon0), (f_lat1, f_lon1) = degree_bounds(fine_crs, fine_t, *fine.shape)
    (c_lat0, c_lon0), (c_lat1, c_lon1) = degree_bounds(coarse_crs, coarse_t, *coarse.shape)
    rows, cols = coarse.shape
    dlat, dlon = (c_lat1 - c_lat0) / rows, (c_lon1 - c_lon0) / cols
    tol = 1e-9
    top = c_lat1 - np.arange(rows) * dlat               # northern edge of each coarse row
    left = c_lon0 + np.arange(cols) * dlon              # western edge of each coarse column
    rows_in = (top <= f_lat1 + tol) & (top - dlat >= f_lat0 - tol)
    cols_in = (left >= f_lon0 - tol) & (left + dlon <= f_lon1 + tol)
    covered = rows_in[:, None] & cols_in[None, :]
    return median_offset(np.where(covered, coarse, np.nan), np.where(covered, avg, np.nan))


def _stats(d):
    d = d[np.isfinite(d)]
    if d.size == 0:
        return {"median_m": None, "p05_m": None, "p95_m": None, "n": 0}
    return {"median_m": round(float(np.median(d)), 3), "p05_m": round(float(np.percentile(d, 5)), 3),
            "p95_m": round(float(np.percentile(d, 95)), 3), "n": int(d.size)}


def edge_offsets(upper, upper_crs, upper_t, lower, lower_crs, lower_t, band_m=600.0, lower_offset_m=0.0):
    """Where a rectangular source (upper) meets the source beneath it (lower): lower is sampled
    bilinearly at upper's pixel centres within band_m of each edge, and upper - (lower +
    lower_offset_m) is summarised for the north, south, east and west edges and for all of them.
    The median over all edges is the vertical_offset_m that makes the lower source meet the upper
    one; the engine's check_terrain.py looks at the join 3 coarse cells (600 m for 200 m data) deep.
    """
    rows, cols = upper.shape
    (lat0, lon0), (lat1, lon1) = degree_bounds(upper_crs, upper_t, rows, cols)
    dlat, dlon = (lat1 - lat0) / rows, (lon1 - lon0) / cols
    lats = lat1 - (np.arange(rows) + 0.5) * dlat
    lons = lon0 + (np.arange(cols) + 0.5) * dlon
    # pixels whose centre is within band_m of an edge; listed per edge, never as full-size masks,
    # so a 1 m grid of 10^8 pixels costs only its band
    n_ns = int(min(rows, max(0, math.floor(band_m / (math.radians(dlat) * R) - 0.5) + 1)))
    east_west_m = math.radians(dlon) * R * np.cos(np.radians(lats))          # pixel width per row
    n_ew = np.clip(np.floor(band_m / east_west_m - 0.5).astype(np.int64) + 1, 0, cols)
    all_cols = np.arange(cols)
    west_r = np.repeat(np.arange(rows), n_ew)
    west_c = np.concatenate([np.arange(k) for k in n_ew]) if n_ew.sum() else np.zeros(0, np.int64)
    sides = {"north": (np.repeat(np.arange(n_ns), cols), np.tile(all_cols, n_ns)),
             "south": (np.repeat(np.arange(rows - n_ns, rows), cols), np.tile(all_cols, n_ns)),
             "west": (west_r, west_c), "east": (west_r, cols - 1 - west_c)}
    out = {"band_m": band_m}
    flat, diffs = [], []
    for side, (rr, cc) in sides.items():
        low = sample_grid(lower, lower_crs, lower_t, lats[rr], lons[cc]) + lower_offset_m
        d = upper[rr, cc].astype(np.float64) - low
        out[side] = _stats(d)
        flat.append(rr.astype(np.int64) * cols + cc)
        diffs.append(d)
    _, first = np.unique(np.concatenate(flat), return_index=True)     # corners belong to two edges
    out["all"] = _stats(np.concatenate(diffs)[first])
    return out


def whole_overlap(upper, upper_crs, upper_t, lower, lower_crs, lower_t, lower_offset_m=0.0, step=10):
    """upper - (lower + lower_offset_m) over the whole of upper (every step-th pixel), summarised."""
    rows, cols = upper.shape
    (lat0, lon0), (lat1, lon1) = degree_bounds(upper_crs, upper_t, rows, cols)
    r = np.arange(step // 2, rows, step)
    c = np.arange(step // 2, cols, step)
    lat = lat1 - (r + 0.5) * (lat1 - lat0) / rows
    lon = lon0 + (c + 0.5) * (lon1 - lon0) / cols
    la, lo = np.meshgrid(lat, lon, indexing="ij")
    low = sample_grid(lower, lower_crs, lower_t, la.ravel(), lo.ravel()) + lower_offset_m
    return _stats(upper[np.ix_(r, c)].ravel() - low)
