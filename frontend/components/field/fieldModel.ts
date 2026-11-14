import type { MapCamera, MapOverlay } from '@/components/map/overlays';
import type { FieldNotice, FieldState } from '@/lib/mission/field';
import { formatClock, formatDistance } from '@/lib/nav/format';
import { cumulativeM, slicePath } from '@/lib/nav/geo';
import { MANEUVER_TEXT, nextMove, type Maneuver } from '@/lib/nav/instructions';
import { DEMO_BOUNDS } from '@/lib/planner';
import type { Route } from '@/lib/planner/types';

export type Cell = { label: string; value: string; unit?: string; tone: 'plain' | 'nominal' | 'caution' };
export type BarCell = { label: string; value: string; unit: string; fraction: number };

export const FIX_STALE_MS = 180_000;
export const ERROR_OK_M = 10;
export const CUE_MS = 4 * 60_000; // how long the "fix acquired" and "route changed" cues stay up
export const RANGE_RING_M = 100;
export const FOLLOW_ZOOM = 15.5;

const NO_TIME = '--:--';
const MIN_LEVEL = 0.05;
const MAX_TILT_DEG = 30;

const remainingM = (s: FieldState) => (s.route ? Math.max(0, s.route.lengthM - s.distM) : 0);
const missionMinutes = (s: FieldState) => (s.startedMs === null ? 0 : Math.max(0, s.tMs - s.startedMs) / 60_000);

// ---------------------------------------------------------------- map

export function fieldOverlays(state: FieldState): MapOverlay[] {
  const { route, pos } = state;
  if (!route || !pos) return [];
  const o: MapOverlay[] = state.hazards.map(h => ({ kind: 'hazard', id: `hazard:${h.id}`, hazard: h }));

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

export function fieldCamera(state: FieldState): MapCamera {
  if (state.pos) return { mode: 'follow', center: state.pos, headingDeg: state.headingDeg, zoom: FOLLOW_ZOOM };
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
    { label: 'Next pass', value: state.nextPassMs === null ? NO_TIME : formatClock(state.nextPassMs - state.tMs), tone: 'plain' },
  ];
}

function level(label: string, startPct: number, lossPerMin: number, minutes: number): BarCell {
  const fraction = Math.max(MIN_LEVEL, (startPct - lossPerMin * minutes) / 100);
  return { label, value: String(Math.round(fraction * 100)), unit: '%', fraction };
}

/** Steepest slope of the route segment the traveller is on, in degrees. */
function slopeAt(route: Route, distM: number): number {
  const cum = cumulativeM(route.points);
  let i = 1;
  while (i < cum.length - 1 && cum[i] < distM) i++;
  const run = cum[i] - cum[i - 1];
  if (run <= 0) return 0;
  return (Math.atan(Math.abs(route.elevationM[i] - route.elevationM[i - 1]) / run) * 180) / Math.PI;
}

export function fieldBars(state: FieldState): BarCell[] {
  const minutes = missionMinutes(state);
  if (state.traveller === 'rover') {
    const tilt = state.route ? slopeAt(state.route, state.distM) : 0;
    return [
      level('Battery', 96, 0.5, minutes),
      { label: 'Tilt', value: String(Math.round(tilt)), unit: '°', fraction: Math.max(MIN_LEVEL, tilt / MAX_TILT_DEG) },
    ];
  }
  return [level('O₂', 96, 0.5, minutes), level('Power', 92, 0.25, minutes)];
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
  const fix = lastFixMs !== null && lastFixMs !== startedMs && tMs - lastFixMs < CUE_MS;
  const change = [...state.notices].reverse().find(n => n.kind === 'route-changed');
  const routeChanged = change !== undefined && tMs - change.arrivedMs < CUE_MS;
  return { fix, routeChanged, routeChangeId: routeChanged ? change.id : null };
}
