import type { MapOverlay } from '@/components/map/overlays';
import type { Tone } from '@/components/shared/Readout';
import { PACE_MPS, type MissionEvent, type TravellerKind } from '@/lib/mission/types';
import { formatClock, formatDistance } from '@/lib/nav/format';
import { bearingDeg, cumulativeM, destination, distanceM, pointAlong } from '@/lib/nav/geo';
import { DEMO_BOUNDS, PRESET_HAZARDS, isInsideHazard, positionErrorM, satellitePasses } from '@/lib/planner';
import type { Hazard, LatLon, Risk, Route, RouteProfile, SatellitePass } from '@/lib/planner/types';

// ---------------------------------------------------------------- route cards

export type RouteSummary = {
  profile: RouteProfile; letter: 'A' | 'B' | 'C'; title: string;
  length: string; time: string; maxSlope: string; risk: Risk; riskLabel: string;
};

const LETTERS: Record<RouteProfile, RouteSummary['letter']> = { safest: 'A', shortest: 'B', flattest: 'C' };
const TITLES: Record<RouteProfile, string> = { safest: 'Safest', shortest: 'Shortest', flattest: 'Flattest' };
const RISK_TONES: Record<Risk, Tone> = { low: 'nominal', medium: 'caution', high: 'danger' };
const STEEP_SLOPE_DEG = 12; // the planner rates a route 'medium' risk above this

export const routeLetter = (profile: RouteProfile) => LETTERS[profile];
export const riskTone = (risk: Risk): Tone => RISK_TONES[risk];
export const slopeTone = (deg: number): Tone => (Math.round(deg) > STEEP_SLOPE_DEG ? 'caution' : 'plain');

/** '2.31 km' or '480 m'. */
export function distanceText(m: number): string {
  const d = formatDistance(m);
  return `${d.value} ${d.unit}`;
}

export function traverseMs(route: Route, traveller: TravellerKind): number {
  return (route.lengthM / PACE_MPS[traveller]) * 1000;
}

export function summarizeRoute(route: Route, traveller: TravellerKind): RouteSummary {
  return {
    profile: route.profile,
    letter: LETTERS[route.profile],
    title: TITLES[route.profile],
    length: distanceText(route.lengthM),
    time: formatClock(traverseMs(route, traveller)),
    maxSlope: `${Math.round(route.maxSlopeDeg)}°`,
    risk: route.risk,
    riskLabel: `Risk ${route.risk}`,
  };
}

// ---------------------------------------------------------------- why route A

function crossedHazards(route: Route, hazards: Hazard[]): Hazard[] {
  return hazards.filter(h => route.points.some(p => isInsideHazard(p, h)));
}

/** 'a', 'a and b', 'a, b and c'. */
function joinAnd(items: string[]): string {
  return items.length < 2 ? items.join('') : `${items.slice(0, -1).join(', ')} and ${items.at(-1)}`;
}

/** 'a', 'a and b', 'a, b, and c': the list form the recommendation uses for its trade-offs. */
function joinClauses(items: string[]): string {
  return items.length < 3 ? items.join(' and ') : `${items.slice(0, -1).join(', ')}, and ${items.at(-1)}`;
}

function minutesSlower(ms: number): string {
  const minutes = Math.round(ms / 60_000);
  return minutes < 1 ? 'under a minute slower' : `${minutes} min slower`;
}

/**
 * Why the safest route is recommended, compared with the shortest one in plain words.
 * Every claim is checked against the numbers: a hazard is named only if the shortest route crosses
 * it and the safest does not, and the slope is mentioned only if the safest route is flatter.
 */
export function recommendationText(routes: Route[], traveller: TravellerKind = 'astronaut', hazards: Hazard[] = PRESET_HAZARDS): string {
  const safest = routes.find(r => r.profile === 'safest');
  const shortest = routes.find(r => r.profile === 'shortest');
  if (!safest || !shortest) return '';

  const safestCrosses = crossedHazards(safest, hazards);
  const avoided = crossedHazards(shortest, hazards).filter(h => !safestCrosses.includes(h));
  const extraM = safest.lengthM - shortest.lengthM;
  const safestSlope = Math.round(safest.maxSlopeDeg);
  const shortestSlope = Math.round(shortest.maxSlopeDeg);
  const flatter = safestSlope < shortestSlope;

  const tradeOffs = extraM >= 1
    ? [`${distanceText(extraM)} longer`, minutesSlower(traverseMs(safest, traveller) - traverseMs(shortest, traveller))]
    : ['no longer than the shortest route'];
  if (flatter) tradeOffs.push(`never steeper than ${safestSlope}°`);
  const summary = joinClauses(tradeOffs);

  if (avoided.length > 0) {
    const names = joinAnd(avoided.map(h => h.label));
    return `Avoids the ${names} that the shortest route crosses. ${summary[0].toUpperCase()}${summary.slice(1)}.`;
  }
  if (flatter) return `The shortest route crosses no hazard but reaches ${shortestSlope}°. Route A is ${summary}.`;
  const fair = 'The shortest route crosses no hazard and is no steeper, so it is a fair choice too.';
  return extraM >= 1 ? `${fair} Route A is ${summary}.` : fair;
}

