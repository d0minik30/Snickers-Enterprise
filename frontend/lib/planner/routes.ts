import type { Hazard, LatLon, Risk, Route, RouteProfile, Waypoint } from '@/lib/planner/types';
import { cumulativeM, distanceM, pointAlong, slicePath } from '@/lib/nav/geo';
import { findPath, type Weighting } from '@/lib/planner/astar';
import { elevationAt, fromLocalM, toLocalM, type LocalM } from '@/lib/planner/terrain';

export const DEFAULT_START: LatLon = { lat: 18.4446, lon: 77.4509 }; // Perseverance landing site
export const DEFAULT_END: LatLon = { lat: 18.4890, lon: 77.4080 }; // about 3.56 km away in a straight line
export const MIN_ROUTE_M = 40;
export const FLAG_RADIUS_M = 60;

export const PRESET_HAZARDS: Hazard[] = [
  { id: 'dune-1', center: { lat: 18.4668, lon: 77.4295 }, radiusM: 150, label: 'Dune field', source: 'survey' },
  { id: 'ridge-1', center: { lat: 18.4560, lon: 77.4300 }, radiusM: 120, label: 'Broken ridge', source: 'survey' },
  { id: 'boulder-1', center: { lat: 18.4780, lon: 77.4300 }, radiusM: 100, label: 'Boulder field', source: 'survey' },
  { id: 'crater-1', center: { lat: 18.4520, lon: 77.4150 }, radiusM: 180, label: 'Crater rim', source: 'survey' },
  { id: 'sand-1', center: { lat: 18.4850, lon: 77.4350 }, radiusM: 120, label: 'Soft sand', source: 'survey' },
];

const SIMPLIFY_TOLERANCE_M = 15;
const SMOOTHING_PASSES = 2;
const SLOPE_SAMPLE_M = 20;
const POINT_SPACING_M = 20;
const WAYPOINT_NAMES = ['Landing flats', 'South ridge', 'Boulder gap', 'Delta scarp', 'Sand ripples', 'North terrace'];

type Profile = { slopeWeight: number; avoidsSurvey: boolean; marginM: number };
const PROFILES: Record<RouteProfile, Profile> = {
  safest: { slopeWeight: 1.5, avoidsSurvey: true, marginM: 30 },
  shortest: { slopeWeight: 0, avoidsSurvey: false, marginM: 10 },
  flattest: { slopeWeight: 6, avoidsSurvey: true, marginM: 10 },
};
const PROFILE_ORDER: RouteProfile[] = ['safest', 'shortest', 'flattest'];

export function isInsideHazard(p: LatLon, h: Hazard): boolean {
  return distanceM(p, h.center) <= h.radiusM;
}

type Circle = LocalM & { r: number };

function distToSegmentM(p: LocalM, a: LocalM, b: LocalM): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  const t = len2 === 0 ? 0 : Math.min(1, Math.max(0, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2));
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

/**
 * Douglas-Peucker on local metres. A shortcut is only taken if it stays out of the avoided circles,
 * so simplifying never cuts a corner into the margin the search kept around a hazard (which also absorbs
 * the small amount the smoothing then rounds off).
 */
function simplify(pts: LocalM[], toleranceM: number, avoided: Circle[]): LocalM[] {
  if (pts.length < 3) return pts;
  const a = pts[0];
  const b = pts[pts.length - 1];
  const len = Math.hypot(b.x - a.x, b.y - a.y);
  let worst = -1;
  let worstDist = 0;
  for (let i = 1; i < pts.length - 1; i++) {
    const p = pts[i];
    const d = len === 0
      ? Math.hypot(p.x - a.x, p.y - a.y)
      : Math.abs((b.x - a.x) * (a.y - p.y) - (a.x - p.x) * (b.y - a.y)) / len;
    if (d > worstDist) { worstDist = d; worst = i; }
  }
  const clips = avoided.some(c => distToSegmentM(c, a, b) < c.r);
  if (worstDist <= toleranceM && !clips) return [a, b];
  const split = worst === -1 ? Math.floor(pts.length / 2) : worst;
  return [...simplify(pts.slice(0, split + 1), toleranceM, avoided).slice(0, -1), ...simplify(pts.slice(split), toleranceM, avoided)];
}

