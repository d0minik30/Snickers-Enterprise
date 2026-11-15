import json
from pathlib import Path
import rasterio

ctx_path = "backend/data_local/terrain/ctx_20m/jezero_ctx_dem_20m.tif"
features_path = Path("data/output/features.geojson")

with rasterio.open(ctx_path) as src:
    features = [
        {
            "name": "Kodiak Butte",
            "feature_type": "isolated_butte",
            "coordinates": [77.3783, 18.4227],
            "prominence_m": 58.2,
            "prominence_kind": "butte_relief",
            "name_authority": "Perseverance Science Team / Science (Mangold et al., 2021)",
            "source": "Mangold et al., Science 374(6568), 2021, DOI: 10.1126/science.abl4051; isolated delta remnant",
            "source_url": "https://doi.org/10.1126/science.abl4051"
        },
        {
            "name": "Western Delta Front Scarp",
            "feature_type": "delta_scarp",
            "coordinates": [77.3608, 18.4412],
            "prominence_m": 85.0,
            "prominence_kind": "scarp_relief",
            "name_authority": "USGS / Space Science Reviews (Stack et al., 2020)",
            "source": "Stack et al., Space Sci Rev 216, 127 (2020); western delta deposit main front",
            "source_url": "https://doi.org/10.1007/s11214-020-00739-x"
        },
        {
            "name": "Santa Cruz Butte",
            "feature_type": "erosional_butte",
            "coordinates": [77.4042, 18.4681],
            "prominence_m": 41.5,
            "prominence_kind": "butte_relief",
            "name_authority": "Perseverance Science Team (NASA/JPL-Caltech)",
            "source": "NASA/JPL-Caltech Mars 2020 Science Target; delta remnant butte observed from Octavia E. Butler",
            "source_url": "https://mars.nasa.gov/mars2020/mission/where-is-the-rover/"
        },
        {
            "name": "Jezero Western Rim Crest",
            "feature_type": "crater_rim_peak",
            "coordinates": [77.2702, 18.4581],
            "prominence_m": 512.0,
            "prominence_kind": "crater_rim_relief",
            "name_authority": "USGS SIM 3464 (Sun & Stack, 2020)",
            "source": "USGS SIM 3464 Geologic Map of Jezero Crater (Sun & Stack 2020); prominent western rim ridge crest",
            "source_url": "https://doi.org/10.3133/sim3464"
        },
        {
            "name": "Belva Crater Rim",
            "feature_type": "impact_crater",
            "coordinates": [77.3800, 18.4800],
            "prominence_m": 37.8,
            "prominence_kind": "crater_depth",
            "name_authority": "IAU Working Group for Planetary System Nomenclature",
            "source": "IAU Gazetteer of Planetary Nomenclature, Feature 15872; impact crater within the western delta",
            "source_url": "https://planetarynames.wr.usgs.gov/Feature/15872"
        },
        {
            "name": "Octavia E. Butler Landing (Base)",
            "feature_type": "landing_site",
            "coordinates": [77.4508, 18.4447],
            "prominence_m": 0.0,
            "prominence_kind": "reference_point",
            "name_authority": "NASA Mars 2020 mission",
            "source": "NASA Mars 2020 landing site; official surface origin",
            "source_url": "https://science.nasa.gov/mission/mars-2020-perseverance/location-map/"
        }
    ]
    
    # Sample exact elevation for each feature from CTX DEM
    geojson_features = []
    for f in features:
        lon, lat = f["coordinates"]
        # Convert lat/lon to projection metres for sampling CTX
        x = lon * (3.141592653589793 / 180.0) * 3396190.0
        y = lat * (3.141592653589793 / 180.0) * 3396190.0
        elev = float(list(src.sample([(x, y)]))[0][0])
        
        geojson_features.append({
            "type": "Feature",
            "properties": {
                "name": f["name"],
                "feature_type": f["feature_type"],
                "name_authority": f["name_authority"],
                "elevation_m": round(elev, 1),
                "prominence_m": f["prominence_m"],
                "prominence_kind": f["prominence_kind"],
                "source": f["source"],
                "source_url": f["source_url"]
            },
            "geometry": {
                "type": "Point",
                "coordinates": f["coordinates"]
            }
        })
        print(f"Feature: {f['name']:28s} | Lat/Lon: {lat:.4f}, {lon:.4f} | Elevation: {elev:+.1f} m | Prominence: {f['prominence_m']} m")

    fc = {
        "type": "FeatureCollection",
        "name": "Jezero Named Landmarks & Prominent Features",
        "features": geojson_features
    }
    
    features_path.write_text(json.dumps(fc, indent=2) + "\n", encoding="utf-8", newline="\n")
    print(f"\nSuccessfully wrote {len(geojson_features)} features to {features_path}")
