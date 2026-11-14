// Cuts the demo area out of the data team's Jezero grids and writes it where the route planner can import it:
// lib/planner/jezeroTerrain.json (about 19 000 cells of 40 m, ~100 KB) plus survey hazards found in the data. Runs before `dev` and `build`;
// the output is committed so tests run without the data step.
//
// Reads (read-only, owned by the data team):
//   ../data/output/cost_grid.json        slope_deg and sand, 40 m cells, row 0 = north edge
//   ../data/output/elevation_grid.json   metadata for elevation_grid.bin
//   ../data/output/elevation_grid.bin    int16 decimetres, first layer = mean elevation
//   ../data/output/terrain_features.geojson  lows (pits) used as hazards
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// Keep in step with DEMO_BOUNDS in lib/planner/terrain.ts (a test checks the extract covers it).
const DEMO_BOUNDS = { south: 18.415, west: 77.380, north: 18.500, east: 77.480 };
const MARGIN_CELLS = 3;

const frontend = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const output = resolve(frontend, '..', 'data', 'output');
const target = resolve(frontend, 'lib', 'planner', 'jezeroTerrain.json');

const cost = JSON.parse(readFileSync(resolve(output, 'cost_grid.json'), 'utf8'));
const elevMeta = JSON.parse(readFileSync(resolve(output, 'elevation_grid.json'), 'utf8'));
const elevBin = readFileSync(resolve(output, elevMeta.data_file));

if (elevMeta.rows !== cost.rows || elevMeta.cols !== cost.cols) throw new Error('elevation and cost grids differ');
const [[, lonMin], [latMax]] = [cost.bounds[0], cost.bounds[1]];
const cell = cost.cell_size_deg.lat;
if (Math.abs(cost.cell_size_deg.lon - cell) > 1e-12) throw new Error('expected square cells in degrees');

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const row0 = clamp(Math.floor((latMax - DEMO_BOUNDS.north) / cell) - MARGIN_CELLS, 0, cost.rows - 1);
const row1 = clamp(Math.ceil((latMax - DEMO_BOUNDS.south) / cell) + MARGIN_CELLS, 0, cost.rows);
const col0 = clamp(Math.floor((DEMO_BOUNDS.west - lonMin) / cell) - MARGIN_CELLS, 0, cost.cols - 1);
const col1 = clamp(Math.ceil((DEMO_BOUNDS.east - lonMin) / cell) + MARGIN_CELLS, 0, cost.cols);
const rows = row1 - row0;
const cols = col1 - col0;

const elevation = new Int16Array(rows * cols); // decimetres
const slope = new Uint8Array(rows * cols); // tenths of a degree would overflow; store degrees * 5 (0.2 degree steps, max 51)
const sand = new Uint8Array(rows * cols);
for (let r = 0; r < rows; r++) {
  for (let c = 0; c < cols; c++) {
    const src = (row0 + r) * cost.cols + (col0 + c);
    const i = r * cols + c;
    const e = elevBin.readInt16LE(src * 2);
    if (e === elevMeta.nodata) throw new Error(`no elevation at row ${row0 + r} col ${col0 + c}`);
    elevation[i] = e;
    const s = cost.slope_deg[row0 + r][col0 + c];
    slope[i] = Math.min(255, Math.round((s ?? 0) * 5));
    sand[i] = cost.sand[row0 + r][col0 + c] ? 1 : 0;
  }
}

// ---------------------------------------------------------------- hazards from the data

// Steep cores: clusters of cells steeper than STEEP_DEG (neighbours up to 2 cells apart join), as circles.
// Pits: lows from terrain_features.geojson that are deep and small enough to be a real trap.
const STEEP_DEG = 25;
const MIN_HAZARD_RADIUS_M = 60;
const MIN_SHOWN_RADIUS_M = 90; // smaller cores are left to the slope cost; as circles they only clutter the map
const PIT_MIN_DEPTH_M = 9;
const PIT_MAX_SIZE_M = 600;
const KEEP_CLEAR_M = 200; // no hazard this close to the default start or end (lib/planner/routes.ts)
const DEFAULT_START = { lat: 18.4446, lon: 77.4509 };
const DEFAULT_END = { lat: 18.4890, lon: 77.4080 };
const M_PER_DEG = (3396190 * Math.PI) / 180;
const groundM = (a, b) => Math.hypot((a.lat - b.lat) * M_PER_DEG, (a.lon - b.lon) * M_PER_DEG * Math.cos((a.lat * Math.PI) / 180));
const inDemo = p => p.lat >= DEMO_BOUNDS.south && p.lat <= DEMO_BOUNDS.north && p.lon >= DEMO_BOUNDS.west && p.lon <= DEMO_BOUNDS.east;
const cellCentre = (r, c) => ({ lat: out0.north - (r + 0.5) * cell, lon: out0.west + (c + 0.5) * cell });
const out0 = { north: latMax - row0 * cell, west: lonMin + col0 * cell };

