import { sandOverlays, type MapCamera, type MapOverlay } from '@/components/map/overlays';
import type { FieldNotice, FieldState } from '@/lib/mission/field';
import { formatClock, formatDistance } from '@/lib/nav/format';
import { cumulativeM, slicePath } from '@/lib/nav/geo';
import { MANEUVER_TEXT, nextMove, type Maneuver } from '@/lib/nav/instructions';
import { DEMO_BOUNDS, elevationAt, slopeAt } from '@/lib/planner';
import type { Route } from '@/lib/planner/types';

export type Cell = { label: string; value: string; unit?: string; tone: 'plain' | 'nominal' | 'caution' };
export type BarCell = { label: string; value: string; unit: string; fraction: number };

export const FIX_STALE_MS = 8 * 60_000; // about 500 m on foot: a photo fix is due (FIX_TARGET_M in controlModel)
export const ERROR_OK_M = 25; // the error the crew aims to stay within
export const CUE_MS = 4 * 60_000; // how long the "fix acquired" and "route changed" cues stay up
export const RANGE_RING_M = 100;
export const FOLLOW_ZOOM = 15.5;

const NO_TIME = '--:--';
const MIN_LEVEL = 0.05;
const MAX_TILT_DEG = 30;

const remainingM = (s: FieldState) => (s.route ? Math.max(0, s.route.lengthM - s.distM) : 0);

// ---------------------------------------------------------------- map

export function fieldOverlays(state: FieldState): MapOverlay[] {
  const { route, pos } = state;
  if (!route || !pos) return [];
  // Sand areas only: at the follow zoom a patch label would just cover the route.
  const o: MapOverlay[] = [...sandOverlays().areas, ...state.hazards.map(h => ({ kind: 'hazard' as const, id: `hazard:${h.id}`, hazard: h }))];

  if (state.distM > 0) {
    const walked = slicePath(route.points, 0, state.distM);
    o.push({ kind: 'route', id: 'route:walked', points: [...walked.slice(0, -1), pos], variant: 'walked' });
  }
  if (state.distM < route.lengthM) {
    const ahead = slicePath(route.points, state.distM, route.lengthM);
    o.push({ kind: 'route', id: 'route:ahead', points: [pos, ...ahead.slice(1)], variant: 'active' });
  }

  const end = route.waypoints.at(-1)!;
  const next = nextMove(route, state.distM);
  const wp = route.waypoints[next.waypointIndex];
  if (wp && wp !== end) o.push({ kind: 'waypoint', id: `waypoint:${next.waypointIndex + 1}`, pos: wp.pos, label: String(next.waypointIndex + 1) });
  o.push({ kind: 'endpoint', id: 'endpoint:end', pos: end.pos, variant: 'end' });

  o.push({ kind: 'ring', id: 'ring:range', center: pos, radiusM: RANGE_RING_M, label: `${RANGE_RING_M} m` });
  o.push({ kind: 'traveller', id: 'traveller', pos, headingDeg: state.headingDeg, errorM: state.posErrorM, variant: 'solid' });
  return o;
}

/** `insetBottomPx`: how much of the map a panel covers at the bottom; the traveller is kept above it. */
export function fieldCamera(state: FieldState, insetBottomPx = 0): MapCamera {
  if (state.pos) return { mode: 'follow', center: state.pos, headingDeg: state.headingDeg, zoom: FOLLOW_ZOOM, insetBottomPx };
  return {
    mode: 'fit',
    points: [{ lat: DEMO_BOUNDS.south, lon: DEMO_BOUNDS.west }, { lat: DEMO_BOUNDS.north, lon: DEMO_BOUNDS.east }],
  };
}

// ---------------------------------------------------------------- readouts

export function fieldCells(state: FieldState): Cell[] {
  const remaining = formatDistance(remainingM(state));
  const moving = state.status === 'moving' && state.paceMps > 0;
  const error = Math.ceil(state.posErrorM);
  const fixAge = state.lastFixMs === null ? null : Math.max(0, state.tMs - state.lastFixMs);
  return [
    { label: 'Distance', value: state.route ? remaining.value : '--', unit: state.route ? remaining.unit : undefined, tone: 'plain' },
    { label: 'ETA', value: moving ? formatClock((remainingM(state) / state.paceMps) * 1000) : NO_TIME, tone: 'plain' },
    { label: state.traveller === 'rover' ? 'Speed' : 'Pace', value: (state.paceMps * 3.6).toFixed(1), unit: 'km/h', tone: 'plain' },
    { label: 'Pos error', value: `±${error}`, unit: 'm', tone: error <= ERROR_OK_M ? 'nominal' : 'caution' },
    {
      label: 'Last fix',
      value: fixAge === null ? NO_TIME : formatClock(fixAge),
      tone: fixAge !== null && fixAge > FIX_STALE_MS ? 'caution' : 'plain',
    },
    { label: 'Elevation', value: state.pos ? Math.round(elevationAt(state.pos)).toLocaleString('en-US') : '--', unit: state.pos ? 'm' : undefined, tone: 'plain' },
  ];
}

/** The four numbers people need: how far, how long, how fast, how sure of the position. Plain labels. */
export function simpleCells(state: FieldState): Cell[] {
  const [distance, eta, pace, error] = fieldCells(state);
  return [
    { ...distance, label: 'Distance left' },
    { ...eta, label: 'Time left' },
    { ...pace, label: 'Speed' },
    { ...error, label: 'Position accuracy' },
  ];
}