/** One Chaikin corner-cutting pass; the end points stay where they are. */
function chaikin(pts: LocalM[]): LocalM[] {
  const out: LocalM[] = [pts[0]];
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i];
    const b = pts[i + 1];
    out.push({ x: 0.75 * a.x + 0.25 * b.x, y: 0.75 * a.y + 0.25 * b.y });
    out.push({ x: 0.25 * a.x + 0.75 * b.x, y: 0.25 * a.y + 0.75 * b.y });
  }
  out.push(pts[pts.length - 1]);
  return out;
}

/** Inserts evenly spaced points so no segment is longer than POINT_SPACING_M. */
function densify(points: LatLon[]): LatLon[] {
  const out: LatLon[] = [points[0]];
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1];
    const b = points[i];
    const steps = Math.max(1, Math.ceil(distanceM(a, b) / POINT_SPACING_M));
    for (let s = 1; s <= steps; s++) {
      const t = s / steps;
      out.push(s === steps ? b : { lat: a.lat + (b.lat - a.lat) * t, lon: a.lon + (b.lon - a.lon) * t });
    }
  }
  return out;
}

const touches = (pts: LocalM[], c: Circle) => pts.some((p, i) => i > 0 && distToSegmentM(c, pts[i - 1], p) < c.r);

/** Simplify, then smooth as far as that keeps the path out of every hazard the simplified path was out of. */
function shapePath(gridPath: LatLon[], start: LatLon, end: LatLon, avoided: Hazard[], marginM: number): LatLon[] {
  const circles = avoided.map(h => ({ ...toLocalM(h.center), r: h.radiusM + marginM }));
  const simplified = simplify(gridPath.map(toLocalM), SIMPLIFY_TOLERANCE_M, circles);
  const guarded = avoided.map(h => ({ ...toLocalM(h.center), r: h.radiusM })).filter(c => !touches(simplified, c));
  let local = simplified;
  for (let passes = 1, next = chaikin(simplified); passes <= SMOOTHING_PASSES; passes++, next = chaikin(next)) {
    if (guarded.some(c => touches(next, c))) break;
    local = next;
  }
  return densify([start, ...local.slice(1, -1).map(fromLocalM), end]);
}

/** Steepest slope between samples at most SLOPE_SAMPLE_M apart along the path. */
function maxSlopeDeg(points: LatLon[]): number {
  let steepest = 0;
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1];
    const b = points[i];
    const segM = distanceM(a, b);
    const steps = Math.max(1, Math.ceil(segM / SLOPE_SAMPLE_M));
    let prev = elevationAt(a);
    for (let s = 1; s <= steps; s++) {
      const t = s / steps;
      const next = elevationAt({ lat: a.lat + (b.lat - a.lat) * t, lon: a.lon + (b.lon - a.lon) * t });
      steepest = Math.max(steepest, Math.atan(Math.abs(next - prev) / (segM / steps)));
      prev = next;
    }
  }
  return (steepest * 180) / Math.PI;
}

function makeWaypoints(points: LatLon[], lengthM: number): Waypoint[] {
  const interior = Math.min(6, Math.max(2, Math.round(lengthM / 500)));
  const waypoints: Waypoint[] = [];
  for (let i = 1; i <= interior; i++) {
    const distM = (lengthM * i) / (interior + 1);
    waypoints.push({ name: WAYPOINT_NAMES[i - 1], distM, pos: pointAlong(points, distM).pos });
  }
  waypoints.push({ name: 'End', distM: lengthM, pos: points[points.length - 1] });
  return waypoints;
}

