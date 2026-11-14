import type { LatLon } from '@/lib/planner/types';

/** NASA Mars Trek WMTS, equirectangular (EPSG:4326-style) tile set. */
export const TREK_BASE = 'https://trek.nasa.gov/tiles/Mars/EQ';

const TILE_PX = 256;

/** Degrees per pixel at each zoom; zoom 0 is two 256 px tiles across 360 degrees. */
export const MARS_RESOLUTIONS: number[] = Array.from({ length: 18 }, (_, z) => 180 / TILE_PX / 2 ** z);

export type TrekLayer = {
  id: string;
  ext: 'jpg' | 'png';
  minZoom: number;
  maxNativeZoom: number;
  bounds?: { south: number; west: number; north: number; east: number };
};

/** Bottom to top: global colour mosaic, CTX of Jezero, HiRISE of Jezero. */
export const TREK_LAYERS: TrekLayer[] = [
  { id: 'Mars_Viking_MDIM21_ClrMosaic_global_232m', ext: 'jpg', minZoom: 0, maxNativeZoom: 7 },
  {
    id: 'JEZ_ctx_B_soc_008_orthoMosaic_6m_Eqc_latTs0_lon0',
    ext: 'png',
    minZoom: 9,
    maxNativeZoom: 13,
    bounds: { south: 18.2110274, west: 77.1604655, north: 18.7211945, east: 77.6991776 },
  },
  {
    id: 'JEZ_hirise_soc_006_orthoMosaic_25cm_Eqc_latTs0_lon0_first_dd',
    ext: 'png',
    minZoom: 11,
    maxNativeZoom: 17,
    bounds: { south: 18.3067994, west: 77.2229331, north: 18.669315, east: 77.583964 },
  },
];

/** Column and row of the tile containing p; the grid origin is the top-left corner (-180, 90). */
export function tileCoordFor(p: LatLon, z: number): { x: number; y: number } {
  const tileDeg = MARS_RESOLUTIONS[z] * TILE_PX;
  return { x: Math.floor((p.lon + 180) / tileDeg), y: Math.floor((90 - p.lat) / tileDeg) };
}

export function trekTileUrl(layerId: string, ext: string, z: number, x: number, y: number): string {
  return `${TREK_BASE}/${layerId}/1.0.0/default/default028mm/${z}/${y}/${x}.${ext}`;
}