/** Metres still to climb on the route ahead (sum of the rises), and the total climb of the route. */
function climb(route: Route, distM: number): { leftM: number; totalM: number } {
  const cum = cumulativeM(route.points);
  let leftM = 0, totalM = 0;
  for (let i = 1; i < cum.length; i++) {
    const rise = Math.max(0, route.elevationM[i] - route.elevationM[i - 1]);
    totalM += rise;
    if (cum[i] > distM) leftM += rise * Math.min(1, (cum[i] - distM) / Math.max(1e-9, cum[i] - cum[i - 1]));
  }
  return { leftM, totalM };
}

/** Real terrain under and ahead of the traveller: slope underfoot (from the 20 m DEM) and the climb still to come. */
export function fieldBars(state: FieldState): BarCell[] {
  const slope = state.pos ? slopeAt(state.pos) : 0;
  const c = state.route ? climb(state.route, state.distM) : { leftM: 0, totalM: 0 };
  return [
    { label: state.traveller === 'rover' ? 'Tilt' : 'Slope', value: String(Math.round(slope)), unit: '°', fraction: Math.max(MIN_LEVEL, slope / MAX_TILT_DEG) },
    { label: 'Climb left', value: String(Math.round(c.leftM)), unit: 'm', fraction: c.totalM > 0 ? Math.max(MIN_LEVEL, c.leftM / c.totalM) : MIN_LEVEL },
  ];
}

// ---------------------------------------------------------------- next move band

export type NextMoveView = {
  maneuver: Maneuver; text: string; distance: { value: string; unit: string };
  waypoint: string; waypointNumber: number; waypointTotal: number; heading: string;
};

export function nextMoveView(state: FieldState): NextMoveView | null {
  const { route } = state;
  if (!route) return null;
  const total = route.waypoints.length;
  const heading = `${String(Math.round(state.headingDeg) % 360).padStart(3, '0')}°`;
  if (state.status === 'arrived') {
    return { maneuver: 'arrive', text: 'Arrived', distance: { value: '0', unit: 'm' }, waypoint: 'End', waypointNumber: total, waypointTotal: total, heading };
  }
  const m = nextMove(route, state.distM);
  const isEnd = m.waypointIndex === total - 1;
  return {
    maneuver: m.maneuver,
    text: MANEUVER_TEXT[m.maneuver],
    distance: formatDistance(Math.max(0, m.distanceM)),
    waypoint: isEnd ? 'End' : `WP ${m.waypointIndex + 1} · ${m.waypointName}`,
    waypointNumber: m.waypointIndex + 1,
    waypointTotal: total,
    heading,
  };
}

// ---------------------------------------------------------------- notices and cues

/** The newest notice Field has not acknowledged yet, or null. */
export function latestUnacked(state: FieldState): FieldNotice | null {
  for (let i = state.notices.length - 1; i >= 0; i--) if (!state.notices[i].acked) return state.notices[i];
  return null;
}

export function fieldCue(state: FieldState): { fix: boolean; routeChanged: boolean; routeChangeId: string | null } {
  const { lastFixMs, startedMs, tMs } = state;
  const fix = state.lastFixKind === 'photo' && lastFixMs !== null && tMs - lastFixMs < CUE_MS;
  const change = [...state.notices].reverse().find(n => n.kind === 'route-changed');
  const routeChanged = change !== undefined && tMs - change.arrivedMs < CUE_MS;
  return { fix, routeChanged, routeChangeId: routeChanged ? change.id : null };
}

// ---------------------------------------------------------------- messages to Control

export const QUICK_REPORTS = [
  'Copy.', 'All nominal.', 'Hazard spotted.', 'Holding position.', 'Request reroute.', 'Need assistance.',
] as const;

/** Where the newest message to Control is, for the LOG button: a countdown while crossing, then DELIVERED. Null before any. */
export function reportStatusShort(state: FieldState): { text: string; tone: 'caution' | 'nominal' } | null {
  const last = state.reports.at(-1);
  if (!last) return null;
  if (last.delivered) return { text: 'DELIVERED', tone: 'nominal' };
  return { text: `▲ ${formatClock(Math.max(0, last.arrivesMs - state.tMs))}`, tone: 'caution' };
}

export type FieldLogEntry = {
  id: string; dir: 'in' | 'out'; text: string; ageMs: number;
  state: string; tone: 'caution' | 'nominal'; ackable: boolean;
};

/** Every message in and out, newest first (as Control's comms log). Incoming ones count from when they reached Field. */
export function fieldLog(state: FieldState): FieldLogEntry[] {
  const age = (sentMs: number) => Math.max(0, state.tMs - sentMs);
  const rows: (FieldLogEntry & { atMs: number })[] = [
    ...state.notices.map(n => ({
      id: n.id, dir: 'in' as const, text: n.text, ageMs: age(n.sentMs), atMs: n.arrivedMs,
      state: n.acked ? 'ACKNOWLEDGED' : 'TAP TO ACKNOWLEDGE', tone: n.acked ? 'nominal' as const : 'caution' as const, ackable: !n.acked,
    })),
    ...state.reports.map(r => ({
      id: r.id, dir: 'out' as const, text: r.text, ageMs: age(r.sentMs), atMs: r.sentMs,
      state: r.delivered ? 'DELIVERED' : `ARRIVES IN ${formatClock(Math.max(0, r.arrivesMs - state.tMs))}`,
      tone: r.delivered ? 'nominal' as const : 'caution' as const, ackable: false,
    })),
  ];
  return rows.sort((a, b) => b.atMs - a.atMs).map(({ atMs: _atMs, ...e }) => e);
}