function routeId(profile: RouteProfile, start: LatLon, end: LatLon, hazards: Hazard[]): string {
  const key = [start, end].map(p => `${p.lat.toFixed(5)},${p.lon.toFixed(5)}`).join('|') +
    '|' + hazards.map(h => h.id).sort().join(',');
  let hash = 5381;
  for (let i = 0; i < key.length; i++) hash = ((hash * 33) ^ key.charCodeAt(i)) >>> 0;
  return `${profile}:${hash.toString(36)}`;
}

function buildRoute(profile: RouteProfile, start: LatLon, end: LatLon, hazards: Hazard[]): Route {
  const p = PROFILES[profile];
  const weighting: Weighting = {
    slopeWeight: p.slopeWeight,
    avoided: hazards.filter(h => p.avoidsSurvey || h.source === 'control'),
    marginM: p.marginM,
  };
  const points = shapePath(findPath(start, end, weighting), start, end, weighting.avoided, weighting.marginM);
  const lengthM = cumulativeM(points).at(-1) ?? 0;
  const slope = maxSlopeDeg(points);
  const inHazard = points.some(pt => hazards.some(h => isInsideHazard(pt, h)));
  const risk: Risk = inHazard ? 'high' : slope > 12 ? 'medium' : 'low';
  return {
    id: routeId(profile, start, end, hazards),
    profile,
    points,
    elevationM: points.map(elevationAt),
    waypoints: makeWaypoints(points, lengthM),
    lengthM,
    maxSlopeDeg: slope,
    risk,
  };
}

/** Exactly [safest, shortest, flattest], or [] when start and end are closer than MIN_ROUTE_M. */
export function planRoutes(start: LatLon, end: LatLon, hazards: Hazard[]): Route[] {
  if (distanceM(start, end) < MIN_ROUTE_M) return [];
  return PROFILE_ORDER.map(profile => buildRoute(profile, start, end, hazards));
}

export function replan(from: LatLon, end: LatLon, hazards: Hazard[], profile: RouteProfile): Route | null {
  if (distanceM(from, end) < MIN_ROUTE_M) return null;
  return buildRoute(profile, from, end, hazards);
}

function elevationAtDist(cum: number[], elevationM: number[], d: number): number {
  let i = 1;
  while (i < cum.length - 1 && cum[i] < d) i++;
  const span = cum[i] - cum[i - 1];
  const t = span === 0 ? 0 : (d - cum[i - 1]) / span;
  return elevationM[i - 1] + (elevationM[i] - elevationM[i - 1]) * t;
}

/** The old route up to branchDistM, then the tail (whose first point is that same position). */
export function spliceRoute(old: Route, branchDistM: number, tail: Route): Route {
  const head = slicePath(old.points, 0, branchDistM);
  const oldCum = cumulativeM(old.points);
  const headElevation = cumulativeM(head).map(d => elevationAtDist(oldCum, old.elevationM, d));
  const points = [...head, ...tail.points.slice(1)];
  const keptWaypoints = old.waypoints.filter(w => w.distM < branchDistM);
  // The tail was planned on its own, so its names start the list again; give it names the kept part has not used.
  const unused = WAYPOINT_NAMES.filter(n => !keptWaypoints.some(w => w.name === n));
  let next = 0;
  const tailWaypoints = tail.waypoints.map(w => ({
    ...w,
    name: WAYPOINT_NAMES.includes(w.name) ? (unused.length ? unused[next++ % unused.length] : w.name) : w.name,
    distM: w.distM + branchDistM,
  }));
  return {
    id: `${old.id}+${tail.id}@${Math.round(branchDistM)}`,
    profile: tail.profile,
    points,
    elevationM: [...headElevation, ...tail.elevationM.slice(1)],
    waypoints: [...keptWaypoints, ...tailWaypoints],
    lengthM: cumulativeM(points).at(-1) ?? 0,
    maxSlopeDeg: Math.max(old.maxSlopeDeg, tail.maxSlopeDeg),
    risk: tail.risk,
  };
}
