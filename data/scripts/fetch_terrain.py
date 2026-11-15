#!/usr/bin/env python3
"""Build the engine terrain (backend/CONTRACTS.md, section 1) from the official sources, with one
command, from the repository root:

    python data/scripts/fetch_terrain.py

It runs download -> crop -> offset -> check -> install, as set out in terrain_sources.json:

1. download  the official files from their USGS addresses into data/raw/terrain/ (git-ignored),
             resuming a cut-off download. The global MOLA-HRSC blend (11.4 GB) is not downloaded:
             only a window around Jezero is read over the network. Every input must match the
             SHA-256 of its pixel data pinned in terrain_sources.json.
2. crop      HiRISE: the part around the test poses (data/test_photos/manifest.json) plus a margin,
             cut back to where every pixel has data (terrain_crops.py). CTX: soc_008, and around it
             the JPL mosaic resampled, aligned and cleaned (ctx_merge.py). MOLA-HRSC: the window as
             float32 metres.
3. offset    vertical_offset_m of HiRISE and of MOLA-HRSC, measured against the CTX source, so the
             sources meet without steps (terrain_offsets.py).
4. check     no holes, no impossible steps, the landing site and the mission sites at their known
             heights, the crater rim standing above the floor, a steep delta front, joins within
             2 m. Any failure stops the build before anything is installed.
5. install   tiles of at most 2048 x 2048 and terrain.json into backend/data_local/terrain/
             (git-ignored), replacing the old terrain only once everything is written, with a
             report of the build beside it (terrain_build.json).

Then check it the way the engine sees it:  python backend/scripts/check_terrain.py

Options: --update-pins records the pixel checksums of the inputs in terrain_sources.json (only after
a deliberate change of source); --dest DIR, --downloads DIR, --config FILE.
"""
import argparse
import json
import math
import os
import shutil
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

import numpy as np
import rasterio
from affine import Affine

import ctx_merge
from terrain_crops import blend_to_float, crop_hirise, read_blend_window
from terrain_io import (R, TerrainBuildError, array_sha256, degree_bounds, download, human_bytes,
                        pixel_sha256, pixel_size_m, projection, sample_grid, to_map, write_tiles)
from terrain_offsets import edge_offsets, overlap_offset, whole_overlap

ROOT = Path(__file__).resolve().parents[2]
DEFAULT_CONFIG = Path(__file__).with_name("terrain_sources.json")
DEFAULT_DEST = ROOT / "backend" / "data_local" / "terrain"
DEFAULT_DOWNLOADS = ROOT / "data" / "raw" / "terrain"
CONTRACT_VERSION = "0.2"            # section 1 of backend/CONTRACTS.md (0.3 changed sections 2 and 3 only)
LANDING_SITE = (18.4447, 77.4508)
LANDING_SITE_HEIGHT_M = -2567.2     # data/README.md and data/output/places.geojson
LANDING_TOLERANCE_M = 0.5           # as backend/tests/test_terrain.py
PLACE_TOLERANCE_M = 4.0             # as backend/tests/test_terrain.py
PLACES = ROOT / "data" / "output" / "places.geojson"
JOIN_LIMIT_M = 2.0                  # as STEP_WARNING_M in backend/marsloc/terrain/seams.py
JOIN_BAND_M = {"hirise_1m": 60.0, "mola_200m": 600.0}   # 3 cells of the coarser source, as seams.py
STEP_LIMIT_DEG = {"hirise_1m": 80.0, "ctx_20m": 60.0, "mola_200m": 60.0}
CRATER_CENTRE = (18.38, 77.58)
RIM_RING_M = (18000.0, 28000.0)     # where the rim stands, from the crater centre
FLOOR_RADIUS_M = 8000.0
RIM_MIN_RELIEF_M = 300.0
DELTA_FRONT = (18.4725, 77.4193)
DELTA_RADIUS_M = 500.0
DELTA_MIN_SLOPE_DEG = 20.0


def log(*parts):
    print(*parts, flush=True)


# ---------------------------------------------------------------- geometry helpers

def box_around(box):
    """(lat_min, lon_min, lat_max, lon_max) of a square of +/- half_size_m around a centre."""
    d_lat = math.degrees(box["half_size_m"] / R)
    d_lon = d_lat / math.cos(math.radians(box["centre_lat"]))
    return (box["centre_lat"] - d_lat, box["centre_lon"] - d_lon, box["centre_lat"] + d_lat, box["centre_lon"] + d_lon)


