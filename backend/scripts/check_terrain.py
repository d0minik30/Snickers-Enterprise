"""Check the terrain folder: what is in it, problems with tiles, and height steps where
sources join (CTX and HiRISE may sit on different zero levels).

Run from backend/:
    .venv\\Scripts\\python scripts\\check_terrain.py                  (Windows)
    .venv/bin/python scripts/check_terrain.py                       (macOS, Linux)

Options: --terrain DIR (default: $MARS_TERRAIN_DIR or backend/data_local/terrain/),
--write-manifest (save the manifest the engine built for the single CTX file as terrain.json).
Exits with status 1 if it finds a problem to report to Person 2.
"""
import argparse
import json
import sys
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from marsloc.terrain import Terrain  # noqa: E402
from marsloc.terrain.manifest import MANIFEST_NAME  # noqa: E402
from marsloc.terrain.seams import compare_sources  # noqa: E402


def main():
    parser = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    parser.add_argument("--terrain", type=Path, default=None, help="terrain folder")
    parser.add_argument("--write-manifest", action="store_true",
                        help="save the self-built manifest as terrain.json")
    args = parser.parse_args()

    terrain = Terrain.open(args.terrain)
    root = terrain.manifest.root
    has_manifest = (root / MANIFEST_NAME).exists()
    print("terrain folder: %s" % root)
    print("manifest: %s" % ("terrain.json" if has_manifest else "none; built for the single CTX file"))

    for source in terrain.sources:
        (lat_min, lon_min), (lat_max, lon_max) = source.bounds
        print("\nsource %s: priority %d, cell %.2f m, %d tile(s), vertical_offset_m %+g"
              % (source.id, source.priority, source.cell_m, len(source.tiles), source.vertical_offset_m))
        print("  bounds [[%.7f, %.7f], [%.7f, %.7f]]" % (lat_min, lon_min, lat_max, lon_max))
        pixels = valid = 0
        low, high = np.inf, -np.inf
        for tile in source.tiles:
            data = tile.level(0)[0]
            ok = np.isfinite(data)
            pixels += data.size
            valid += int(ok.sum())
            if ok.any():
                low, high = min(low, float(data[ok].min())), max(high, float(data[ok].max()))
        print("  %d pixels, %.2f %% without data, heights %.1f to %.1f m"
              % (pixels, 100.0 * (pixels - valid) / pixels, low + source.vertical_offset_m,
                 high + source.vertical_offset_m))

    problems = list(terrain.issues)
    reports = compare_sources(terrain)
    print("\nwhere sources overlap:" if reports else "\nno two sources overlap: nothing to compare")
    for report in reports:
        print("  " + report.describe())
        if report.problem:
            problems.append("height step between %s and %s: %+.2f m"
                            % (report.upper, report.lower, report.median_m))

    if args.write_manifest and not has_manifest:
        path = root / MANIFEST_NAME
        path.write_text(json.dumps(terrain.manifest.to_json(), indent=2) + "\n", encoding="utf-8",
                        newline="\n")
        print("\nwrote %s" % path)

    if problems:
        print("\nPROBLEMS TO REPORT TO PERSON 2:")
        for problem in problems:
            print("  - " + problem)
        return 1
    print("\nno problems found")
    return 0


if __name__ == "__main__":
    sys.exit(main())
