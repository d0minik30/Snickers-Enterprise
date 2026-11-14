import type { LatLon } from '@/lib/planner/types';
import { MARS_RADIUS_M } from '@/lib/nav/geo';
import jezero from '@/lib/planner/jezeroTerrain.json';

export const DEMO_BOUNDS = { south: 18.425, west: 77.340, north: 18.525, east: 77.475 }; // landing site to the Western Delta Deposit; keep in step with scripts/extract-terrain.mjs

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

// ---------------------------------------------------------------- sand areas, for drawing

export type SandArea = { id: string; rings: LatLon[][]; labelAt: LatLon; cells: number };

const MIN_LABELLED_CELLS = 40; // patches smaller than about 6 ha get no label

let sandAreaCache: SandArea[] | undefined;

/**
 * Mapped sand in the demo area, one entry per connected patch. Each patch is a set of rectangles: runs of sand
 * cells along a row, so a patch is drawn as solid 40 m blocks with no seams. Labels sit on the patch's middle cell.
 */
export function sandAreas(): SandArea[] {
  if (sandAreaCache) return sandAreaCache;
  const { rows, cols, north, west, cellDeg } = TERRAIN;
  const inDemo = (r: number, c: number) => {
    const lat = north - (r + 0.5) * cellDeg;
    const lon = west + (c + 0.5) * cellDeg;
    return lat >= DEMO_BOUNDS.south && lat <= DEMO_BOUNDS.north && lon >= DEMO_BOUNDS.west && lon <= DEMO_BOUNDS.east;
  };
  const isSand = (r: number, c: number) => r >= 0 && c >= 0 && r < rows && c < cols && SAND[r * cols + c] === 1 && inDemo(r, c);

  const patch = new Int32Array(rows * cols).fill(-1);
  const patches: number[][] = [];
  for (let start = 0; start < rows * cols; start++) {
    const r0 = Math.floor(start / cols), c0 = start % cols;
    if (patch[start] !== -1 || !isSand(r0, c0)) continue;
    const id = patches.length;
    const cells: number[] = [];
    const stack = [start];
    patch[start] = id;
    while (stack.length) {
      const k = stack.pop()!;
      cells.push(k);
      const r = Math.floor(k / cols), c = k % cols;
      for (const [dr, dc] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const n = (r + dr) * cols + (c + dc);
        if (isSand(r + dr, c + dc) && patch[n] === -1) { patch[n] = id; stack.push(n); }
      }
    }
    patches.push(cells);
  }

  const corner = (r: number, c: number): LatLon => ({ lat: north - r * cellDeg, lon: west + c * cellDeg });
  sandAreaCache = patches.map((cells, id) => {
    const set = new Set(cells);
    const rings: LatLon[][] = [];
    for (const k of [...cells].sort((a, b) => a - b)) {
      const r = Math.floor(k / cols), c = k % cols;
      if (set.has(k - 1) && c > 0) continue; // not the start of a run
      let end = c;
      while (set.has(r * cols + end + 1)) end++;
      rings.push([corner(r, c), corner(r, end + 1), corner(r + 1, end + 1), corner(r + 1, c), corner(r, c)]);
    }
    const mid = cells.reduce((a, k) => ({ r: a.r + Math.floor(k / cols) / cells.length, c: a.c + (k % cols) / cells.length }), { r: 0, c: 0 });
    const nearest = cells.reduce((best, k) =>
      Math.hypot(Math.floor(k / cols) - mid.r, (k % cols) - mid.c) < Math.hypot(Math.floor(best / cols) - mid.r, (best % cols) - mid.c) ? k : best);
    return {
      id: `sand-${id + 1}`,
      rings,
      labelAt: { lat: north - (Math.floor(nearest / cols) + 0.5) * cellDeg, lon: west + ((nearest % cols) + 0.5) * cellDeg },
      cells: cells.length,
    };
  });
  return sandAreaCache;
}

/** Sand patches with at least this many cells get a label on the map. */
export const SAND_MIN_LABELLED_CELLS = MIN_LABELLED_CELLS;