def test_poses(path):
    cases = json.loads(Path(path).read_text(encoding="utf-8"))["cases"]
    return [{"name": c["name"], "sol": c["sol"], "lat": c["truth"]["lat"], "lon": c["truth"]["lon"]} for c in cases]


def pose_box(poses, margin_m):
    d_lat = math.degrees(margin_m / R)
    lats, lons = [p["lat"] for p in poses], [p["lon"] for p in poses]
    d_lon = d_lat / math.cos(math.radians(max(abs(min(lats)), abs(max(lats)))))
    return (min(lats) - d_lat, min(lons) - d_lon, max(lats) + d_lat, max(lons) + d_lon)


def inside_m(bounds, lat, lon):
    """Ground metres from a point to the nearest edge of bounds; negative outside."""
    (lat0, lon0), (lat1, lon1) = bounds
    ns = min(lat - lat0, lat1 - lat) * math.pi / 180 * R
    ew = min(lon - lon0, lon1 - lon) * math.pi / 180 * R * math.cos(math.radians(lat))
    return min(ns, ew)


def area_km2(bounds):
    (lat0, lon0), (lat1, lon1) = bounds
    return (math.radians(lon1 - lon0) * (math.sin(math.radians(lat1)) - math.sin(math.radians(lat0))) * R * R / 1e6)


def destination(lat, lon, bearing_deg, distance_m):
    """Point reached from (lat, lon) along a great circle (arrays allowed)."""
    p1, l1 = math.radians(lat), math.radians(lon)
    b, d = np.radians(bearing_deg), np.asarray(distance_m) / R
    p2 = np.arcsin(math.sin(p1) * np.cos(d) + math.cos(p1) * np.sin(d) * np.cos(b))
    l2 = l1 + np.arctan2(np.sin(b) * np.sin(d) * math.cos(p1), np.cos(d) - math.sin(p1) * np.sin(p2))
    return np.degrees(p2), np.degrees(l2)


def steepest_step(z, dy, dx, block=1024):
    """(steepest slope between north/south/east/west neighbours in degrees, number of neighbour
    pairs steeper than 60 deg). Works through big grids in blocks of rows."""
    best, over, t60 = 0.0, 0, math.tan(math.radians(60.0))
    rows = z.shape[0]
    for r0 in range(0, rows, block):
        n = min(block, rows - r0)
        zz = np.asarray(z[r0:min(rows, r0 + block + 1)], dtype=np.float64)
        for ratio in (np.abs(np.diff(zz[:n], axis=1)) / np.asarray(dx)[r0:r0 + n, None],
                      np.abs(np.diff(zz, axis=0)) / dy):
            if ratio.size:
                best = max(best, float(np.nanmax(ratio)))
                over += int(np.count_nonzero(ratio > t60))
    return math.degrees(math.atan(best)), over


# ---------------------------------------------------------------- 1. download

def fetch_inputs(config, downloads, update_pins):
    used = {key for s in config["sources"] for key in s["products"]}
    inputs, changed = {}, False
    for key, product in config["products"].items():
        if key not in used:
            continue
        log("\n%s: %s" % (key, product["name"]))
        if product["access"] == "download":
            path = download(product["url"], Path(downloads) / Path(product["url"]).name, int(product["bytes"]), log=log)
            with rasterio.open(path) as src:
                projection(src.crs, path.name)            # a coordinate system this build understands
                grid = {"rows": src.height, "cols": src.width, "dtype": src.dtypes[0]}
            got = pixel_sha256(path)
            entry = {"path": path}
        elif product["access"] == "window":
            box = product["window"]
            window = read_blend_window(product["url"], (box["lat_min"], box["lon_min"], box["lat_max"], box["lon_max"]))
            raw = window["raw"]
            grid = {"rows": int(raw.shape[0]), "cols": int(raw.shape[1]), "dtype": str(raw.dtype)}
            got = array_sha256(raw)
            entry = {"window": window}
            log("  read a %d x %d px window over the network (%s of pixels)" % (grid["cols"], grid["rows"], human_bytes(raw.nbytes)))
        else:
            raise TerrainBuildError("%s: unknown access %r" % (key, product["access"]))
        pinned = product.get("pixel_sha256") or None
        mismatch = [k for k, v in grid.items() if product.get(k) is not None and product[k] != v]
        if pinned == got and not mismatch:
            log("  pixels match the pin (pixel_sha256 %s...)" % got[:16])
        elif update_pins:
            log("  new pin: pixel_sha256 %s, %d x %d px %s (was %s)" % (got, grid["cols"], grid["rows"], grid["dtype"], pinned))
            product["pixel_sha256"] = got
            product.update(grid)
            changed = True
        else:
            raise TerrainBuildError("%s: the pixels (%d x %d %s, SHA-256 %s) do not match terrain_sources.json "
                                    "(%s x %s %s, %s). If the official product really changed, check it and "
                                    "run with --update-pins." % (key, grid["cols"], grid["rows"], grid["dtype"], got,
                                                                 product.get("cols"), product.get("rows"),
                                                                 product.get("dtype"), pinned))
        entry.update(grid=grid, pixel_sha256=got)
        inputs[key] = entry
    return inputs, changed


