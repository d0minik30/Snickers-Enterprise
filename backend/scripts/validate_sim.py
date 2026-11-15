"""Validation harness: how well does the matcher locate simulated photos on the real terrain?

For each trial: pick a random position and heading inside the crater, simulate the skyline a
photo would show there (marsloc/simulate.py: noise that is correlated along the skyline, and
optionally rocks, gaps, DEM roughness, a pitch error), run the matcher, and compare with the
truth. The terrain is the real elevation data; only the photo is simulated, and it is rendered
with finer settings than the matcher uses.

Run from backend/ (it uses all cores but one; a few hundred trials take a few minutes):
    .venv\\Scripts\\python scripts\\validate_sim.py --trials 300                (Windows)
    .venv/bin/python scripts/validate_sim.py --trials 300                     (macOS, Linux)

--sets picks the conditions to run (default: base). Each set changes one thing:
    base        one 60 deg photo, 0.05 deg noise
    fov120      one 120 deg photo
    three       three 60 deg photos with known relative headings (0, 120, 240 deg)
    pano        a 360 deg panorama
    noise0.1    0.1 deg noise             noise0.02   0.02 deg noise
    rocks       2 unflagged rocks and 1 gap per photo
    rough2      real ground differs from the DEM by 2 m (matters for near terrain)
    near        base, with the matcher's near-field rule on (1500 m, weight 0.1)
    rough2near  rough2 with the near-field rule on
    dem2        rough2 with the matcher told about a 2 m DEM error
    pitch       a 0.3 deg pitch error, declared as horizon_uncertainty_deg 0.5

Writes reports/validate_sim.json (every trial), reports/validate_sim.md (the table) and, with
matplotlib, reports/validate_sim_<set>.png (an error map). reports/ is git-ignored.
"""
import argparse
import json
import os
import sys
import time

# One thread per worker process: the trials run side by side, and numpy's own threads would
# only fight each other.
for _name in ("OMP_NUM_THREADS", "OPENBLAS_NUM_THREADS", "MKL_NUM_THREADS"):
    os.environ.setdefault(_name, "1")
from concurrent.futures import ProcessPoolExecutor
from pathlib import Path

import numpy as np

BACKEND = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(BACKEND))

from marsloc import geo  # noqa: E402
from marsloc.horizon.store import HorizonStore  # noqa: E402
from marsloc.match import Matcher, MatcherConfig  # noqa: E402
from marsloc.simulate import simulate_photo  # noqa: E402
from marsloc.terrain import Terrain  # noqa: E402

# Where trial positions are drawn: the crater floor, the delta and the western rim area
AREA = {"lat": (18.36, 18.56), "lon": (77.26, 77.56)}

SETS = {
    "base": {},
    "fov120": {"hfov": 120.0},
    "three": {"photos": 3},
    "pano": {"hfov": 360.0},
    "noise0.1": {"noise": 0.1},
    "noise0.02": {"noise": 0.02},
    "rocks": {"sim": {"rocks": 2, "gaps": 1}},
    "rough2": {"sim": {"roughness_m": 2.0}},
    "near": {"config": {"near_field_m": 1500.0, "near_weight": 0.1}},
    "rough2near": {"sim": {"roughness_m": 2.0}, "config": {"near_field_m": 1500.0, "near_weight": 0.1}},
    "dem2": {"sim": {"roughness_m": 2.0}, "config": {"dem_height_error_m": 2.0}},
    "pitch": {"sim": {"pitch_error_deg": 0.3}, "horizon_uncertainty": 0.5},
}

_state = {}


def _matcher(config_items):
    key = tuple(sorted(config_items.items()))
    if "terrain" not in _state:
        _state["terrain"] = Terrain.open()
        _state["store"] = HorizonStore.load()
    if key not in _state:
        _state[key] = Matcher(_state["terrain"], _state["store"], MatcherConfig(**config_items))
    return _state["terrain"], _state[key]


