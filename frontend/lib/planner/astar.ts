import type { Hazard, LatLon } from '@/lib/planner/types';
import { AREA_HEIGHT_M, AREA_WIDTH_M, fromLocalM, isSandAt, slopeAt, toLocalM } from '@/lib/planner/terrain';

const CELL_M = 20;
const COLS = Math.ceil(AREA_WIDTH_M / CELL_M) + 1;
const ROWS = Math.ceil(AREA_HEIGHT_M / CELL_M) + 1;
const HAZARD_FACTOR = 50;
// Real terrain has short steep spots that a linear slope cost happily crosses; above this angle each extra degree
// costs quadratically more, so slope-aware routes avoid the steepest cells, not just the most climbing.
const STEEP_FROM_DEG = 12;
// Grid paths have many equally cheap staircases; this nudges the search towards the straight line between the
// end points so that a route with no slope weight really hugs it (only the slope-blind profile uses it). Metres of cost per metre off the line, per step.
const OFF_LINE_COST = 0.002;

const NEIGHBOURS = [
  [1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1],
] as const;

/** Real slope and sand under each search node, sampled once from the Jezero grid. */
let terrainGrid: { slope: Float32Array; sand: Uint8Array } | undefined;

function terrain() {
  if (!terrainGrid) {
    const slope = new Float32Array(COLS * ROWS);
    const sand = new Uint8Array(COLS * ROWS);
    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) {
        const p = fromLocalM({ x: c * CELL_M, y: r * CELL_M });
        slope[r * COLS + c] = slopeAt(p);
        sand[r * COLS + c] = isSandAt(p) ? 1 : 0;
      }
    }
    terrainGrid = { slope, sand };
  }
  return terrainGrid;
}

export type Weighting = {
  slopeWeight: number;
  /** Cost multiplier for stepping onto sand (1 = sand is ignored). */
  sandFactor: number;
  /** Hazards this search treats as expensive, with their radius already widened by the margin. */
  avoided: Hazard[];
  marginM: number;
};

function hazardFactors(avoided: Hazard[], marginM: number): Float64Array {
  const factors = new Float64Array(COLS * ROWS).fill(1);
  for (const h of avoided) {
    const c = toLocalM(h.center);
    const reach = h.radiusM + marginM + CELL_M / 2; // half a cell, because a path can clip between cell centres
    for (let r = Math.max(0, Math.floor((c.y - reach) / CELL_M)); r <= Math.min(ROWS - 1, Math.ceil((c.y + reach) / CELL_M)); r++) {
      for (let col = Math.max(0, Math.floor((c.x - reach) / CELL_M)); col <= Math.min(COLS - 1, Math.ceil((c.x + reach) / CELL_M)); col++) {
        if (Math.hypot(col * CELL_M - c.x, r * CELL_M - c.y) <= reach) factors[r * COLS + col] = HAZARD_FACTOR;
      }
    }
  }
  return factors;
}

function cellOf(p: LatLon): number {
  const m = toLocalM(p);
  const c = Math.min(COLS - 1, Math.max(0, Math.round(m.x / CELL_M)));
  const r = Math.min(ROWS - 1, Math.max(0, Math.round(m.y / CELL_M)));
  return r * COLS + c;
}

/** Binary min-heap of [priority, cell] pairs. */
class Heap {
  private items: [number, number][] = [];
  get size() { return this.items.length; }
  push(priority: number, cell: number) {
    const a = this.items;
    a.push([priority, cell]);
    let i = a.length - 1;
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (a[parent][0] <= a[i][0]) break;
      [a[parent], a[i]] = [a[i], a[parent]];
      i = parent;
    }
  }
  pop(): number {
    const a = this.items;
    const top = a[0];
    const last = a.pop()!;
    if (a.length > 0) {
      a[0] = last;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1;
        const r = l + 1;
        let m = i;
        if (l < a.length && a[l][0] < a[m][0]) m = l;
        if (r < a.length && a[r][0] < a[m][0]) m = r;
        if (m === i) break;
        [a[m], a[i]] = [a[i], a[m]];
        i = m;
      }
    }
    return top[1];
  }
}

/** Cheapest 8-neighbour path between the cells nearest the two points, as cell-centre positions. */
export function findPath(start: LatLon, end: LatLon, w: Weighting): LatLon[] {
  const { slope, sand } = terrain();
  const factor = hazardFactors(w.avoided, w.marginM);
  const from = cellOf(start);
  const goal = cellOf(end);
  const goalX = goal % COLS;
  const goalY = Math.floor(goal / COLS);
  const fromX = from % COLS;
  const fromY = Math.floor(from / COLS);
  const lineLen = Math.hypot(goalX - fromX, goalY - fromY);
  const offLineM = (x: number, y: number) =>
    lineLen === 0 ? 0 : (Math.abs((goalX - fromX) * (fromY - y) - (fromX - x) * (goalY - fromY)) / lineLen) * CELL_M;
  const cost = new Float64Array(COLS * ROWS).fill(Infinity);
  const cameFrom = new Int32Array(COLS * ROWS).fill(-1);
  const closed = new Uint8Array(COLS * ROWS);
  const open = new Heap();
  cost[from] = 0;
  open.push(0, from);

  while (open.size > 0) {
    const cur = open.pop();
    if (closed[cur]) continue;
    closed[cur] = 1;
    if (cur === goal) break;
    const cx = cur % COLS;
    const cy = Math.floor(cur / COLS);
    for (const [dx, dy] of NEIGHBOURS) {
      const nx = cx + dx;
      const ny = cy + dy;
      if (nx < 0 || ny < 0 || nx >= COLS || ny >= ROWS) continue;
      const next = ny * COLS + nx;
      if (closed[next]) continue;
      const stepM = CELL_M * Math.hypot(dx, dy);
      const slopeDeg = slope[next];
      const steep = Math.max(0, slopeDeg - STEEP_FROM_DEG);
      const onSand = sand[next] === 1 ? w.sandFactor : 1;
      const terrainCost = 1 + (w.slopeWeight * (slopeDeg + (steep * steep) / 2)) / 10;
      const total =
        cost[cur] + stepM * terrainCost * factor[next] * onSand + (w.slopeWeight === 0 ? OFF_LINE_COST * offLineM(nx, ny) : 0);
      if (total < cost[next]) {
        cost[next] = total;
        cameFrom[next] = cur;
        open.push(total + CELL_M * Math.hypot(nx - goalX, ny - goalY), next);
      }
    }
  }

  const path: LatLon[] = [];
  for (let c = goal; c !== -1; c = cameFrom[c]) {
    path.push(fromLocalM({ x: (c % COLS) * CELL_M, y: Math.floor(c / COLS) * CELL_M }));
    if (c === from) break;
  }
  return path.reverse();
}