# ---------------------------------------------------------------- 2. crop

def build_sources(config, inputs):
    built = {}
    for s in config["sources"]:                       # the blend first: the CTX build fills from it
        if s["build"] == "blend_window":
            window = inputs[s["products"][0]]["window"]
            z = blend_to_float(window["raw"], window["nodata"])
            built[s["id"]] = {"array": z, "crs": window["crs"], "transform": window["transform"], "report": {}}
            log("\n%s: MOLA-HRSC window, %d x %d px of 200 m" % (s["id"], z.shape[1], z.shape[0]))
    blend = next((built[s["id"]] for s in config["sources"] if s["build"] == "blend_window"), None)
    for s in config["sources"]:
        if s["build"] == "ctx":
            log("\n%s:" % s["id"])
            paths = [inputs[key]["path"] for key in s["products"]]
            box = box_around(s["box"])
            out = ctx_merge.build_ctx(paths[0], paths[1] if len(paths) > 1 else None, blend, box, log=log)
            out["box"] = box
            built[s["id"]] = out
    for s in config["sources"]:
        if s["build"] == "hirise_crop":
            log("\n%s:" % s["id"])
            poses = test_poses(ROOT / s["around_test_poses"])
            box = pose_box(poses, s["margin_m"])
            out = crop_hirise(inputs[s["products"][0]]["path"], box, log=log)
            bounds = degree_bounds(out["crs"], out["transform"], *out["array"].shape)
            cover = [{"name": p["name"], "sol": p["sol"], "inside_m": round(inside_m(bounds, p["lat"], p["lon"]))} for p in poses]
            out["report"] = {"pose_box": [round(v, 6) for v in box], "margin_m": s["margin_m"], "trimmed_px": out["trimmed"],
                             "poses": cover}
            log("  HiRISE: %d x %d px of 1 m; %d of %d test poses inside, %d with %d m or more around them"
                % (out["array"].shape[1], out["array"].shape[0], sum(c["inside_m"] > 0 for c in cover), len(cover),
                   sum(c["inside_m"] >= s["margin_m"] for c in cover), s["margin_m"]))
            for c in cover:
                if c["inside_m"] <= 0:
                    log("  HiRISE: pose %s (sol %d) is %d m outside: the official mosaic has no data there"
                        % (c["name"], c["sol"], -c["inside_m"]))
            built[s["id"]] = out
    return built


# ---------------------------------------------------------------- 3. offset

def measure_offsets(config, built):
    ctx = built["ctx_20m"]
    ctx["vertical_offset_m"] = 0.0
    log("\noffsets (the CTX source is the reference):")
    for s in config["sources"]:
        b = built[s["id"]]
        if s["id"] == "hirise_1m":
            med, spread, n = overlap_offset(b["array"], b["crs"], b["transform"], ctx["array"], ctx["crs"], ctx["transform"])
            b["vertical_offset_m"] = round(med, 2)
            edges = edge_offsets(b["array"] + np.float32(b["vertical_offset_m"]), b["crs"], b["transform"],
                                 ctx["array"], ctx["crs"], ctx["transform"], band_m=JOIN_BAND_M[s["id"]])
            b["report"]["offset"] = {"against": "ctx_20m", "where": "whole HiRISE crop, on the 20 m cells it covers",
                                     "median_m": round(med, 3), "spread_m": round(spread, 3), "cells": n,
                                     "join_after_offset": edges}
            log("  hirise_1m: CTX - HiRISE = %+.2f m (spread %.2f m, %d cells of 20 m) -> vertical_offset_m %+.2f"
                % (med, spread, n, b["vertical_offset_m"]))
        elif s["id"] == "mola_200m":
            before = edge_offsets(ctx["array"], ctx["crs"], ctx["transform"], b["array"], b["crs"], b["transform"],
                                  band_m=JOIN_BAND_M[s["id"]])
            b["vertical_offset_m"] = round(before["all"]["median_m"], 2)
            edges = edge_offsets(ctx["array"], ctx["crs"], ctx["transform"], b["array"], b["crs"], b["transform"],
                                 band_m=JOIN_BAND_M[s["id"]], lower_offset_m=b["vertical_offset_m"])
            whole = whole_overlap(ctx["array"], ctx["crs"], ctx["transform"], b["array"], b["crs"], b["transform"],
                                  lower_offset_m=b["vertical_offset_m"])
            b["report"]["offset"] = {"against": "ctx_20m", "where": "within 600 m of the CTX edge",
                                     "median_m": before["all"]["median_m"], "join_after_offset": edges,
                                     "whole_overlap_after_offset": whole}
            log("  mola_200m: CTX - blend = %+.2f m at the CTX edge -> vertical_offset_m %+.2f"
                % (before["all"]["median_m"], b["vertical_offset_m"]))
        if "offset" in b.get("report", {}):
            j = b["report"]["offset"]["join_after_offset"]
            log("    after the offset, at the join (%g m deep): all %s; " % (j["band_m"], _fmt(j["all"])) +
                ", ".join("%s %s" % (side, _fmt(j[side])) for side in ("north", "south", "east", "west")))


