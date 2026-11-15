import { describe, expect, it } from 'vitest';
import { branchPercent, buildReroute, liveOverlays, liveProgress, planReroute, projectedArrivalPercent, rerouteBlocker, uplinkText } from '@/components/control/controlModel';
import { RESERVE_PERCENT, costPercent, lifeSupportAt } from '@/lib/mission/lifeSupport';
import { controlViewAt, predictBranchDistM } from '@/lib/mission/control';
import { PACE_MPS, SIGNAL_DELAY_MS, type MissionEvent } from '@/lib/mission/types';
import { distanceM, pointAlong, slicePath } from '@/lib/nav/geo';
import { DEFAULT_END, DEFAULT_START, FLAG_RADIUS_M, PRESET_HAZARDS, isInsideHazard, planRoutes } from '@/lib/planner';
import type { Hazard } from '@/lib/planner/types';
import { ORIGIN, divertedRoute, straightRoute } from '@/lib/testing/fixtures';

const R = straightRoute(2000);
const sent: MissionEvent = { id: 'r1', tMs: 0, type: 'route-sent', origin: 'control', traveller: 'astronaut', route: R, hazards: [] };
const start: MissionEvent = { id: 's1', tMs: 700_000, type: 'traverse-started', origin: 'field' };

describe('buildReroute', () => {
  it('builds a reroute that starts where the traveller can be on arrival and avoids the new hazard', () => {
    const [safest] = planRoutes(DEFAULT_START, DEFAULT_END, PRESET_HAZARDS);
    const s2: MissionEvent = { ...sent, route: safest, hazards: PRESET_HAZARDS };
    const view = controlViewAt([s2, start], 700_000);
    const hz: Hazard = { id: 'hz', center: pointAlong(safest.points, safest.lengthM - 300).pos, radiusM: FLAG_RADIUS_M, label: 'Flagged', source: 'control' };
    const r = buildReroute(view, hz)!;
    const branch = predictBranchDistM(view);
    expect(pointAlong(r.route.points, branch - 50).pos.lat).toBeCloseTo(pointAlong(safest.points, branch - 50).pos.lat, 6);
    expect(slicePath(r.route.points, branch, r.route.lengthM).some(p => isInsideHazard(p, hz))).toBe(false);
    expect(r.hazards.some(h => h.id === 'hz')).toBe(true);
    expect(r.hazards.some(h => 'atField' in h)).toBe(false);
    expect(r.route.points.at(-1)).toEqual(DEFAULT_END);
  });

  it('offers no reroute when it is too late', () => // Review Focus 4
    expect(buildReroute(controlViewAt([sent, start], 2_380_000), null)).toBeNull());

  it('offers no reroute before a route has been sent', () =>
    expect(buildReroute(controlViewAt([], 100_000), null)).toBeNull());
});

describe('liveOverlays', () => {
  it('shows two travellers and marks an undelivered hazard as pending', () => {
    const hz: Hazard = { id: 'hz', center: ORIGIN, radiusM: 60, label: 'Flagged', source: 'control' };
    const change: MissionEvent = { id: 'c', tMs: 1_400_000, type: 'route-changed', origin: 'control', route: divertedRoute(R, 1500), hazards: [hz], reason: 'hazard' };
    const o = liveOverlays(controlViewAt([sent, start, change], 1_500_000));
    expect(o.filter(x => x.kind === 'traveller').map(x => x.kind === 'traveller' && x.variant).sort()).toEqual(['ghost', 'solid']);
    expect(o.find(x => x.kind === 'hazard' && x.id === 'hazard:hz')).toMatchObject({ pending: true });
    expect(o.some(x => x.kind === 'label' && x.text === 'MARKED · CREW NOT TOLD YET')).toBe(true);
    expect(o.some(x => x.kind === 'route' && x.variant === 'pending')).toBe(true);
    expect(o.some(x => x.kind === 'label' && x.text.startsWith('REROUTE · ARRIVES IN'))).toBe(true);
  });

  it('draws only the part of a pending route that differs from the active one', () => {
    const r2 = divertedRoute(R, 1500);
    const change: MissionEvent = { id: 'c', tMs: 1_400_000, type: 'route-changed', origin: 'control', route: r2, hazards: [], reason: 'replan' };
    const o = liveOverlays(controlViewAt([sent, start, change], 1_500_000));
    const pending = o.find(x => x.kind === 'route' && x.variant === 'pending');
    expect(pending && pending.kind === 'route' && pending.points.length).toBeLessThan(r2.points.length);
    expect(pending && pending.kind === 'route' && pending.points.length).toBeGreaterThanOrEqual(2);
  });

  it('draws a route still on its way to the field as pending, with no traveller yet', () => {
    const o = liveOverlays(controlViewAt([sent], 300_000));
    const routes = o.filter(x => x.kind === 'route' && x.id !== 'reroute:earliest'); // the tick across the route is not a route
    expect(routes.map(x => x.kind === 'route' && x.variant)).toEqual(['pending']);
    expect(o.some(x => x.kind === 'traveller')).toBe(false);
  });

  it('draws one traveller when the field is not moving', () => {
    const o = liveOverlays(controlViewAt([sent], 1_500_000)); // ready at the field, never started
    expect(o.filter(x => x.kind === 'traveller')).toHaveLength(1);
  });
});

