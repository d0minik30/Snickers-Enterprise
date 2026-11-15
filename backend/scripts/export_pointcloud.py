"""Export the engine's terrain as point clouds.

Two views, both sampled from the same blended terrain the engine matches against
(marsloc.terrain.Terrain, HiRISE 1 m over CTX 20 m over MOLA-HRSC 200 m):

  crater   the CTX extent (about 30 x 30 km) every 30 m
  landing  the HiRISE extent (about 5 x 5 km around the landing site) every 4 m

For each view it writes:
  - a binary .ply (x east, y north, z up, metres from the landing site, coloured by height)
    to backend/cache/pointcloud/ for CloudCompare, MeshLab and similar (git-ignored, large);
  - a compact height grid (.bin, int16) plus a .json description to
    frontend/public/pointcloud/ for the website's point-cloud page.

Positions are a local flat projection around the landing site (east = R cos(lat0) dlon,
north = R dlat), fine over 30 km. Heights are real (no exaggeration).

Run from backend/:  .venv\\Scripts\\python scripts\\export_pointcloud.py
"""

import json
import math
import sys
from pathlib import Path

import numpy as np

HERE = Path(__file__).resolve().parent
BACKEND = HERE.parent
sys.path.insert(0, str(BACKEND))

from marsloc.terrain.terrain import Terrain  # noqa: E402

R_MARS = 3396190.0
LAND = (18.4447, 77.4508)  # Perseverance landing site, as on the website
PLY_DIR = BACKEND / "cache" / "pointcloud"
WEB_DIR = BACKEND.parent / "frontend" / "public" / "pointcloud"

VIEWS = {
    "crater": {"source": "ctx_20m", "step_m": 30.0,
               "title": "Jezero Crater, MRO CTX 20 m (blended with HiRISE and MOLA-HRSC)"},
    "landing": {"source": "hirise_1m", "step_m": 4.0,
                "title": "Perseverance landing site, HiRISE 1 m"},
}


def colour_ramp(t):
    """Height 0..1 to RGB 0..255: dark basin, rust, tan, pale rim. Matches the web page."""
    stops = np.array([[0.00, 40, 22, 30], [0.30, 120, 52, 34], [0.55, 196, 110, 60],
                      [0.80, 230, 176, 120], [1.00, 250, 235, 210]], dtype=np.float64)
    t = np.clip(t, 0.0, 1.0)
    rgb = np.empty(t.shape + (3,), dtype=np.float64)
    for k in range(3):
        rgb[..., k] = np.interp(t, stops[:, 0], stops[:, k + 1])
    return rgb.astype(np.uint8)


def write_ply(path, x, y, z, rgb):
    n = x.size
    header = (
        "ply\nformat binary_little_endian 1.0\n"
        f"comment Jezero Crater terrain, metres from the landing site {LAND[0]}N {LAND[1]}E\n"
        f"element vertex {n}\n"
        "property float x\nproperty float y\nproperty float z\n"
        "property uchar red\nproperty uchar green\nproperty uchar blue\nend_header\n"
    ).encode("ascii")
    rec = np.empty(n, dtype=[("x", "<f4"), ("y", "<f4"), ("z", "<f4"),
                             ("r", "u1"), ("g", "u1"), ("b", "u1")])
    rec["x"], rec["y"], rec["z"] = x, y, z
    rec["r"], rec["g"], rec["b"] = rgb[:, 0], rgb[:, 1], rgb[:, 2]
    with open(path, "wb") as f:
        f.write(header)
        f.write(rec.tobytes())


def main():
    terrain = Terrain.open()
    sources = {s.spec.id: s for s in terrain.sources}
    lat0 = math.radians(LAND[0])
    m_per_deg_lat = math.radians(1.0) * R_MARS
    m_per_deg_lon = m_per_deg_lat * math.cos(lat0)
    base = float(terrain.height(np.array([LAND[0]]), np.array([LAND[1]]))[0])
    print(f"landing site height {base:.1f} m")

    PLY_DIR.mkdir(parents=True, exist_ok=True)
    WEB_DIR.mkdir(parents=True, exist_ok=True)
    index = {"landing_height_m": round(base, 2), "landing": {"lat": LAND[0], "lon": LAND[1]},
             "sphere_radius_m": R_MARS, "views": {}}

    for name, view in VIEWS.items():
        (lat_s, lon_w), (lat_n, lon_e) = sources[view["source"]].bounds
        step = view["step_m"]
        # Inset half a step so every sample lies inside the source.
        y_n = (lat_n - LAND[0]) * m_per_deg_lat - step / 2
        y_s = (lat_s - LAND[0]) * m_per_deg_lat + step / 2
        x_w = (lon_w - LAND[1]) * m_per_deg_lon + step / 2
        x_e = (lon_e - LAND[1]) * m_per_deg_lon - step / 2
        rows = int((y_n - y_s) // step) + 1
        cols = int((x_e - x_w) // step) + 1
        ys = y_n - np.arange(rows) * step
        xs = x_w + np.arange(cols) * step
        lat = LAND[0] + ys / m_per_deg_lat
        lon = LAND[1] + xs / m_per_deg_lon
        h = np.empty((rows, cols), dtype=np.float64)
        for r0 in range(0, rows, 64):  # in bands, to keep memory low
            r1 = min(rows, r0 + 64)
            la, lo = np.meshgrid(lat[r0:r1], lon, indexing="ij")
            h[r0:r1] = terrain.height(la, lo, min_cell_m=step / 2)
        rel = h - base
        ok = np.isfinite(rel)
        lo_m, hi_m = float(np.nanmin(rel)), float(np.nanmax(rel))
        # int16 heights: 0.1 m steps when the range allows, coarser otherwise.
        scale = max(0.1, math.ceil(max(abs(lo_m), abs(hi_m)) / 32000 * 100) / 100)
        q = np.full(rel.shape, -32768, dtype="<i2")
        q[ok] = np.round(rel[ok] / scale).astype("<i2")
        (WEB_DIR / f"{name}.bin").write_bytes(q.tobytes())
        index["views"][name] = {
            "title": view["title"], "file": f"{name}.bin", "rows": rows, "cols": cols,
            "x0_m": round(x_w, 2), "y0_m": round(y_n, 2), "step_m": step,
            "scale_m": scale, "nodata": -32768,
            "min_m": round(lo_m, 2), "max_m": round(hi_m, 2), "points": int(ok.sum()),
        }

        X, Y = np.meshgrid(xs, ys)
        t = (rel - lo_m) / max(hi_m - lo_m, 1e-6)
        rgb = colour_ramp(t[ok])
        ply = PLY_DIR / f"jezero_{name}.ply"
        write_ply(ply, X[ok].astype("<f4"), Y[ok].astype("<f4"), rel[ok].astype("<f4"), rgb)
        print(f"{name}: {rows} x {cols} = {int(ok.sum()):,} points, heights {lo_m:.0f}..{hi_m:.0f} m, "
              f"web {q.nbytes / 1e6:.1f} MB, ply {ply.stat().st_size / 1e6:.0f} MB")

    (WEB_DIR / "pointcloud.json").write_text(json.dumps(index, indent=2) + "\n")
    print(f"wrote {WEB_DIR} and {PLY_DIR}")


if __name__ == "__main__":
    main()