def _fmt(stats):
    if not stats["n"]:
        return "-"
    return "%+.2f m (5-95 %%: %+.1f..%+.1f)" % (stats["median_m"], stats["p05_m"], stats["p95_m"])


# ---------------------------------------------------------------- 4. check

def stack_height(config, built, lat, lon):
    """Heights from the sources in priority order, each with its offset (no blend bands)."""
    out = np.full(np.shape(lat), np.nan)
    for s in sorted(config["sources"], key=lambda s: -s["priority"]):
        b = built[s["id"]]
        v = sample_grid(b["array"], b["crs"], b["transform"], lat, lon) + b.get("vertical_offset_m", 0.0)
        take = np.isnan(out) & np.isfinite(v)
        out[take] = v[take]
    return out


def run_checks(config, built):
    results = []

    def check(name, ok, detail):
        results.append({"check": name, "ok": bool(ok), "detail": detail})
        log("  %-28s %s  %s" % (name, "ok  " if ok else "FAIL", detail))

    log("\nchecks:")
    order = sorted(config["sources"], key=lambda s: -s["priority"])
    for s in order:
        z = built[s["id"]]["array"]
        holes = int(np.isnan(z).sum())
        check("no holes: " + s["id"], holes == 0, "%d of %d cells without data" % (holes, z.size))
    for s in order:
        b = built[s["id"]]
        dy, dx = pixel_size_m(b["crs"], b["transform"], b["array"].shape[0])
        steep, over60 = steepest_step(b["array"], dy, dx)
        b.setdefault("report", {})["steepest_step_deg"] = round(steep, 2)
        b["report"]["steps_over_60_deg"] = over60
        limit = STEP_LIMIT_DEG[s["id"]]
        check("steepest step: " + s["id"], steep <= limit,
              "%.1f deg between neighbours (limit %g); %d steps over 60 deg" % (steep, limit, over60))

    ctx = built["ctx_20m"]
    at = lambda b, lat, lon: float(sample_grid(b["array"], b["crs"], b["transform"], np.array([lat]), np.array([lon]))[0])
    h = at(ctx, *LANDING_SITE)
    check("landing site on ctx_20m", abs(h - LANDING_SITE_HEIGHT_M) <= LANDING_TOLERANCE_M,
          "%.1f m (expected %.1f +/- %g)" % (h, LANDING_SITE_HEIGHT_M, LANDING_TOLERANCE_M))
    if "hirise_1m" in built:
        hh = at(built["hirise_1m"], *LANDING_SITE) + built["hirise_1m"]["vertical_offset_m"]
        check("landing site on hirise_1m", abs(hh - LANDING_SITE_HEIGHT_M) <= 5.0, "%.1f m with its offset" % hh)
    worst = 0.0
    for f in json.loads(PLACES.read_text(encoding="utf-8"))["features"]:
        lon, lat = f["geometry"]["coordinates"]
        worst = max(worst, abs(at(ctx, lat, lon) - f["properties"]["elevation_m"]))
    check("places on ctx_20m", worst <= PLACE_TOLERANCE_M,
          "largest difference from places.geojson %.2f m (limit %g)" % (worst, PLACE_TOLERANCE_M))

    for s in order:
        offset = built[s["id"]].get("report", {}).get("offset")
        if offset:
            med = offset["join_after_offset"]["all"]["median_m"]
            check("join %s / ctx_20m" % s["id"], med is not None and abs(med) <= JOIN_LIMIT_M,
                  "%+.2f m median step after the offset (limit %g)" % (med, JOIN_LIMIT_M))

    floor_d = np.arange(0.0, FLOOR_RADIUS_M, 250.0)
    fl_lat, fl_lon = destination(*CRATER_CENTRE, np.arange(0, 360, 10)[:, None], floor_d[None, :])
    floor = float(np.nanmedian(stack_height(config, built, fl_lat.ravel(), fl_lon.ravel())))
    relief = []
    for sector in range(8):
        az = np.arange(sector * 45, sector * 45 + 45, 1.0)
        dist = np.arange(RIM_RING_M[0], RIM_RING_M[1] + 1, 250.0)
        la, lo = destination(*CRATER_CENTRE, az[:, None], dist[None, :])
        relief.append(float(np.nanmax(stack_height(config, built, la.ravel(), lo.ravel()))) - floor)
    check("crater rim above the floor", min(relief) >= RIM_MIN_RELIEF_M,
          "floor %.0f m; rim N/NE/E/SE/S/SW/W/NW %s m (at least %g)"
          % (floor, "/".join("%.0f" % v for v in relief), RIM_MIN_RELIEF_M))
    built["ctx_20m"].setdefault("report", {})["rim_relief_m"] = [round(v) for v in relief]

    p = projection(ctx["crs"])
    t = ctx["transform"]
    x, y = to_map(p, DELTA_FRONT[1], DELTA_FRONT[0])
    c, r = int((float(x) - t.c) / t.a), int((float(y) - t.f) / t.e)
    n = int(DELTA_RADIUS_M / 20) + 1
    window = ctx["array"][max(0, r - n):r + n + 1, max(0, c - n):c + n + 1]
    dy, dx = pixel_size_m(ctx["crs"], t @ Affine.translation(max(0, c - n), max(0, r - n)), window.shape[0])
    slope, _ = steepest_step(window, dy, dx)
    check("delta front is steep", slope >= DELTA_MIN_SLOPE_DEG,
          "steepest slope within %g m of %.4f N %.4f E: %.1f deg (at least %g)"
          % (DELTA_RADIUS_M, DELTA_FRONT[0], DELTA_FRONT[1], slope, DELTA_MIN_SLOPE_DEG))
    return results


