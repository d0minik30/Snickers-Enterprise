import { pointAlong } from '@/lib/nav/geo';
import { positionErrorM, satellitePasses } from '@/lib/planner';
import type { Hazard, LatLon, Route, SatellitePass } from '@/lib/planner/types';
import { PACE_MPS, SIGNAL_DELAY_MS, type MissionEvent, type TravellerKind } from '@/lib/mission/types';

export type FieldStatus = 'awaiting-route' | 'ready' | 'moving' | 'holding' | 'arrived';
export type FieldNotice = {
  id: string; kind: 'message' | 'route-changed'; text: string;
  sentMs: number; arrivedMs: number; acked: boolean;
};
/** A message Field sent to Control. Field knows the fixed light delay, so it knows when it lands. */
export type FieldReport = { id: string; text: string; sentMs: number; arrivesMs: number; delivered: boolean };
export type FieldState = {
  tMs: number; status: FieldStatus; traveller: TravellerKind | null;
  route: Route | null; hazards: Hazard[]; distM: number; pos: LatLon | null; headingDeg: number;
  paceMps: number; startedMs: number | null; lastFixMs: number | null; nextPassMs: number | null;
  posErrorM: number; notices: FieldNotice[]; reports: FieldReport[];
};

/** A moment at which an event takes effect at Field. */
type Moment = { atMs: number; event: MissionEvent };

type Walk = {
  status: FieldStatus; traveller: TravellerKind | null; route: Route | null; hazards: Hazard[];
  distM: number; startedMs: number | null; notices: FieldNotice[];
};

function byTimeThenId(a: MissionEvent, b: MissionEvent): number {
  return a.tMs - b.tMs || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
}

function momentsOf(log: MissionEvent[]): Moment[] {
  return [...log]
    .sort(byTimeThenId)
    .map(event => ({ atMs: event.origin === 'control' ? event.tMs + SIGNAL_DELAY_MS : event.tMs, event }))
    .sort((a, b) => a.atMs - b.atMs); // stable: ties keep (tMs, id) order
}

function paceOf(w: Walk): number {
  return w.status === 'moving' && w.traveller ? PACE_MPS[w.traveller] : 0;
}

function advance(w: Walk, dtMs: number): void {
  const pace = paceOf(w);
  if (pace === 0 || !w.route || dtMs <= 0) return;
  w.distM = Math.min(w.route.lengthM, w.distM + (pace * dtMs) / 1000);
  if (w.distM >= w.route.lengthM) w.status = 'arrived';
}

function noticeText(event: Extract<MissionEvent, { type: 'message' | 'route-changed' }>): string {
  if (event.type === 'message') return event.text;
  return event.reason === 'hazard' ? 'Hazard ahead. Route changed by Control.' : 'Route changed by Control.';
}

function apply(w: Walk, { atMs, event }: Moment): void {
  switch (event.type) {
    case 'route-sent':
      if (w.status !== 'awaiting-route') return;
      w.status = 'ready';
      w.traveller = event.traveller;
      w.route = event.route;
      w.hazards = event.hazards;
      return;
    case 'route-changed':
      w.notices.push({ id: event.id, kind: 'route-changed', text: noticeText(event), sentMs: event.tMs, arrivedMs: atMs, acked: false });
      if (!w.route) return;
      w.route = event.route;
      w.hazards = event.hazards;
      w.distM = Math.min(w.distM, event.route.lengthM);
      if (w.distM >= event.route.lengthM && (w.status === 'moving' || w.status === 'holding')) w.status = 'arrived';
      return;
    case 'message':
      w.notices.push({ id: event.id, kind: 'message', text: noticeText(event), sentMs: event.tMs, arrivedMs: atMs, acked: false });
      if (event.order === 'hold' && w.status === 'moving') w.status = 'holding';
      if (event.order === 'proceed' && w.status === 'holding') w.status = 'moving';
      return;
    case 'ack': {
      const notice = w.notices.find(n => n.id === event.targetId);
      if (notice) notice.acked = true;
      return;
    }
    case 'traverse-started':
      if (w.status !== 'ready') return;
      w.status = 'moving';
      w.startedMs = event.tMs;
      return;
    case 'report':
      return; // outgoing only; it changes nothing at Field
  }
}

/** Replays every moment at or before `upToMs`; the log is read, never changed. */
function walk(moments: Moment[], upToMs: number): Walk {
  const w: Walk = { status: 'awaiting-route', traveller: null, route: null, hazards: [], distM: 0, startedMs: null, notices: [] };
  let nowMs = 0;
  for (const m of moments) {
    if (m.atMs > upToMs) break;
    advance(w, m.atMs - nowMs);
    nowMs = Math.max(nowMs, m.atMs);
    apply(w, m);
  }
  advance(w, upToMs - nowMs);
  return w;
}

export function fieldStateAt(log: MissionEvent[], tMs: number, passes: SatellitePass[] = satellitePasses()): FieldState {
  const moments = momentsOf(log);
  const w = walk(moments, tMs);

  const lastPassMs = passes.reduce((best, p) => (p.tMs <= tMs && p.tMs > best ? p.tMs : best), -Infinity);
  const nextPassMs = w.route === null
    ? null
    : passes.reduce<number | null>((best, p) => (p.tMs > tMs && (best === null || p.tMs < best) ? p.tMs : best), null);
  const lastFixMs = w.startedMs === null ? null : Math.max(w.startedMs, lastPassMs);
  const distAtFixM = lastFixMs === null ? 0 : walk(moments, lastFixMs).distM;

  const there = w.route ? pointAlong(w.route.points, w.distM) : null;
  return {
    tMs,
    status: w.status,
    traveller: w.traveller,
    route: w.route,
    hazards: w.hazards,
    distM: w.distM,
    pos: there ? there.pos : null,
    headingDeg: there ? there.bearingDeg : 0,
    paceMps: paceOf(w),
    startedMs: w.startedMs,
    lastFixMs,
    nextPassMs,
    posErrorM: lastFixMs === null ? 1 : positionErrorM(w.distM - distAtFixM),
    notices: w.notices,
    reports: log
      .filter((e): e is Extract<MissionEvent, { type: 'report' }> => e.type === 'report' && e.tMs <= tMs)
      .sort(byTimeThenId)
      .map(e => ({ id: e.id, text: e.text, sentMs: e.tMs, arrivesMs: e.tMs + SIGNAL_DELAY_MS, delivered: e.tMs + SIGNAL_DELAY_MS <= tMs })),
  };
}
