import { pointAlong } from '@/lib/nav/geo';
import { satellitePasses } from '@/lib/planner';
import type { Hazard, LatLon, Route, SatellitePass } from '@/lib/planner/types';
import { fieldStateAt, type FieldState } from '@/lib/mission/field';
import { PACE_MPS, SIGNAL_DELAY_MS, type MissionEvent, type TravellerKind } from '@/lib/mission/types';

export type ControlEvent = Extract<MissionEvent, { origin: 'control' }>;
type RouteEvent = Extract<MissionEvent, { type: 'route-sent' | 'route-changed' }>;

export type UplinkStatus = 'in-transit' | 'delivered' | 'acknowledged';
export type Uplink = {
  event: ControlEvent; sentMs: number; arrivesMs: number; status: UplinkStatus; progress: number; // progress 0..1
};
export type Downlink = { id: string; kind: 'traverse-started' | 'ack'; sentMs: number; receivedMs: number };
export type ControlHazard = Hazard & { atField: boolean };
export type ControlView = {
  tMs: number; dataAgeMs: number; traveller: TravellerKind | null; received: FieldState;
  estimatedNow: { distM: number; pos: LatLon } | null; activeRoute: Route | null; pendingRoute: Route | null;
  hazards: ControlHazard[]; uplinks: Uplink[]; downlinks: Downlink[];
};

const REROUTE_MARGIN_M = 20;

function byTimeThenId(a: MissionEvent, b: MissionEvent): number {
  return a.tMs - b.tMs || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
}

function isControlEvent(e: MissionEvent): e is ControlEvent {
  return e.origin === 'control';
}

function isRouteEvent(e: MissionEvent): e is RouteEvent {
  return e.type === 'route-sent' || e.type === 'route-changed';
}

function uplinkStatus(e: ControlEvent, tMs: number, acks: MissionEvent[]): UplinkStatus {
  if (e.tMs + SIGNAL_DELAY_MS > tMs) return 'in-transit';
  const acked = acks.some(a => a.type === 'ack' && a.targetId === e.id && a.tMs + SIGNAL_DELAY_MS <= tMs);
  return acked ? 'acknowledged' : 'delivered';
}

export function controlViewAt(log: MissionEvent[], tMs: number, passes: SatellitePass[] = satellitePasses()): ControlView {
  const sentEvents = log.filter(e => e.tMs <= tMs).sort(byTimeThenId);
  const received = fieldStateAt(log, tMs - SIGNAL_DELAY_MS, passes);

  const uplinkEvents = sentEvents.filter(isControlEvent);
  const routeEvents = uplinkEvents.filter(isRouteEvent);
  const routeSent = routeEvents.find(e => e.type === 'route-sent');
  const traveller = routeSent?.type === 'route-sent' ? routeSent.traveller : null;
  const arrived = routeEvents.filter(e => e.tMs + SIGNAL_DELAY_MS <= tMs);
  const inTransit = routeEvents.filter(e => e.tMs + SIGNAL_DELAY_MS > tMs);
  const newestSent = routeEvents.at(-1);
  const newestArrived = arrived.at(-1);

  const acks = sentEvents.filter(e => e.type === 'ack');
  const uplinks: Uplink[] = uplinkEvents.map(event => ({
    event,
    sentMs: event.tMs,
    arrivesMs: event.tMs + SIGNAL_DELAY_MS,
    status: uplinkStatus(event, tMs, acks),
    progress: Math.min(1, Math.max(0, (tMs - event.tMs) / SIGNAL_DELAY_MS)),
  }));

  const downlinks: Downlink[] = [];
  for (const e of sentEvents) {
    if ((e.type === 'traverse-started' || e.type === 'ack') && e.tMs + SIGNAL_DELAY_MS <= tMs) {
      downlinks.push({ id: e.id, kind: e.type, sentMs: e.tMs, receivedMs: e.tMs + SIGNAL_DELAY_MS });
    }
  }

  const atField = new Set((newestArrived?.hazards ?? []).map(h => h.id));
  return {
    tMs,
    dataAgeMs: SIGNAL_DELAY_MS,
    traveller,
    received,
    estimatedNow: estimateNow(received, traveller),
    activeRoute: newestArrived?.route ?? null,
    pendingRoute: inTransit.at(-1)?.route ?? null,
    hazards: (newestSent?.hazards ?? []).map(h => ({ ...h, atField: atField.has(h.id) })),
    uplinks,
    downlinks,
  };
}

function estimateNow(received: FieldState, traveller: TravellerKind | null): ControlView['estimatedNow'] {
  if (!received.pos || !received.route) return null;
  if (received.status !== 'moving' || !traveller) return { distM: received.distM, pos: received.pos };
  const distM = Math.min(received.route.lengthM, received.distM + (PACE_MPS[traveller] * SIGNAL_DELAY_MS) / 1000);
  return { distM, pos: pointAlong(received.route.points, distM).pos };
}

/** The furthest the traveller can be when a signal sent now lands: an upper bound. */
export function predictBranchDistM(view: ControlView): number {
  const latest = view.pendingRoute ?? view.activeRoute;
  if (!latest || !view.traveller) return 0;
  const reach = view.received.distM + (PACE_MPS[view.traveller] * 2 * SIGNAL_DELAY_MS) / 1000;
  return Math.min(latest.lengthM, reach);
}

export function canReroute(view: ControlView): boolean {
  const latest = view.pendingRoute ?? view.activeRoute;
  if (!latest) return false;
  return predictBranchDistM(view) < latest.lengthM - REROUTE_MARGIN_M;
}
