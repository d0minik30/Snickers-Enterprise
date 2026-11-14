"""Base and mission sites for route finding, checked against cost_grid.json.

Writes data/output/places.geojson (Points, [lon, lat] degrees on the Mars 2000 sphere,
for L.geoJSON) and checks that every place lies inside the cost grid on a cell with
data, so a route can start or end there. It reads the finished grid, so run it last:
  python data/scripts/make_places.py
"""
import json
import math
from pathlib import Path

DATA_DIR = Path(__file__).resolve().parent.parent
GRID_PATH = DATA_DIR / "output" / "cost_grid.json"
OUT_PATH = DATA_DIR / "output" / "places.geojson"
SOURCE = "NASA Mars Trek, Jezero Crater Features and Landforms bookmark"

# name, type ("base" or "mission_site"), lat, lon (degrees, east-positive longitude)
PLACES = [
    ("Base (Perseverance landing site)", "base", 18.4447, 77.4508),
    ("Western Delta Deposit", "mission_site", 18.5050, 77.3643),
    ("Western Breach", "mission_site", 18.4995, 77.2874),
    ("Northern Delta Deposit", "mission_site", 18.6314, 77.5456),
    ("Western Inflow Channel", "mission_site", 18.5819, 77.1995),
]


def grid_cell(grid, lat, lon):
    """(row, col) of the cost-grid cell that holds the point, or None if it is outside the grid."""
    (lat_min, lon_min), (lat_max, lon_max) = grid["bounds"]
    row = math.floor((lat_max - lat) / (lat_max - lat_min) * grid["rows"])
    col = math.floor((lon - lon_min) / (lon_max - lon_min) * grid["cols"])
    if 0 <= row < grid["rows"] and 0 <= col < grid["cols"]:
        return row, col
    return None


def locate_places(grid, places):
    """For each place: its grid cell, slope and sand, and a problem if no route could reach it."""
    report = []
    for name, _kind, lat, lon in places:
        cell = grid_cell(grid, lat, lon)
        if cell is None:
            report.append({"name": name, "row": None, "col": None, "slope": None, "sand": None,
                           "problem": "outside the grid"})
            continue
        row, col = cell
        slope = grid["slope_deg"][row][col]
        report.append({"name": name, "row": row, "col": col, "slope": slope,
                       "sand": grid["sand"][row][col],
                       "problem": "on a cell with no data" if slope is None else None})
    return report


def places_geojson():
    return {
        "type": "FeatureCollection",
        "features": [
            {"type": "Feature",
             "properties": {"name": name, "type": kind, "source": SOURCE},
             "geometry": {"type": "Point", "coordinates": [lon, lat]}}
            for name, kind, lat, lon in PLACES
        ],
    }


def main():
    if not GRID_PATH.exists():
        raise SystemExit("Missing %s. Run process_dem.py and add_sand_to_grid.py first." % GRID_PATH)
    grid = json.loads(GRID_PATH.read_text(encoding="utf-8"))
    if "sand" not in grid:
        raise SystemExit("cost_grid.json has no sand layer yet. Run add_sand_to_grid.py first.")

    with open(OUT_PATH, "w", encoding="utf-8", newline="\n") as out:
        out.write(json.dumps(places_geojson(), indent=2) + "\n")

    report = locate_places(grid, PLACES)
    print("%-34s %5s %5s %7s %5s" % ("place (cost grid cell)", "row", "col", "slope", "sand"))
    for item in report:
        print("%-34s %5s %5s %7s %5s" % (
            item["name"],
            "-" if item["row"] is None else item["row"],
            "-" if item["col"] is None else item["col"],
            "-" if item["slope"] is None else "%.1f" % item["slope"],
            "-" if item["sand"] is None else item["sand"]))
    print("wrote %s (%.1f KB)" % (OUT_PATH.relative_to(DATA_DIR.parent).as_posix(),
                                  OUT_PATH.stat().st_size / 1024))
    problems = ["%s: %s" % (item["name"], item["problem"]) for item in report if item["problem"]]
    if problems:
        raise SystemExit("Places no route can reach: " + "; ".join(problems))


if __name__ == "__main__":
    main()
