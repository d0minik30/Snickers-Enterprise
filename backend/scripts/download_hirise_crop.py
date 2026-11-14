import math
import os
from pathlib import Path
import rasterio
from rasterio.windows import from_bounds

MARS_RADIUS_M = 3396190.0

def deg_to_m(deg_lat, deg_lon):
    return deg_lon * (math.pi / 180.0) * MARS_RADIUS_M, deg_lat * (math.pi / 180.0) * MARS_RADIUS_M

url = "https://planetarymaps.usgs.gov/mosaic/mars2020_trn/HiRISE/JEZ_hirise_soc_006_DTM_MOLAtopography_DeltaGeoid_1m_Eqc_latTs0_lon0_blend40.tif"
out_dir = Path("backend/data_local/terrain/hirise_1m")
out_dir.mkdir(parents=True, exist_ok=True)
out_file = out_dir / "jezero_hirise_landing_1m.tif"

print(f"Opening remote dataset: {url}")
try:
    with rasterio.open(url) as src:
        print("Connected to remote HiRISE GeoTIFF!")
        print(f"CRS: {src.crs}, Dimensions: {src.width}x{src.height}, Bounds: {src.bounds}")
        
        # 5x5 km box centered on landing site (18.4447 N, 77.4508 E)
        center_x, center_y = deg_to_m(18.4447, 77.4508)
        half_width_m = 2500.0
        
        min_x = max(center_x - half_width_m, src.bounds.left)
        max_x = min(center_x + half_width_m, src.bounds.right)
        min_y = max(center_y - half_width_m, src.bounds.bottom)
        max_y = min(center_y + half_width_m, src.bounds.top)
        
        print(f"Target crop in projection metres: X [{min_x}, {max_x}], Y [{min_y}, {max_y}]")
        window = from_bounds(min_x, min_y, max_x, max_y, src.transform)
        print(f"Window: {window}")
        
        data = src.read(1, window=window)
        transform = src.window_transform(window)
        
        profile = src.profile.copy()
        profile.update({
            "height": data.shape[0],
            "width": data.shape[1],
            "transform": transform,
            "compress": "lzw"
        })
        
        with rasterio.open(out_file, "w", **profile) as dst:
            dst.write(data, 1)
            
        print(f"Successfully saved HiRISE crop to {out_file} (shape: {data.shape})")
        print(f"Elevation min: {data.min()}, max: {data.max()}")
except Exception as e:
    print(f"Error: {e}")
