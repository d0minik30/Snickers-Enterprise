#!/usr/bin/env python3
"""Install checksum-pinned terrain GeoTIFFs and write the engine terrain manifest.

Source records live in data/scripts/terrain_sources.json (small, committed JSON).
Large source rasters stay under data/raw/ and backend/data_local/terrain/.
No source is downloaded unless its URL and SHA-256 are explicitly pinned.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import math
import os
import shutil
import sys
import tempfile
import urllib.request
from pathlib import Path, PurePosixPath

RADIUS_M = 3_396_190
CONTRACT_VERSION = "0.1"
ROOT = Path(__file__).resolve().parents[2]
DEFAULT_CONFIG = Path(__file__).with_name("terrain_sources.json")
DEFAULT_DEST = ROOT / "backend" / "data_local" / "terrain"


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def download(url: str, destination: Path) -> None:
    request = urllib.request.Request(url, headers={"User-Agent": "Snickers-Enterprise-terrain/1.0"})
    with urllib.request.urlopen(request, timeout=90) as response, destination.open("wb") as out:
        shutil.copyfileobj(response, out)


def grid_info(path: Path) -> dict:
    try:
        import rasterio
    except ImportError as exc:
        raise RuntimeError("Install data/scripts/requirements.txt (rasterio required)") from exc
    with rasterio.open(path) as ds:
        t = ds.transform
        if ds.count != 1 or ds.width < 1 or ds.height < 1:
            raise ValueError(f"{path}: expected a non-empty single-band GeoTIFF")
        if t.b != 0 or t.d != 0 or t.a <= 0 or t.e >= 0 or t.is_identity:
            raise ValueError(f"{path}: expected north-up, non-rotated raster")
        left, top = t.c, t.f
        right, bottom = left + ds.width * t.a, top + ds.height * t.e
        if ds.crs and ds.crs.is_geographic:
            lon_min, lon_max, lat_min, lat_max = left, right, bottom, top
        elif max(abs(left), abs(right)) < 360 and max(abs(top), abs(bottom)) < 90:
            lon_min, lon_max, lat_min, lat_max = left, right, bottom, top
        else:
            # Contract grid uses equirectangular Mars 2000, standard parallel 0.
            conv = 180 / (math.pi * RADIUS_M)
            lon_min, lon_max, lat_min, lat_max = left * conv, right * conv, bottom * conv, top * conv
        pixel_ns = math.radians((lat_max - lat_min) / ds.height) * RADIUS_M
        pixel_ew = math.radians((lon_max - lon_min) / ds.width) * RADIUS_M * math.cos(math.radians((lat_min + lat_max) / 2))
        nodata = ds.nodata
        if nodata is None:
            nodata = "NaN"
        return {"bounds": [[lat_min, lon_min], [lat_max, lon_max]], "rows": ds.height,
                "cols": ds.width, "nodata": nodata, "cell_ns_m": pixel_ns, "cell_ew_m": pixel_ew}


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--config", type=Path, default=DEFAULT_CONFIG)
    parser.add_argument("--dest", type=Path, default=DEFAULT_DEST)
    args = parser.parse_args()
    if not args.config.is_file():
        raise SystemExit(f"Missing pinned source configuration: {args.config}")
    config = json.loads(args.config.read_text(encoding="utf-8"))
    sources = config.get("sources")
    if not isinstance(sources, list) or not sources:
        raise SystemExit("Configuration must contain a non-empty sources list")

    # Validate and stage all inputs before replacing anything in the destination.
    prepared = []
    for source in sources:
        for key in ("id", "priority", "cell_size_m", "file", "sha256"):
            if key not in source:
                raise SystemExit(f"Source record is missing {key!r}")
        rel = PurePosixPath(source["file"])
        if rel.is_absolute() or ".." in rel.parts or rel.name == "terrain.json":
            raise SystemExit(f"Unsafe tile file path: {rel}")
        expected = str(source["sha256"]).lower()
        if len(expected) != 64 or any(ch not in "0123456789abcdef" for ch in expected):
            raise SystemExit(f"{source['id']}: sha256 must be 64 lowercase/uppercase hex characters")
        local = ROOT / source["local_file"] if source.get("local_file") else None
        if local and local.is_file():
            actual_source = local
        elif source.get("url"):
            actual_source = None
        else:
            raise SystemExit(f"{source['id']}: provide an existing local_file or official url")
        args.dest.mkdir(parents=True, exist_ok=True)
        fd, tmp_name = tempfile.mkstemp(prefix=".terrain-", suffix=".tif", dir=args.dest)
        os.close(fd)
        tmp = Path(tmp_name)
        try:
            if actual_source:
                shutil.copyfile(actual_source, tmp)
            else:
                download(source["url"], tmp)
            actual_hash = sha256(tmp)
            if actual_hash != expected:
                raise SystemExit(f"{source['id']}: SHA-256 mismatch: expected {expected}, got {actual_hash}")
            info = grid_info(tmp)
            bounds = source.get("bounds", info["bounds"])
            if len(bounds) != 2 or len(bounds[0]) != 2 or len(bounds[1]) != 2:
                raise SystemExit(f"{source['id']}: invalid bounds")
            # A source may intentionally use its declared coarser nominal scale.
            prepared.append((source, tmp, info, bounds))
        except BaseException:
            tmp.unlink(missing_ok=True)
            raise

    manifest_sources = []
    for source, tmp, info, bounds in prepared:
        relative = PurePosixPath(source["file"])
        dest_file = args.dest.joinpath(*relative.parts)
        dest_file.parent.mkdir(parents=True, exist_ok=True)
        os.replace(tmp, dest_file)
        entry = {"id": source["id"], "description": source.get("description", ""),
                 "priority": int(source["priority"]), "cell_size_m": float(source["cell_size_m"]),
                 "nodata": info["nodata"], "vertical_offset_m": float(source.get("vertical_offset_m", 0)),
                 "tiles": [{"file": relative.as_posix(), "bounds": bounds,
                            "rows": info["rows"], "cols": info["cols"]}]}
        manifest_sources.append(entry)
    manifest = {"contract_version": CONTRACT_VERSION, "sphere_radius_m": RADIUS_M,
                "vertical_datum": "mars_areoid_mola", "units": "m", "sources": manifest_sources}
    tmp_manifest = args.dest / ".terrain.json.tmp"
    tmp_manifest.write_text(json.dumps(manifest, indent=2, allow_nan=False) + "\n", encoding="utf-8", newline="\n")
    tmp_manifest.replace(args.dest / "terrain.json")
    print(f"Installed {len(manifest_sources)} checksum-verified source(s) in {args.dest}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