describe('hazards Control cannot route around', () => {
  // Default safest route, traveller moving: received 325 m, estimated now 1062 m, earliest reroute 1798 m.
  const [safest] = planRoutes(DEFAULT_START, DEFAULT_END, PRESET_HAZARDS);
  const sentSafest: MissionEvent = { ...sent, route: safest, hazards: PRESET_HAZARDS };
  const view = controlViewAt([sentSafest, start], 700_000 + 680_000 + 300_000);
  const flagAt = (distM: number): Hazard =>
    ({ id: 'hz', center: pointAlong(safest.points, distM).pos, radiusM: FLAG_RADIUS_M, label: 'Flagged', source: 'control' });
  const branch = predictBranchDistM(view);

  it('says a hazard at the estimated position is too close to route around', () => {
    expect(rerouteBlocker(view, flagAt(view.estimatedNow!.distM))).toBe('too-close');
    expect(buildReroute(view, flagAt(view.estimatedNow!.distM))).toBeNull();
  });

  it('says a hazard just past the earliest reroute point is still too close', () =>
    expect(rerouteBlocker(view, flagAt(branch + FLAG_RADIUS_M))).toBe('too-close'));

  it('reroutes around a hazard well past the earliest reroute point', () => {
    expect(rerouteBlocker(view, flagAt(branch + 500))).toBeNull();
    expect(buildReroute(view, flagAt(branch + 500))).not.toBeNull();
  });

  it('says too late near the end, with or without a new hazard', () => {
    const late = controlViewAt([sent, start], 2_380_000);
    expect(rerouteBlocker(late, null)).toBe('too-late');
    expect(rerouteBlocker(late, { id: 'x', center: ORIGIN, radiusM: 60, label: 'Flagged', source: 'control' })).toBe('too-late');
  });

  it('rates a reroute high risk when it still has to enter a hazard', () => {
    const atEnd: Hazard = { id: 'end', center: DEFAULT_END, radiusM: 200, label: 'Flagged', source: 'control' };
    expect(buildReroute(view, atEnd)!.route.risk).toBe('high');
  });

  it('marks the earliest reroute point on the map while a reroute is possible', () => {
    const o = liveOverlays(view);
    const tick = o.find(x => x.id === 'reroute:earliest');
    const at = pointAlong(safest.points, branch).pos;
    expect(tick?.kind).toBe('route');
    if (tick?.kind !== 'route') return;
    expect(tick.points).toHaveLength(2); // a short line across the route, centred on the point
    expect(distanceM(tick.points[0], at)).toBeCloseTo(distanceM(tick.points[1], at), 3);
    expect(distanceM(tick.points[0], tick.points[1])).toBeGreaterThan(50);
    expect(o.find(x => x.id === 'label:reroute:earliest')).toMatchObject({ kind: 'label', text: 'EARLIEST REROUTE', tone: 'route', pos: at });
    const late = liveOverlays(controlViewAt([sent, start], 2_380_000));
    expect(late.some(x => x.id === 'reroute:earliest' || x.id === 'label:reroute:earliest')).toBe(false);
  });
});

