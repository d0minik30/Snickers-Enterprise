"""Sand (eolian bedform) polygons for the Jezero box.

Input (download into data/raw/, which is not committed):
  sim3464_database.zip - USGS SIM 3464, "Geologic map of Jezero crater and the Nili
  Planum region, Mars" (Sun and Stack, 2020). The script reads layer GeoUnits_v1 of
  the file geodatabase Nili.gdb straight from the ZIP; nothing needs extracting.

Output (data/output/):
  sand.geojson - polygons of unit Aeb ("Eolian bedform unit"), clipped to the Jezero
  box, as [lon, lat] degrees on the Mars 2000 sphere, for L.geoJSON

Run from the repo root:  python data/scripts/process_sand.py
"""
import warnings
from pathlib import Path

import geopandas as gpd
from shapely.geometry import box

DATA_DIR = Path(__file__).resolve().parent.parent
ZIP_PATH = DATA_DIR / "raw" / "sim3464_database.zip"
GDB_IN_ZIP = "sim3464_JezeroNili_FINAL/Geodatabase/Nili.gdb"
UNITS_LAYER = "GeoUnits_v1"
SAND_SYMBOL = "Aeb"  # "Eolian bedform unit"
OUT_PATH = DATA_DIR / "output" / "sand.geojson"

MARS_LONLAT = "+proj=longlat +R=3396190 +no_defs"
# Equal-area projection centred on the landing site, only used to report areas
MARS_EQUAL_AREA = "+proj=laea +lat_0=18.4447 +lon_0=77.4508 +R=3396190 +units=m +no_defs"

# Jezero box: 10 x 10 km around the Perseverance landing site (18.4447 N, 77.4508 E)
LON_MIN, LON_MAX = 77.362, 77.540
LAT_MIN, LAT_MAX = 18.360, 18.529

MAX_BYTES = 5 * 1024 * 1024  # every output must stay under 5 MB


def main():
    if not ZIP_PATH.exists():
        raise SystemExit("Missing %s. Download the USGS SIM 3464 database ZIP "
                         "(https://doi.org/10.3133/sim3464) and save it there." % ZIP_PATH)
    source = "/vsizip/%s/%s" % (ZIP_PATH.as_posix(), GDB_IN_ZIP)
    with warnings.catch_warnings():
        # GDAL notes that a polygon of another unit has over 100 rings and "may be slow"; harmless
        warnings.filterwarnings("ignore", message="organizePolygons", category=RuntimeWarning)
        units = gpd.read_file(source, layer=UNITS_LAYER, where="symbol = '%s'" % SAND_SYMBOL)
    if units.empty:
        raise SystemExit("No polygons with symbol %s in layer %s" % (SAND_SYMBOL, UNITS_LAYER))

    # The map is in Transverse Mercator (centre 77.5 E) on the same Mars sphere
    sand = units[["symbol", "name", "geometry"]].to_crs(MARS_LONLAT)
    sand["geometry"] = sand.geometry.make_valid()
    jezero_box = box(LON_MIN, LAT_MIN, LON_MAX, LAT_MAX)
    sand = gpd.clip(sand, jezero_box).explode(index_parts=False)
    sand = sand[(sand.geom_type == "Polygon") & ~sand.is_empty].reset_index(drop=True)

    OUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    OUT_PATH.unlink(missing_ok=True)
    sand.to_file(OUT_PATH, driver="GeoJSON", COORDINATE_PRECISION=6)

    area_km2 = sand.to_crs(MARS_EQUAL_AREA).area.sum() / 1e6
    box_km2 = gpd.GeoSeries([jezero_box], crs=MARS_LONLAT).to_crs(MARS_EQUAL_AREA).area.sum() / 1e6
    size = OUT_PATH.stat().st_size
    print("%s: %d features with symbol %s on the whole map" % (UNITS_LAYER, len(units), SAND_SYMBOL))
    print("clipped to the Jezero box: %d polygons, %.2f km2 (%.1f %% of the box)"
          % (len(sand), area_km2, 100 * area_km2 / box_km2))
    print("wrote %s (%.1f KB)" % (OUT_PATH.relative_to(DATA_DIR.parent).as_posix(), size / 1024))
    if size >= MAX_BYTES:
        raise SystemExit("%s is over the 5 MB limit" % OUT_PATH.name)


if __name__ == "__main__":
    main()