def run_trial(job):
    """One trial; returns a dict of plain numbers."""
    name, spec, seed = job
    rng = np.random.default_rng(seed)
    terrain, matcher = _matcher(spec.get("config", {}))
    lat = rng.uniform(*AREA["lat"])
    lon = rng.uniform(*AREA["lon"])
    heading = rng.uniform(0.0, 360.0)
    noise = spec.get("noise", 0.05)
    n_photos = spec.get("photos", 1)
    hfov = spec.get("hfov", 60.0)
    photos = []
    for k in range(n_photos):
        rel = k * 360.0 / n_photos
        photos.append(simulate_photo(
            terrain, lat, lon, heading + rel, hfov_deg=min(hfov, 359.9), noise_sigma_deg=noise, rng=rng,
            photo_id="photo_%d" % (k + 1), angle_sigma_deg=max(noise, 0.02),
            horizon_uncertainty_deg=spec.get("horizon_uncertainty", 0.0),
            relative_heading_deg=(rel if n_photos > 1 else None), **spec.get("sim", {})))
    started = time.perf_counter()
    result = matcher.locate(photos)
    seconds = time.perf_counter() - started
    best = result.best
    error = float(geo.distance_m(lat, lon, best.lat, best.lon))
    trusted = np.concatenate([p.elev_deg[p.weight > 0] for p in photos])
    near = float(np.mean(np.concatenate([np.nan_to_num(f.distance_m, nan=1e9) for f in best.photos]) < 1500.0))
    return {
        "set": name, "seed": seed, "lat": lat, "lon": lon, "heading_deg": heading,
        "error_m": error, "heading_error_deg": abs(float(geo.angle_diff(best.heading_deg, heading))),
        "status": result.status, "probability": best.probability, "score": best.score,
        "fit_z": best.fit_z, "support": best.support, "coverage": best.coverage,
        "uncertainty_m": result.uncertainty_m, "uncertainty_95_m": result.uncertainty_95_m,
        "relief_deg": float(np.percentile(trusted, 95) - np.percentile(trusted, 5)) if trusted.size else 0.0,
        "near_share": near, "seconds": seconds, "renders": result.stats["renders"],
        "found_lat": best.lat, "found_lon": best.lon,
    }


def summarize(rows):
    """One line of numbers for a set of trials."""
    err = np.array([r["error_m"] for r in rows])
    status = np.array([r["status"] for r in rows])
    ok = status == "ok"
    pct = lambda mask: 100.0 * float(np.mean(mask)) if len(rows) else float("nan")
    return {
        "trials": len(rows),
        "within_50_m": pct(err <= 50), "within_100_m": pct(err <= 100), "within_300_m": pct(err <= 300),
        "within_1_km": pct(err <= 1000),
        "median_error_m": float(np.median(err)), "p90_error_m": float(np.percentile(err, 90)),
        "median_heading_error_deg": float(np.median([r["heading_error_deg"] for r in rows])),
        "ok": pct(ok), "ambiguous": pct(status == "ambiguous"), "no_match": pct(status == "no_match"),
        "ok_within_300_m": 100.0 * float(np.mean(err[ok] <= 300)) if ok.any() else float("nan"),
        "ok_within_1_km": 100.0 * float(np.mean(err[ok] <= 1000)) if ok.any() else float("nan"),
        "ok_inside_95": 100.0 * float(np.mean([r["error_m"] <= r["uncertainty_95_m"] for r in rows if r["status"] == "ok"]))
        if ok.any() else float("nan"),
        "inside_68": pct(np.array([r["error_m"] <= r["uncertainty_m"] for r in rows])),
        "inside_95": pct(np.array([r["error_m"] <= r["uncertainty_95_m"] for r in rows])),
        "median_seconds": float(np.median([r["seconds"] for r in rows])),
    }


