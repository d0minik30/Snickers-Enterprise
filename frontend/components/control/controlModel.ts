import { sandOverlays, type MapOverlay } from '@/components/map/overlays';
import type { Tone } from '@/components/shared/Readout';
import { hhmmss, lmstMs, perseveranceSol } from '@/lib/mission/marsTime';
import { canReroute, predictBranchDistM, type ControlView, type Uplink } from '@/lib/mission/control';
import { RESERVE_PERCENT, costPercent, lifeSupportAt } from '@/lib/mission/lifeSupport';
import { PACE_MPS, SIGNAL_DELAY_MS, type MissionEvent, type TravellerKind } from '@/lib/mission/types';
import { formatClock, formatDistance } from '@/lib/nav/format';
import { bearingDeg, cumulativeM, destination, distanceM, pointAlong, slicePath } from '@/lib/nav/geo';
import { DEMO_BOUNDS, DRIFT_PER_M, PHOTO_FIX_ERROR_M, PRESET_HAZARDS, isInsideHazard, positionErrorM, replan, spliceRoute } from '@/lib/planner';
import type { Hazard, LatLon, Risk, Route, RouteProfile } from '@/lib/planner/types';

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
    const names = joinAnd(avoided.map(h => h.label.charAt(0).toLowerCase() + h.label.slice(1)));
    return `Avoids the ${names} that the shortest route crosses. ${summary[0].toUpperCase()}${summary.slice(1)}.`;
  }
  if (flatter) return `The shortest route crosses no hazard but reaches ${shortestSlope}°. Route A is ${summary}.`;
  const fair = 'The shortest route crosses no hazard and is no steeper, so it is a fair choice too.';
  return extraM >= 1 ? `${fair} Route A is ${summary}.` : fair;
}

// ---------------------------------------------------------------- photo fixes

/** The position error the crew should stay within; a photo fix is due before drift passes it. A fix alone is ±47 m. */
export const FIX_TARGET_M = 100;

/**
 * How often the crew needs a photo fix on a route to stay within FIX_TARGET_M, and how far drift would grow
 * with none. No GPS on Mars: between fixes the crew dead-reckons (lib/planner/drift.ts).
 */
