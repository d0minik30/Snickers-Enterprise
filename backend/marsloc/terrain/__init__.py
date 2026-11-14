"""Terrain layer: heights from tiled grids at several resolutions. See CONTRACTS.md, section 1.

Only this package knows about files, tiles and resolutions. The rest of the engine asks
Terrain.height(lat, lon).
"""
from .manifest import Manifest, SourceSpec, TerrainError, TileSpec, default_terrain_dir, find_manifest
from .terrain import Terrain

__all__ = ["Manifest", "SourceSpec", "Terrain", "TerrainError", "TileSpec",
           "default_terrain_dir", "find_manifest"]