describe('uplinkText and liveProgress', () => {
  it('words each uplink', () => {
    const view = controlViewAt([
      sent,
      { id: 'm', tMs: 10, type: 'message', origin: 'control', text: 'Sample at WP 2' },
      { id: 'c', tMs: 20, type: 'route-changed', origin: 'control', route: R, hazards: [], reason: 'hazard' },
    ], 100);
    expect(view.uplinks.map(uplinkText)).toEqual(['Route sent.', 'Sample at WP 2', 'Hazard ahead. Route changed by Control.']);
  });

  it('reports distance and leg along the received route', () => {
    const view = controlViewAt([sent, start], 1_380_000 + 600_000); // received 600 s after the start
    const p = liveProgress(view)!;
    expect(p.fraction).toBeCloseTo((PACE_MPS.astronaut * 600) / 2000, 5);
    expect(p.text).toBe('0.65 of 2.00 km');
    expect(p.leg).toBe('LEG 2 OF 4');
  });
});

describe('oxygen on reroutes', () => {
  const [safest] = planRoutes(DEFAULT_START, DEFAULT_END, PRESET_HAZARDS);
  const s2: MissionEvent = { ...sent, route: safest, hazards: PRESET_HAZARDS };
  const nearEnd = (): Hazard => ({ id: 'hz', center: pointAlong(safest.points, safest.lengthM - 300).pos, radiusM: FLAG_RADIUS_M, label: 'Flagged', source: 'control' });
  // Hold arrives 10 s after Start; the crew then stands still for nine hours.
  const hold: MissionEvent = { id: 'h1', tMs: 30_000, type: 'message', origin: 'control', text: 'Hold.', order: 'hold' };
  const HELD_MS = 9 * 3_600_000;
  const heldView = () => controlViewAt([s2, start, hold], 710_000 + SIGNAL_DELAY_MS + HELD_MS);

  it('costs the wait for a new route as rest while the crew holds', () => {
    const v = heldView();
    expect(v.received.status).toBe('holding');
    expect(lifeSupportAt(v.received)!.percent - branchPercent(v)!).toBeCloseTo(costPercent('astronaut', 0, 2 * SIGNAL_DELAY_MS), 6);
  });

  it('projects arrival from the received state along the rest of the route while walking', () => {
    const v = controlViewAt([s2, start], 700_000 + SIGNAL_DELAY_MS + 30 * 60_000);
    expect(v.received.status).toBe('moving');
    const expected = lifeSupportAt(v.received)!.percent - costPercent('astronaut', safest.lengthM - v.received.distM, 0);
    expect(projectedArrivalPercent(v)!).toBeCloseTo(expected, 6);
  });

  it('sends a reroute that keeps the reserve', () => {
    const r = planReroute(controlViewAt([s2, start], 700_000), nearEnd());
    expect(r && 'send' in r && r.send.keepsReserve).toBe(true);
  });

  it('asks Control when a reroute would end under the reserve, and recommends turning back if only that keeps it', () => {
    const r = planReroute(heldView(), nearEnd());
    expect(r && 'check' in r).toBe(true);
    if (!r || !('check' in r)) return;
    const kinds = r.check.options.map(o => o.kind);
    expect(kinds).toContain('around');
    expect(kinds).toContain('back');
    expect(r.check.options.find(o => o.kind === 'around')!.endPercent).toBeLessThan(RESERVE_PERCENT);
    expect(r.check.pick).toBe('back');
    expect(r.check.noneKeeps).toBe(false);
    const back = r.check.options.find(o => o.kind === 'back')!;
    expect(distanceM(back.route.points.at(-1)!, safest.points[0])).toBeLessThan(1);
    // A holding crew walks from where it stands, not from the branch point.
    const atBranch = branchPercent(heldView())!;
    expect(back.endPercent).toBeCloseTo(atBranch - costPercent('astronaut', back.route.lengthM - heldView().received.distM, 0), 6);
  });

  it('has nothing to offer when it is too late', () =>
    expect(planReroute(controlViewAt([sent, start], 2_380_000), null)).toBeNull());
});