const hazards = [];
const seen = new Uint8Array(rows * cols);
for (let i = 0; i < rows * cols; i++) {
  if (seen[i] || slope[i] / 5 <= STEEP_DEG) continue;
  const cells = [];
  const stack = [i];
  seen[i] = 1;
  while (stack.length) {
    const k = stack.pop();
    cells.push(k);
    const r = Math.floor(k / cols), c = k % cols;
    for (let dr = -2; dr <= 2; dr++) for (let dc = -2; dc <= 2; dc++) {
      const rr = r + dr, cc = c + dc, n = rr * cols + cc;
      if (rr < 0 || cc < 0 || rr >= rows || cc >= cols || seen[n] || slope[n] / 5 <= STEEP_DEG) continue;
      seen[n] = 1;
      stack.push(n);
    }
  }
  const pts = cells.map(k => cellCentre(Math.floor(k / cols), k % cols));
  const center = { lat: pts.reduce((a, p) => a + p.lat, 0) / pts.length, lon: pts.reduce((a, p) => a + p.lon, 0) / pts.length };
  const radiusM = Math.max(MIN_HAZARD_RADIUS_M, Math.max(...pts.map(p => groundM(center, p))) + 20);
  const maxDeg = Math.max(...cells.map(k => slope[k] / 5));
  hazards.push({ center, radiusM, label: `Steep slope ${Math.round(maxDeg)}°`, size: cells.length });
}
hazards.sort((a, b) => b.size - a.size);

const features = JSON.parse(readFileSync(resolve(output, 'terrain_features.geojson'), 'utf8')).features;
for (const f of features) {
  const [lon, lat] = f.geometry.coordinates;
  const { kind, depth_m: depth, size_m: size } = f.properties;
  if (kind !== 'low' || depth < PIT_MIN_DEPTH_M || size > PIT_MAX_SIZE_M) continue;
  hazards.push({ center: { lat, lon }, radiusM: Math.max(MIN_HAZARD_RADIUS_M, size / 2), label: `Pit ${Math.round(depth)} m deep`, size: 0 });
}

const round = (v, d) => Number(v.toFixed(d));
const kept = hazards
  .filter(h => inDemo(h.center) && h.radiusM >= MIN_SHOWN_RADIUS_M)
  .filter(h => groundM(h.center, DEFAULT_START) - h.radiusM >= KEEP_CLEAR_M && groundM(h.center, DEFAULT_END) - h.radiusM >= KEEP_CLEAR_M)
  .map((h, i) => ({
    id: `${h.label.startsWith('Pit') ? 'pit' : 'steep'}-${i + 1}`,
    center: { lat: round(h.center.lat, 5), lon: round(h.center.lon, 5) },
    radiusM: Math.round(h.radiusM),
    label: h.label,
    source: 'survey',
  }));

const b64 = typed => Buffer.from(typed.buffer, typed.byteOffset, typed.byteLength).toString('base64');
const out = {
  note: 'Generated by scripts/extract-terrain.mjs from data/output/cost_grid.json and elevation_grid.bin. Do not edit.',
  source: cost.source,
  north: latMax - row0 * cell, // north edge of row 0
  west: lonMin + col0 * cell, // west edge of column 0
  cellDeg: cell,
  rows,
  cols,
  elevationDm: b64(elevation), // int16 little-endian, row-major, row 0 = north
  slopeDegTimes5: b64(slope), // uint8
  sand: b64(sand), // uint8, 1 = sand
  hazards: kept, // survey hazards: steep cores (> 25 degrees) and deep pits
};
writeFileSync(target, JSON.stringify(out) + '\n');
console.log(`extract-terrain: ${rows} x ${cols} cells, ${kept.length} hazards -> lib/planner/jezeroTerrain.json`);
