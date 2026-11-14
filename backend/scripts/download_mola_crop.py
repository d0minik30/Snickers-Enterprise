import os
from pathlib import Path
import rasterio
from rasterio.windows import from_bounds

url = "https://planetarymaps.usgs.gov/mosaic/Mars/HRSC_MOLA_Blend/Mars_HRSC_MOLA_BlendDEM_Global_200mp_v2.tif"
out_dir = Path("backend/data_local/terrain/mola_200m")
out_dir.mkdir(parents=True, exist_ok=True)
out_file = out_dir / "jezero_mola_hrsc_200m.tif"

print(f"Opening remote dataset: {url}")
try:
    with rasterio.open(url) as src:
        print("Connected to remote GeoTIFF!")
        print(f"CRS: {src.crs}, Dimensions: {src.width}x{src.height}")
        
        # Jezero 80x80km bounds: lon 76.75..78.15, lat 17.75..19.15
        # Note: in geographic CRS, bounds are (min_lon, min_lat, max_lon, max_lat)
        window = from_bounds(76.75, 17.75, 78.15, 19.15, src.transform)
        print(f"Reading window: {window}")
        
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
            
        print(f"Successfully saved crop to {out_file} (shape: {data.shape})")
except Exception as e:
    print(f"Error: {e}")