// ---------------------------------------------------------------- satellite passes

/**
 * Passes strictly inside the traverse window [startMs, startMs + length / pace]. The start counts as a fix,
 * and the stretch from the last pass to the end counts as a gap.
 */
export function passesDuring(
  route: Route, traveller: TravellerKind, startMs: number, schedule: SatellitePass[] = satellitePasses(),
): { passes: SatellitePass[]; longestGapMs: number; worstDriftM: number } {
  const endMs = startMs + traverseMs(route, traveller);
  const passes = schedule.filter(p => p.tMs > startMs && p.tMs < endMs);
  const fixes = [startMs, ...passes.map(p => p.tMs), endMs];
  let longestGapMs = 0;
  for (let i = 1; i < fixes.length; i++) longestGapMs = Math.max(longestGapMs, fixes[i] - fixes[i - 1]);
  return { passes, longestGapMs, worstDriftM: positionErrorM((PACE_MPS[traveller] * longestGapMs) / 1000) };
}

// ---------------------------------------------------------------- waypoint table

export type WaypointLeg = { number: number; name: string; lengthM: number; maxSlopeDeg: number; isEnd: boolean };

/** One leg per waypoint: from the previous waypoint (or the start) to this one, with its steepest slope. */
export function waypointLegs(route: Route): WaypointLeg[] {
  const cum = cumulativeM(route.points);
  let fromM = 0;
  return route.waypoints.map((w, i) => {
    let steepest = 0;
    for (let j = 1; j < cum.length; j++) {
      const run = cum[j] - cum[j - 1];
      if (run <= 0 || cum[j] <= fromM || cum[j - 1] >= w.distM) continue;
      steepest = Math.max(steepest, Math.atan(Math.abs(route.elevationM[j] - route.elevationM[j - 1]) / run));
    }
    const leg = { number: i + 1, name: w.name, lengthM: w.distM - fromM, maxSlopeDeg: (steepest * 180) / Math.PI, isEnd: i === route.waypoints.length - 1 };
    fromM = w.distM;
    return leg;
  });
}

// ---------------------------------------------------------------- map

const LABEL_OFFSET_SHARE = 0.05; // START / END chips sit this share of the fitted area beyond their square
const MIN_FIT_SPAN_M = 600; // the Plan camera never shows less ground than this, so the imagery stays sharp
const LABEL_FRACTIONS = [0.5, 0.45, 0.55, 0.4, 0.6, 0.35, 0.65, 0.3, 0.7, 0.25, 0.75, 0.2, 0.8]; // middle first, so ties stay central

/** Larger side of the box around all the points, in metres. */
function spanM(points: LatLon[]): number {
  const lats = points.map(p => p.lat);
  const lons = points.map(p => p.lon);
  const south = Math.min(...lats), north = Math.max(...lats), west = Math.min(...lons), east = Math.max(...lons);
  const midLat = (south + north) / 2;
  return Math.max(distanceM({ lat: south, lon: west }, { lat: north, lon: west }), distanceM({ lat: midLat, lon: west }, { lat: midLat, lon: east }));
}

/** What the Plan camera fits: the selected route (or just its two ends), widened to at least MIN_FIT_SPAN_M. */
export function planFitPoints(route: Route | undefined, start: LatLon, end: LatLon): LatLon[] {
  const points = route ? route.points : [start, end];
  const lats = points.map(p => p.lat);
  const lons = points.map(p => p.lon);
  const centre = { lat: (Math.min(...lats) + Math.max(...lats)) / 2, lon: (Math.min(...lons) + Math.max(...lons)) / 2 };
  return [...points, ...[0, 90, 180, 270].map(bearing => destination(centre, bearing, MIN_FIT_SPAN_M / 2))];
}

const ROUTE_CLEARANCE_CAP_M = 150; // beyond this, being further from the other routes no longer helps a chip
const FEATURE_CLEARANCE_CAP_M = 300;

const clearanceM = (pos: LatLon, from: LatLon[], capM: number) => Math.min(capM, ...from.map(p => distanceM(p, pos)));

/**
 * The point along the route, away from its ends, where its chip is easiest to read: clear of the other
 * routes first, then of hazards, waypoints, ends and chips already placed. When routes run together the
 * second term still keeps the chips apart.
 */
function routeLabelPos(route: Route, otherRoutes: LatLon[], features: LatLon[]): LatLon {
  let best = pointAlong(route.points, route.lengthM / 2).pos;
  let bestScore = -1;
  for (const f of LABEL_FRACTIONS) {
    const pos = pointAlong(route.points, route.lengthM * f).pos;
    const score = clearanceM(pos, otherRoutes, ROUTE_CLEARANCE_CAP_M) + 0.5 * clearanceM(pos, features, FEATURE_CLEARANCE_CAP_M);
    if (score > bestScore) { best = pos; bestScore = score; }
  }
  return best;
}

