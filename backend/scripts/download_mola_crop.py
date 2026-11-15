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
        
        # +/- 100 km around Perseverance landing site (18.4447 N, 77.4508 E)
        # Lat range: 16.70 to 20.20
        # Lon range: 75.60 to 79.30 (~210 x 210 km)
        min_lon, min_lat, max_lon, max_lat = 75.60, 16.70, 79.30, 20.20
        window = from_bounds(min_lon, min_lat, max_lon, max_lat, src.transform)
        print(f"Reading window for +/- 100km: {window}")
        
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
            
        print(f"Successfully saved +/-100km crop to {out_file} (shape: {data.shape})")
        print(f"File size: {out_file.stat().st_size / 1024:.1f} KB")
except Exception as e:
    print(f"Error: {e}")