export function fixPlan(route: Route, targetM: number = FIX_TARGET_M): { everyM: number; fixes: number; noFixErrorM: number } {
  const everyM = Math.max(1, (targetM - PHOTO_FIX_ERROR_M) / DRIFT_PER_M);
  return {
    everyM,
    fixes: Math.max(0, Math.ceil(route.lengthM / everyM) - 1),
    noFixErrorM: positionErrorM(route.lengthM),
  };
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

  const sand = sandOverlays();
  const overlays: MapOverlay[] = [...sand.areas, ...hazards.map(h => ({ kind: 'hazard' as const, id: `hazard:${h.id}`, hazard: h }))];
  alternatives.forEach((r, i) => overlays.push({
    kind: 'route', id: `route:${r.profile}`, points: r.points, variant: i === 0 ? 'alternative' : 'alternative-dotted',
  }));
  if (active) overlays.push({ kind: 'route', id: `route:${active.profile}`, points: active.points, variant: 'active' });
  waypoints.forEach((w, i) => overlays.push({ kind: 'waypoint', id: `waypoint:${i + 1}`, pos: w.pos, label: String(i + 1) }));
  if (start) overlays.push({ kind: 'endpoint', id: 'endpoint:start', pos: start, variant: 'start' });
  if (end) overlays.push({ kind: 'endpoint', id: 'endpoint:end', pos: end, variant: 'end' });

  // Chips last, so they draw on top.
  overlays.push(...sand.labels);
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

/**
 * Real clocks. Mission time 0 is the real UTC moment the mission was started (the snapshot epoch, set by
 * useMission through setClockEpoch); mission time runs at the demo speed from there. Mars time is the real
 * local mean solar time at Jezero for that instant, and the sol is Perseverance's mission sol (Mars24).
 */
let clockEpochUtcMs = Date.UTC(2026, 10, 14, 14, 0, 0);

export function setClockEpoch(utcMs: number): void {
  clockEpochUtcMs = utcMs;
}

export const timeOfDay = hhmmss;

/** UTC 'HH:MM:SS' at a mission time. */
export function earthClock(missionMs: number): string {
  return hhmmss(clockEpochUtcMs + missionMs);
}

/** Perseverance sol and LMST 'HH:MM:SS' at Jezero at a mission time. */
export function marsClock(missionMs: number): { sol: number; time: string } {
  const utc = clockEpochUtcMs + missionMs;
  return { sol: perseveranceSol(utc), time: hhmmss(lmstMs(utc)) };
}

// ---------------------------------------------------------------- Live mode

const TRAVELLER_LABEL_OFFSET_PX = 28; // label chips sit this far above or below their marker
const EARLIEST_REROUTE_TICK_M = 140; // length of the line drawn across the route at the earliest reroute point

const routeEvents = (view: ControlView) =>
  view.uplinks.filter(u => u.event.type === 'route-sent' || u.event.type === 'route-changed');

/** The newest route Control has sent, whether or not it has reached the field yet. */
export function newestRoute(view: ControlView): Route | null {
  return view.pendingRoute ?? view.activeRoute;
}

/** Index of the first point where `b` stops matching `a` (both start the same when one is spliced from the other). */
function divergence(a: LatLon[], b: LatLon[]): number {
  let i = 0;
  while (i < a.length && i < b.length && a[i].lat === b[i].lat && a[i].lon === b[i].lon) i++;
  return i;
}

function midpoint(points: LatLon[]): LatLon {
  return pointAlong(points, (cumulativeM(points).at(-1) ?? 0) / 2).pos;
}

/** `quiet` drops the text tags a jury doesn't need (hazard and sand names, the earliest-reroute mark). */
export function liveOverlays(view: ControlView, { quiet = false }: { quiet?: boolean } = {}): MapOverlay[] {
  const { received, activeRoute, pendingRoute, estimatedNow } = view;
  const shown = newestRoute(view);
  const dist = received.route ? received.distM : 0;
  const pos = received.pos;
  const o: MapOverlay[] = [];
  const labels: MapOverlay[] = [];

  for (const h of view.hazards) {
    const notYet = !h.atField && h.source === 'control';
    o.push({ kind: 'hazard', id: `hazard:${h.id}`, hazard: h, pending: notYet });
    if (notYet || !quiet) labels.push(notYet
      ? { kind: 'label', id: `label:hazard:${h.id}`, pos: h.center, text: 'MARKED · CREW NOT TOLD YET', tone: 'inverse', offsetY: 20 }
      : { kind: 'label', id: `label:hazard:${h.id}`, pos: h.center, text: h.label, tone: 'caution' });
  }

  if (received.route && pos && dist > 0) {
    const walked = slicePath(received.route.points, 0, dist);
    o.push({ kind: 'route', id: 'route:walked', points: [...walked.slice(0, -1), pos], variant: 'walked' });
  }
  if (activeRoute && dist < activeRoute.lengthM) {
    o.push({ kind: 'route', id: 'route:active', points: slicePath(activeRoute.points, dist, activeRoute.lengthM), variant: 'active' });
  }
  if (pendingRoute) {
    const from = activeRoute ? divergence(activeRoute.points, pendingRoute.points) : 0;
    const part = pendingRoute.points.slice(Math.max(0, from - 1));
    if (part.length >= 2) {
      o.push({ kind: 'route', id: 'route:pending', points: part, variant: 'pending' });
      const uplink = routeEvents(view).filter(u => u.status === 'in-transit').at(-1);
      const inText = uplink ? ` · ARRIVES IN ${formatClock(Math.max(0, uplink.arrivesMs - view.tMs))}` : '';
      const name = activeRoute ? 'REROUTE' : `ROUTE ${LETTERS[pendingRoute.profile]}`;
      labels.push({ kind: 'label', id: 'label:pending', pos: midpoint(part), text: `${name}${inText}`, tone: 'route' });
    }
  }

  if (shown) {
    shown.waypoints.slice(0, -1).forEach((w, i) => {
      if (w.distM > dist) o.push({ kind: 'waypoint', id: `waypoint:${i + 1}`, pos: w.pos, label: String(i + 1) });
    });
    o.push({ kind: 'endpoint', id: 'endpoint:start', pos: shown.points[0], variant: 'start' });
    o.push({ kind: 'endpoint', id: 'endpoint:end', pos: shown.points[shown.points.length - 1], variant: 'end' });
    if (!quiet && canReroute(view)) { // a hazard flagged before this point cannot be routed around
      const { pos: at, bearingDeg: heading } = pointAlong(shown.points, predictBranchDistM(view));
      const half = EARLIEST_REROUTE_TICK_M / 2;
      o.push({
        kind: 'route', id: 'reroute:earliest', variant: 'walked',
        points: [destination(at, heading - 90, half), destination(at, heading + 90, half)],
      });
      labels.push({ kind: 'label', id: 'label:reroute:earliest', pos: at, text: 'EARLIEST REROUTE', tone: 'route', offsetY: TRAVELLER_LABEL_OFFSET_PX });
    }
  }

  if (pos && received.route) {
    if (estimatedNow && distanceM(estimatedNow.pos, pos) > 1) {
      o.push({
        kind: 'traveller', id: 'traveller:estimated', pos: estimatedNow.pos, variant: 'ghost',
        headingDeg: pointAlong(received.route.points, estimatedNow.distM).bearingDeg,
        errorM: received.posErrorM + 0.02 * (estimatedNow.distM - dist),
      });
      labels.push({ kind: 'label', id: 'label:estimated', pos: estimatedNow.pos, text: 'ESTIMATED NOW', tone: 'plain', offsetY: -TRAVELLER_LABEL_OFFSET_PX });
    }
    o.push({ kind: 'traveller', id: 'traveller:received', pos, headingDeg: received.headingDeg, errorM: received.posErrorM, variant: 'solid' });
    labels.push({
      kind: 'label', id: 'label:received', pos, tone: 'plain', offsetY: TRAVELLER_LABEL_OFFSET_PX,
      text: `LAST RECEIVED · ${formatClock(view.dataAgeMs)} OLD`,
    });
  }
  const sand = sandOverlays();
  return [...sand.areas, ...o, ...(quiet ? [] : sand.labels), ...labels];
}

/** A hazard this close to the stretch the traveller covers before a new route lands cannot be routed around. */
const REROUTE_CLEARANCE_M = 30;

export type RerouteBlocker = 'too-late' | 'too-close';

/**
 * Why Control cannot send a reroute right now, or null when it can.
 * 'too-late': the traveller will have arrived before a new route lands.
 * 'too-close': `hazard` lies on the stretch the traveller walks before a new route lands (from the last
 * received position to the earliest reroute point), so any new route would still lead through it.
 */
export function rerouteBlocker(view: ControlView, hazard: Hazard | null): RerouteBlocker | null {
  const newest = newestRoute(view);
  if (!newest || !canReroute(view)) return 'too-late';
  if (!hazard) return null;
  const from = view.received.route ? view.received.distM : 0;
  const committed = slicePath(newest.points, from, predictBranchDistM(view));
  const reach = hazard.radiusM + REROUTE_CLEARANCE_M;
  return committed.some(p => distanceM(p, hazard.center) <= reach) ? 'too-close' : null;
}

/**
 * A new route from where the traveller can be when the signal lands, to the same end, around every hazard
 * Control knows plus `newHazard`. Null when `rerouteBlocker` says no or nothing can be planned.
 */
export function buildReroute(view: ControlView, newHazard: Hazard | null): { route: Route; hazards: Hazard[] } | null {
  const newest = newestRoute(view);
  if (!newest || rerouteBlocker(view, newHazard)) return null;
  const branchDistM = predictBranchDistM(view);
  const branch = pointAlong(newest.points, branchDistM).pos;
  const hazards: Hazard[] = view.hazards.map(({ atField: _atField, ...h }) => h);
  if (newHazard) hazards.push(newHazard);
  const tail = replan(branch, newest.points[newest.points.length - 1], hazards, newest.profile);
  if (!tail) return null;
  return { route: spliceRoute(newest, branchDistM, tail), hazards };
}

// ---------------------------------------------------------------- oxygen (battery) on reroutes

const PROFILES: RouteProfile[] = ['safest', 'shortest', 'flattest'];

/** Oxygen (battery) as Field last reported it; a full tank when nothing has been heard yet. */
function receivedPercent(view: ControlView): number | null {
  if (!view.traveller) return null;
  return lifeSupportAt(view.received)?.percent ?? 100;
}

/**
 * What will be left when a route sent now lands: from the received state through both signal delays.
 * Holding (or arrived) costs rest for that time; otherwise the crew is assumed to keep going to the
 * furthest point a new route can meet them (`predictBranchDistM`), the cautious case.
 */
export function branchPercent(view: ControlView): number | null {
  const now = receivedPercent(view);
  if (now === null || !view.traveller) return null;
  const still = view.received.status === 'holding' || view.received.status === 'arrived';
  return now - (still
    ? costPercent(view.traveller, 0, 2 * SIGNAL_DELAY_MS)
    : costPercent(view.traveller, predictBranchDistM(view) - view.received.distM, 0));
}

/** Expected on arrival on the newest route, projected from the received state. Unclamped. */
export function projectedArrivalPercent(view: ControlView): number | null {
  const now = receivedPercent(view);
  const route = newestRoute(view);
  if (now === null || !route || !view.traveller) return null;
  const restMs = view.received.status === 'holding' ? SIGNAL_DELAY_MS : 0;
  return now - costPercent(view.traveller, route.lengthM - view.received.distM, restMs);
}

export type RerouteOption = {
  kind: 'around' | 'back' | 'anyway'; route: Route; hazards: Hazard[]; endPercent: number; keepsReserve: boolean;
};
export type OxygenCheck = { options: RerouteOption[]; pick: RerouteOption['kind']; noneKeeps: boolean };

/**
 * A reroute with its oxygen (battery) checked. `send`: it keeps the reserve, send it as it is. `check`:
 * it doesn't, so Control chooses between going around the hazard the way that leaves the most, turning
 * back to the trip's start, or sending it anyway; `pick` is the app's recommendation. Null exactly when
 * `buildReroute` is null (too late, too close, nothing to plan).
 */
export function planReroute(view: ControlView, newHazard: Hazard | null): { send: RerouteOption } | { check: OxygenCheck } | null {
  const plain = buildReroute(view, newHazard);
  const newest = newestRoute(view);
  const atBranch = branchPercent(view);
  if (!plain || !newest || atBranch === null || !view.traveller) return null;
  const traveller = view.traveller;
  const branchDistM = predictBranchDistM(view);
  // A crew standing still is still where it stood when the new route lands: it walks from there.
  const still = view.received.status === 'holding' || view.received.status === 'arrived';
  const fromDistM = still ? view.received.distM : branchDistM;
  const option = (kind: RerouteOption['kind'], route: Route): RerouteOption => {
    const endPercent = atBranch - costPercent(traveller, route.lengthM - fromDistM, 0);
    return { kind, route, hazards: plain.hazards, endPercent, keepsReserve: endPercent >= RESERVE_PERCENT };
  };

  const anyway = option('anyway', plain.route);
  if (anyway.keepsReserve) return { send: anyway };

  const branch = pointAlong(newest.points, branchDistM).pos;
  const spliced = (to: LatLon, profile: RouteProfile) => {
    const tail = replan(branch, to, plain.hazards, profile);
    return tail ? spliceRoute(newest, branchDistM, tail) : null;
  };
  const around = PROFILES
    .map(p => spliced(newest.points[newest.points.length - 1], p))
    .filter((r): r is Route => r !== null)
    .map(r => option('around', r))
    .reduce<RerouteOption | null>((best, o) => (!best || o.endPercent > best.endPercent ? o : best), null);
  const backRoute = spliced(newest.points[0], newest.profile);
  const back = backRoute ? option('back', backRoute) : null;

  const options = [around, back, around && around.route.id === anyway.route.id ? null : anyway]
    .filter((o): o is RerouteOption => o !== null);
  const keeper = [around, back].find(o => o?.keepsReserve);
  const pick = keeper ?? options.reduce((best, o) => (o.endPercent > best.endPercent ? o : best));
  return { check: { options, pick: pick.kind, noneKeeps: !keeper } };
}

export function uplinkText(u: Uplink): string {
  const e = u.event;
  if (e.type === 'message') return e.text;
  if (e.type === 'route-sent') return 'Route sent.';
  return e.reason === 'hazard' ? 'Hazard ahead. Route changed by Control.' : 'Route changed by Control.';
}

/** Progress along the route the field last reported: '0.65 of 2.00 km', 'LEG 2 OF 4'. */
export function liveProgress(view: ControlView): { fraction: number; text: string; leg: string } | null {
  const { route, distM } = view.received;
  if (!route) return null;
  const legs = route.waypoints.length;
  const next = route.waypoints.findIndex(w => w.distM > distM);
  const km = (m: number) => (m / 1000).toFixed(2);
  return {
    fraction: route.lengthM > 0 ? distM / route.lengthM : 0,
    text: `${km(distM)} of ${km(route.lengthM)} km`,
    leg: `LEG ${next === -1 ? legs : next + 1} OF ${legs}`,
  };
}
