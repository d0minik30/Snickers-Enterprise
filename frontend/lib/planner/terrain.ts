import type { LatLon } from '@/lib/planner/types';
import { MARS_RADIUS_M } from '@/lib/nav/geo';
import jezero from '@/lib/planner/jezeroTerrain.json';

export const DEMO_BOUNDS = { south: 18.415, west: 77.380, north: 18.500, east: 77.480 };

const M_PER_DEG_LAT = (MARS_RADIUS_M * Math.PI) / 180;
const M_PER_DEG_LON = M_PER_DEG_LAT * Math.cos((((DEMO_BOUNDS.south + DEMO_BOUNDS.north) / 2) * Math.PI) / 180);

export type LocalM = { x: number; y: number }; // metres east / north of the south-west corner of DEMO_BOUNDS

export function toLocalM(p: LatLon): LocalM {
  return { x: (p.lon - DEMO_BOUNDS.west) * M_PER_DEG_LON, y: (p.lat - DEMO_BOUNDS.south) * M_PER_DEG_LAT };
}

export function fromLocalM(m: LocalM): LatLon {
  return { lat: DEMO_BOUNDS.south + m.y / M_PER_DEG_LAT, lon: DEMO_BOUNDS.west + m.x / M_PER_DEG_LON };
}

export const AREA_WIDTH_M = (DEMO_BOUNDS.east - DEMO_BOUNDS.west) * M_PER_DEG_LON;
export const AREA_HEIGHT_M = (DEMO_BOUNDS.north - DEMO_BOUNDS.south) * M_PER_DEG_LAT;

// ---------------------------------------------------------------- real Jezero terrain

/**
 * The demo area cut from the data team's 40 m grid (MRO CTX Jezero DEM, 20 m, and USGS sand mapping) by
 * scripts/extract-terrain.mjs. Row 0 is the northern edge, column 0 the western edge.
 */
export const TERRAIN = {
  north: jezero.north,
  west: jezero.west,
  cellDeg: jezero.cellDeg,
  rows: jezero.rows,
  cols: jezero.cols,
  source: jezero.source,
};

function decode(b64: string): Uint8Array {
  if (typeof atob === 'function') return Uint8Array.from(atob(b64), ch => ch.charCodeAt(0));
  return new Uint8Array(Buffer.from(b64, 'base64'));
}

const elevBytes = decode(jezero.elevationDm);
const elevView = new DataView(elevBytes.buffer, elevBytes.byteOffset, elevBytes.byteLength);
const ELEVATION_M = Float32Array.from({ length: TERRAIN.rows * TERRAIN.cols }, (_, i) => elevView.getInt16(i * 2, true) / 10);
const SLOPE_DEG = Float32Array.from(decode(jezero.slopeDegTimes5), v => v / 5);
const SAND = decode(jezero.sand);

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** Fractional (row, col) of a point, measured between cell centres. */
function gridPos(p: LatLon): { r: number; c: number } {
  return { r: (TERRAIN.north - p.lat) / TERRAIN.cellDeg - 0.5, c: (p.lon - TERRAIN.west) / TERRAIN.cellDeg - 0.5 };
}

/** Index of the cell a point falls in, clamped to the extract. */
function cellIndex(p: LatLon): number {
  const r = clamp(Math.floor((TERRAIN.north - p.lat) / TERRAIN.cellDeg), 0, TERRAIN.rows - 1);
  const c = clamp(Math.floor((p.lon - TERRAIN.west) / TERRAIN.cellDeg), 0, TERRAIN.cols - 1);
  return r * TERRAIN.cols + c;
}

/** Height above the Mars areoid in metres, interpolated between 40 m cell centres. */
export function elevationAt(p: LatLon): number {
  const { r, c } = gridPos(p);
  const r0 = clamp(Math.floor(r), 0, TERRAIN.rows - 2);
  const c0 = clamp(Math.floor(c), 0, TERRAIN.cols - 2);
  const fr = clamp(r - r0, 0, 1);
  const fc = clamp(c - c0, 0, 1);
  const at = (rr: number, cc: number) => ELEVATION_M[rr * TERRAIN.cols + cc];
  const top = at(r0, c0) * (1 - fc) + at(r0, c0 + 1) * fc;
  const bottom = at(r0 + 1, c0) * (1 - fc) + at(r0 + 1, c0 + 1) * fc;
  return top * (1 - fr) + bottom * fr;
}

/** Steepest slope (degrees) in the 40 m cell under the point, from the 20 m DEM. */
export function slopeAt(p: LatLon): number {
  return SLOPE_DEG[cellIndex(p)];
}

/** True if the cell under the point is mapped as sand (eolian bedforms). */
export function isSandAt(p: LatLon): boolean {
  return SAND[cellIndex(p)] === 1;
}