COLUMNS = [("set", "set", "%s"), ("trials", "n", "%d"), ("within_100_m", "within 100 m", "%.0f %%"),
           ("within_300_m", "within 300 m", "%.0f %%"), ("within_1_km", "within 1 km", "%.0f %%"),
           ("median_error_m", "median", "%.0f m"), ("p90_error_m", "90th pct", "%.0f m"),
           ("median_heading_error_deg", "heading", "%.2f deg"), ("ok", "ok", "%.0f %%"),
           ("ok_within_300_m", "ok: within 300 m", "%.0f %%"), ("ok_within_1_km", "ok: within 1 km", "%.0f %%"),
           ("ok_inside_95", "ok: inside 95 % circle", "%.0f %%"),
           ("ambiguous", "ambiguous", "%.0f %%"), ("no_match", "no match", "%.0f %%"),
           ("inside_68", "in 68 % circle", "%.0f %%"), ("inside_95", "in 95 % circle", "%.0f %%"),
           ("median_seconds", "time", "%.1f s")]


def table(summaries):
    lines = ["| " + " | ".join(title for _, title, _ in COLUMNS) + " |", "|" + "---|" * len(COLUMNS)]
    for s in summaries:
        lines.append("| " + " | ".join(fmt % s[key] for key, _, fmt in COLUMNS) + " |")
    return "\n".join(lines)


def error_map(rows, path, title):
    try:
        import matplotlib
        matplotlib.use("Agg")
        import matplotlib.pyplot as plt
    except ImportError:
        return False
    fig, ax = plt.subplots(figsize=(8, 6.5))
    lon = np.array([r["lon"] for r in rows])
    lat = np.array([r["lat"] for r in rows])
    err = np.clip(np.array([r["error_m"] for r in rows]), 10, 20000)
    shape = {"ok": "o", "ambiguous": "s", "no_match": "x"}
    for status, marker in shape.items():
        pick = np.array([r["status"] == status for r in rows])
        if pick.any():
            dots = ax.scatter(lon[pick], lat[pick], c=np.log10(err[pick]), cmap="RdYlGn_r", vmin=1, vmax=4.3,
                              marker=marker, s=38, label=status, edgecolors="k" if marker != "x" else None,
                              linewidths=0.4)
    bar = fig.colorbar(dots, ax=ax, ticks=[1, 2, 3, 4])
    bar.ax.set_yticklabels(["10 m", "100 m", "1 km", "10 km"])
    bar.set_label("position error")
    ax.set_xlabel("longitude (deg E)")
    ax.set_ylabel("latitude (deg N)")
    ax.set_title(title)
    ax.legend(title="verdict", loc="upper right")
    fig.tight_layout()
    fig.savefig(path, dpi=130)
    plt.close(fig)
    return True


def main():
    parser = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    parser.add_argument("--trials", type=int, default=300)
    parser.add_argument("--sets", nargs="*", default=["base"], choices=sorted(SETS))
    parser.add_argument("--workers", type=int, default=max(1, (os.cpu_count() or 2) - 1))
    parser.add_argument("--seed", type=int, default=1000)
    parser.add_argument("--out", type=Path, default=BACKEND / "reports")
    args = parser.parse_args()

    jobs = [(name, SETS[name], args.seed + k) for name in args.sets for k in range(args.trials)]
    started = time.perf_counter()
    if args.workers > 1:
        with ProcessPoolExecutor(max_workers=args.workers) as pool:
            rows = list(pool.map(run_trial, jobs, chunksize=4))
    else:
        rows = [run_trial(job) for job in jobs]
    minutes = (time.perf_counter() - started) / 60.0

    args.out.mkdir(parents=True, exist_ok=True)
    summaries = []
    for name in args.sets:
        mine = [r for r in rows if r["set"] == name]
        summaries.append({"set": name, **summarize(mine)})
        error_map(mine, args.out / ("validate_sim_%s.png" % name),
                  "%s: %d simulated photos (colour = position error)" % (name, len(mine)))
    text = table(summaries)
    (args.out / "validate_sim.json").write_text(
        json.dumps({"summaries": summaries, "trials": rows}, indent=1), encoding="utf-8")
    (args.out / "validate_sim.md").write_text(text + "\n", encoding="utf-8", newline="\n")
    print(text)
    print("\n%d trials in %.1f min with %d workers; wrote %s" % (len(rows), minutes, args.workers, args.out))


if __name__ == "__main__":
    main()