# ---------------------------------------------------------------- 5. install

def install(config, built, dest, report):
    dest = Path(dest)
    staging, old = dest.with_name(dest.name + ".staging"), dest.with_name(dest.name + ".old")
    for path in (staging, old):
        if path.exists():
            shutil.rmtree(path)
    staging.mkdir(parents=True)
    sources = []
    for s in sorted(config["sources"], key=lambda s: -s["priority"]):
        b = built[s["id"]]
        log("  writing %s ..." % s["id"])
        tiles = write_tiles(b["array"], b["crs"], b["transform"], staging, s["id"], s["id"])
        products = [config["products"][key] for key in s["products"]]
        entry = {"id": s["id"], "description": "; ".join(p["name"] for p in products),
                 "priority": s["priority"], "cell_size_m": s["cell_size_m"],
                 "vertical_offset_m": b.get("vertical_offset_m", 0.0)}
        if "edge_blend_m" in s:
            entry["edge_blend_m"] = s["edge_blend_m"]
        entry["products"] = [{"name": p["name"], "doi": p.get("doi"), "url": p["url"], "pixel_sha256": p["pixel_sha256"]}
                             for p in products]
        entry["tiles"] = tiles
        sources.append(entry)
        size = sum((staging / t["file"]).stat().st_size for t in tiles)
        report["sources"][s["id"]].update(tiles=len(tiles), bytes_on_disk=size,
                                          rows=int(b["array"].shape[0]), cols=int(b["array"].shape[1]),
                                          bounds=degree_bounds(b["crs"], b["transform"], *b["array"].shape))
    manifest = {"contract_version": CONTRACT_VERSION, "sphere_radius_m": int(R), "vertical_datum": "mars_areoid_mola",
                "units": "m", "built_by": "data/scripts/fetch_terrain.py", "built_utc": report["built_utc"],
                "sources": sources}
    with open(staging / "terrain.json", "w", encoding="utf-8", newline="\n") as out:
        out.write(json.dumps(manifest, indent=2, allow_nan=False) + "\n")
    with open(staging / "terrain_build.json", "w", encoding="utf-8", newline="\n") as out:
        out.write(json.dumps(report, indent=2, allow_nan=False, default=str) + "\n")
    if dest.exists():
        os.replace(dest, old)
    os.replace(staging, dest)
    if old.exists():
        shutil.rmtree(old)
    return manifest