function sample<T>(items: T[], every: number): T[] {
  return items.filter((_, i) => i % every === 0);
}

export function planOverlays(routes: Route[], selected: RouteProfile, hazards: Hazard[], start: LatLon | null, end: LatLon | null): MapOverlay[] {
  const active = routes.find(r => r.profile === selected);
  const alternatives = routes.filter(r => r !== active);
  const waypoints = active ? active.waypoints.slice(0, -1) : [];
  const ends = [start, end].filter((p): p is LatLon => p !== null);

  const overlays: MapOverlay[] = hazards.map(h => ({ kind: 'hazard', id: `hazard:${h.id}`, hazard: h }));
  alternatives.forEach((r, i) => overlays.push({
    kind: 'route', id: `route:${r.profile}`, points: r.points, variant: i === 0 ? 'alternative' : 'alternative-dotted',
  }));
  if (active) overlays.push({ kind: 'route', id: `route:${active.profile}`, points: active.points, variant: 'active' });
  waypoints.forEach((w, i) => overlays.push({ kind: 'waypoint', id: `waypoint:${i + 1}`, pos: w.pos, label: String(i + 1) }));
  if (start) overlays.push({ kind: 'endpoint', id: 'endpoint:start', pos: start, variant: 'start' });
  if (end) overlays.push({ kind: 'endpoint', id: 'endpoint:end', pos: end, variant: 'end' });

  // Chips last, so they draw on top.
  for (const h of hazards) overlays.push({ kind: 'label', id: `label:hazard:${h.id}`, pos: h.center, text: h.label, tone: 'caution' });
  const placed: LatLon[] = [];
  for (const r of routes) {
    const otherRoutes = routes.filter(o => o !== r).flatMap(o => sample(o.points, 3));
    const features = [...hazards.map(h => h.center), ...waypoints.map(w => w.pos), ...ends, ...placed];
    const pos = routeLabelPos(r, otherRoutes, features);
    placed.push(pos);
    overlays.push({ kind: 'label', id: `label:route:${r.profile}`, pos, text: `${LETTERS[r.profile]} · ${TITLES[r.profile]}`, tone: r === active ? 'route' : 'plain' });
  }
  if (start && end) {
    // Each chip sits just beyond its square, on the side away from the other end, so it never covers the route.
    // With no route the two squares almost touch, so START goes below and END above.
    const offsetM = spanM(planFitPoints(active, start, end)) * LABEL_OFFSET_SHARE;
    const startSide = active ? bearingDeg(end, start) : 180;
    const endSide = active ? bearingDeg(start, end) : 0;
    overlays.push({ kind: 'label', id: 'label:start', pos: destination(start, startSide, offsetM), text: 'Start', tone: 'plain' });
    overlays.push({ kind: 'label', id: 'label:end', pos: destination(end, endSide, offsetM), text: 'End', tone: 'plain' });
  }
  return overlays;
}

export function insideDemoBounds(p: LatLon): boolean {
  return p.lat >= DEMO_BOUNDS.south && p.lat <= DEMO_BOUNDS.north && p.lon >= DEMO_BOUNDS.west && p.lon <= DEMO_BOUNDS.east;
}

// ---------------------------------------------------------------- mission log and clocks

export type RouteSentEvent = Extract<MissionEvent, { type: 'route-sent' }>;

export function routeSentEvent(log: MissionEvent[]): RouteSentEvent | undefined {
  return log.find((e): e is RouteSentEvent => e.type === 'route-sent');
}

export const EARTH_CLOCK_START_MS = (14 * 3600 + 1 * 60 + 12) * 1000; // 14:01:12 UTC
export const MARS_SOL = 1284;
export const MARS_CLOCK_START_MS = (9 * 3600 + 18 * 60) * 1000; // 09:18:00 local Mars time on sol 1284

const DAY_MS = 86_400_000;

/** 'HH:MM:SS' of the time of day `ms` after midnight, wrapping at 24 h. */
export function timeOfDay(ms: number): string {
  const total = Math.floor((((ms % DAY_MS) + DAY_MS) % DAY_MS) / 1000);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(Math.floor(total / 3600))}:${pad(Math.floor((total % 3600) / 60))}:${pad(total % 60)}`;
}

export function earthClock(missionMs: number): string {
  return timeOfDay(EARTH_CLOCK_START_MS + missionMs);
}

export function marsClock(missionMs: number): { sol: number; time: string } {
  const ms = MARS_CLOCK_START_MS + missionMs;
  return { sol: MARS_SOL + Math.floor(ms / DAY_MS), time: timeOfDay(ms) };
}
