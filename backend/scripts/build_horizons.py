"""Precompute the horizon of every candidate position and store it in backend/cache/.

Run from backend/:
    .venv\\Scripts\\python scripts\\build_horizons.py                 (Windows)
    .venv/bin/python scripts/build_horizons.py                      (macOS, Linux)

Options: --spacing 200 (metres between candidates), --az-step 0.5 (degrees per azimuth bin),
--workers N (default: all cores but one), --margin 0 (metres to stay inside the terrain's
edge), --out DIR. Prints the build time, the size on disk and how much of the horizon is
formed by nearby terrain.
"""
import argparse
import os
import sys
import time
from dataclasses import replace
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from marsloc.horizon.store import STORE_CONFIG, HorizonStore, build_store, default_store_dir  # noqa: E402
from marsloc.terrain import Terrain  # noqa: E402


def near_field_report(store, thresholds_m=(500.0, 1000.0, 2000.0)):
    """Lines describing how much of the horizon is formed by nearby terrain."""
    lines = []
    for threshold in thresholds_m:
        share = store.near_fraction(threshold)
        share = share[np.isfinite(share)]
        lines.append("  closer than %4.0f m: median %4.1f %% of a candidate's horizon "
                     "(10th-90th percentile %4.1f-%4.1f %%; over half the horizon at %4.1f %% of candidates)"
                     % (threshold, 100 * np.median(share), 100 * np.percentile(share, 10),
                        100 * np.percentile(share, 90), 100 * (share > 0.5).mean()))
    return lines


def main():
    parser = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    parser.add_argument("--spacing", type=float, default=200.0, help="metres between candidates")
    parser.add_argument("--az-step", type=float, default=STORE_CONFIG.az_step_deg, help="degrees per bin")
    parser.add_argument("--max-range", type=float, default=STORE_CONFIG.max_range_m, help="metres")
    parser.add_argument("--margin", type=float, default=0.0, help="metres to stay inside the terrain edge")
    parser.add_argument("--workers", type=int, default=max(1, (os.cpu_count() or 2) - 1))
    parser.add_argument("--terrain", type=Path, default=None, help="terrain folder")
    parser.add_argument("--out", type=Path, default=None, help="store folder")
    args = parser.parse_args()

    terrain = Terrain.open(args.terrain)
    config = replace(STORE_CONFIG, az_step_deg=args.az_step, max_range_m=args.max_range)
    out = args.out or default_store_dir(args.spacing, args.az_step)
    print("terrain: %s (sources: %s)" % (terrain.manifest.root, ", ".join(terrain.source_ids)))
    print("building %s with %d workers ..." % (out, args.workers))

    last = [time.perf_counter()]

    def progress(done, total):
        if done == total or time.perf_counter() - last[0] > 10:
            last[0] = time.perf_counter()
            print("  %d / %d rows" % (done, total), flush=True)

    meta = build_store(terrain, out, spacing_m=args.spacing, config=config, margin_m=args.margin,
                       workers=args.workers, progress=progress)
    for issue in terrain.issues:
        print("TERRAIN ISSUE: %s" % issue)

    grid = meta["grid"]
    print("candidates: %d (%d rows x %d cols, %.1f x %.1f m cells), %d on terrain"
          % (meta["n_candidates"], grid["rows"], grid["cols"], grid["cell_size_m"]["north_south"],
             grid["cell_size_m"]["east_west"], meta["n_valid"]))
    print("azimuth bins: %d of %g deg; range %.0f km" % (meta["n_az"], args.az_step, args.max_range / 1000))
    print("build time: %.1f s with %d workers (%.1f ms per candidate per worker)"
          % (meta["build_seconds"], meta["workers"],
             1000 * meta["build_seconds"] * meta["workers"] / max(1, meta["n_valid"])))
    print("size on disk: %.1f MB (elev %.1f MB, dist %.1f MB)"
          % (meta["bytes"]["total"] / 1e6, meta["bytes"]["elev.npy"] / 1e6, meta["bytes"]["dist.npy"] / 1e6))
    print("near-field share of the horizon:")
    for line in near_field_report(HorizonStore.load(out)):
        print(line)


if __name__ == "__main__":
    main()