# ---------------------------------------------------------------- main

def coverage(config, built):
    """How much of the 80 x 80 km box the 20 m data covers, and of what."""
    ctx_cfg = next(s for s in config["sources"] if s["id"] == "ctx_20m")
    box = box_around(ctx_cfg["box"])
    box_bounds = [[box[0], box[1]], [box[2], box[3]]]
    ctx = built["ctx_20m"]
    (la0, lo0), (la1, lo1) = degree_bounds(ctx["crs"], ctx["transform"], *ctx["array"].shape)
    inter = [[max(la0, box[0]), max(lo0, box[1])], [min(la1, box[2]), min(lo1, box[3])]]
    share = area_km2(inter) / area_km2(box_bounds)
    out = {"box": [round(v, 6) for v in box], "box_km2": round(area_km2(box_bounds), 1),
           "ctx_20m_km2": round(area_km2([[la0, lo0], [la1, lo1]]), 1), "ctx_20m_share_of_box_pct": round(100 * share, 2)}
    codes = ctx.get("codes")
    if codes is not None:
        for name, code in (("soc_008", ctx_merge.SOC), ("jpl", ctx_merge.JPL), ("jpl_replaced_from_blend", ctx_merge.JPL_REPLACED)):
            out["%s_share_of_box_pct" % name] = round(100 * share * float((codes == code).mean()), 2)
        out["mola_200m_share_of_box_pct"] = round(100 * (1 - share), 2)
    return out


def main():
    parser = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    parser.add_argument("--config", type=Path, default=DEFAULT_CONFIG)
    parser.add_argument("--dest", type=Path, default=DEFAULT_DEST, help="terrain folder for the engine")
    parser.add_argument("--downloads", type=Path, default=DEFAULT_DOWNLOADS, help="where the official files are kept")
    parser.add_argument("--update-pins", action="store_true", help="record the inputs' pixel checksums")
    args = parser.parse_args()
    start = time.time()
    config = json.loads(args.config.read_text(encoding="utf-8"))
    try:
        log("1. download")
        inputs, changed = fetch_inputs(config, args.downloads, args.update_pins)
        if changed:
            with open(args.config, "w", encoding="utf-8", newline="\n") as out:
                out.write(json.dumps(config, indent=2, ensure_ascii=False) + "\n")
            log("\nupdated the pins in %s" % args.config)
        log("\n2. crop")
        built = build_sources(config, inputs)
        log("\n3. offset")
        measure_offsets(config, built)
        log("\n4. check")
        results = run_checks(config, built)
        failed = [r for r in results if not r["ok"]]
        if failed:
            raise TerrainBuildError("%d check(s) failed (%s); nothing was installed"
                                    % (len(failed), ", ".join(r["check"] for r in failed)))
        report = {"built_utc": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
                  "products": {key: {"name": config["products"][key]["name"], "pixel_sha256": v["pixel_sha256"],
                                     **v["grid"]} for key, v in inputs.items()},
                  "sources": {s["id"]: {"vertical_offset_m": built[s["id"]].get("vertical_offset_m", 0.0),
                                        **built[s["id"]].get("report", {})} for s in config["sources"]},
                  "coverage": coverage(config, built), "checks": results}
        log("\n5. install into %s" % args.dest)
        manifest = install(config, built, args.dest, report)
    except TerrainBuildError as error:
        log("\nFAILED: %s" % error)
        return 1
    log("\ninstalled %d sources in %s (%.0f s):" % (len(manifest["sources"]), args.dest, time.time() - start))
    for s in manifest["sources"]:
        r = report["sources"][s["id"]]
        log("  %-10s %6d x %-6d px, %2d tile(s), %s, vertical_offset_m %+.2f" %
            (s["id"], r["cols"], r["rows"], r["tiles"], human_bytes(r["bytes_on_disk"]), s["vertical_offset_m"]))
    log("  coverage: %s" % json.dumps(report["coverage"]))
    log("next: python backend/scripts/check_terrain.py")
    return 0


if __name__ == "__main__":
    sys.exit(main())
