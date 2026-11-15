import math
import numpy as np
import rasterio

MARS_RADIUS_M = 3396190.0

ctx_path = "backend/data_local/terrain/ctx_20m/jezero_ctx_dem_20m.tif"
mola_path = "backend/data_local/terrain/mola_200m/jezero_mola_hrsc_200m.tif"

def m_to_deg(xs, ys):
    conv = 180.0 / (math.pi * MARS_RADIUS_M)
    return np.asarray(xs) * conv, np.asarray(ys) * conv

with rasterio.open(ctx_path) as ctx_ds, rasterio.open(mola_path) as mola_ds:
    # North edge (row 0 in CTX)
    n_cols = ctx_ds.width
    sample_cols = np.arange(0, n_cols, 2)
    row_top = np.zeros_like(sample_cols)
    xs_top, ys_top = rasterio.transform.xy(ctx_ds.transform, row_top, sample_cols)
    lons_top, lats_top = m_to_deg(xs_top, ys_top)
    ctx_top = ctx_ds.read(1)[0, sample_cols]
    
    # South edge (row height-1 in CTX)
    row_bot = np.full_like(sample_cols, ctx_ds.height - 1)
    xs_bot, ys_bot = rasterio.transform.xy(ctx_ds.transform, row_bot, sample_cols)
    lons_bot, lats_bot = m_to_deg(xs_bot, ys_bot)
    ctx_bot = ctx_ds.read(1)[ctx_ds.height - 1, sample_cols]
    
    # West edge (col 0 in CTX)
    n_rows = ctx_ds.height
    sample_rows = np.arange(0, n_rows, 2)
    col_left = np.zeros_like(sample_rows)
    xs_left, ys_left = rasterio.transform.xy(ctx_ds.transform, sample_rows, col_left)
    lons_left, lats_left = m_to_deg(xs_left, ys_left)
    ctx_left = ctx_ds.read(1)[sample_rows, 0]
    
    # East edge (col width-1 in CTX)
    col_right = np.full_like(sample_rows, ctx_ds.width - 1)
    xs_right, ys_right = rasterio.transform.xy(ctx_ds.transform, sample_rows, col_right)
    lons_right, lats_right = m_to_deg(xs_right, ys_right)
    ctx_right = ctx_ds.read(1)[sample_rows, ctx_ds.width - 1]
    
    edges = {
        "North edge (18.72°N)": (lons_top, lats_top, ctx_top),
        "South edge (18.21°N)": (lons_bot, lats_bot, ctx_bot),
        "West edge (77.16°E)":  (lons_left, lats_left, ctx_left),
        "East edge (77.70°E)":  (lons_right, lats_right, ctx_right),
    }
    
    all_diffs = []
    
    print("=== CTX BOUNDARY STEP DISTRIBUTION (CTX minus MOLA-HRSC 200m) ===")
    print("Coordinates properly converted from Equirectangular metres to Mars degrees\n")
    
    for name, (lons, lats, ctx_vals) in edges.items():
        coords = list(zip(lons, lats))
        mola_vals = np.array([val[0] for val in mola_ds.sample(coords)])
        
        valid = (ctx_vals > -1e30) & (mola_vals > -1e30) & np.isfinite(ctx_vals) & np.isfinite(mola_vals)
        diff = ctx_vals[valid] - mola_vals[valid]
        all_diffs.append(diff)
        
        print(f"--- {name} ({len(diff)} samples) ---")
        print(f"  Mean difference:      {np.mean(diff):+.2f} m")
        print(f"  Median difference:    {np.median(diff):+.2f} m")
        print(f"  Std deviation:        {np.std(diff):.2f} m")
        print(f"  Mean absolute diff:   {np.mean(np.abs(diff)):.2f} m")
        print(f"  Min / Max:            {np.min(diff):+.2f} m / {np.max(diff):+.2f} m")
        p05, p25, p75, p95 = np.percentile(diff, [5, 25, 75, 95])
        print(f"  Percentiles (5%, 25%, 75%, 95%): [{p05:+.2f}, {p25:+.2f}, {p75:+.2f}, {p95:+.2f}] m\n")

    total_diff = np.concatenate(all_diffs)
    print("================ OVERALL BOUNDARY PERIMETER ================")
    print(f"Total perimeter sample points: {len(total_diff)}")
    print(f"  Mean difference:      {np.mean(total_diff):+.2f} m")
    print(f"  Median difference:    {np.median(total_diff):+.2f} m")
    print(f"  Std deviation:        {np.std(total_diff):.2f} m")
    print(f"  Mean absolute diff:   {np.mean(np.abs(total_diff)):.2f} m")
    print(f"  Min / Max:            {np.min(total_diff):+.2f} m / {np.max(total_diff):+.2f} m")
    p01, p05, p10, p25, p50, p75, p90, p95, p99 = np.percentile(total_diff, [1, 5, 10, 25, 50, 75, 90, 95, 99])
    print(f"  Percentiles:")
    print(f"    1%:  {p01:+.2f} m")
    print(f"    5%:  {p05:+.2f} m")
    print(f"    10%: {p10:+.2f} m")
    print(f"    25%: {p25:+.2f} m")
    print(f"    50%: {p50:+.2f} m (Median)")
    print(f"    75%: {p75:+.2f} m")
    print(f"    90%: {p90:+.2f} m")
    print(f"    95%: {p95:+.2f} m")
    print(f"    99%: {p99:+.2f} m")
