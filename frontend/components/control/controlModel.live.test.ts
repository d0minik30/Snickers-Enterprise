import { describe, expect, it } from 'vitest';
import { buildReroute, liveOverlays, liveProgress, uplinkText } from '@/components/control/controlModel';
import { controlViewAt, predictBranchDistM } from '@/lib/mission/control';
import { PACE_MPS, type MissionEvent } from '@/lib/mission/types';
import { pointAlong, slicePath } from '@/lib/nav/geo';
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
    const view = controlViewAt([s2, start], 700_000, []);
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
    expect(buildReroute(controlViewAt([sent, start], 2_380_000, []), null)).toBeNull());

  it('offers no reroute before a route has been sent', () =>
    expect(buildReroute(controlViewAt([], 100_000, []), null)).toBeNull());
});

describe('liveOverlays', () => {
  it('shows two travellers and marks an undelivered hazard as pending', () => {
    const hz: Hazard = { id: 'hz', center: ORIGIN, radiusM: 60, label: 'Flagged', source: 'control' };
    const change: MissionEvent = { id: 'c', tMs: 1_400_000, type: 'route-changed', origin: 'control', route: divertedRoute(R, 1500), hazards: [hz], reason: 'hazard' };
    const o = liveOverlays(controlViewAt([sent, start, change], 1_500_000, []));
    expect(o.filter(x => x.kind === 'traveller').map(x => x.kind === 'traveller' && x.variant).sort()).toEqual(['ghost', 'solid']);
    expect(o.find(x => x.kind === 'hazard' && x.id === 'hazard:hz')).toMatchObject({ pending: true });
    expect(o.some(x => x.kind === 'label' && x.text === 'FLAGGED · NOT YET AT FIELD')).toBe(true);
    expect(o.some(x => x.kind === 'route' && x.variant === 'pending')).toBe(true);
    expect(o.some(x => x.kind === 'label' && x.text.startsWith('REROUTE · ARRIVES IN'))).toBe(true);
  });

  it('draws only the part of a pending route that differs from the active one', () => {
    const r2 = divertedRoute(R, 1500);
    const change: MissionEvent = { id: 'c', tMs: 1_400_000, type: 'route-changed', origin: 'control', route: r2, hazards: [], reason: 'replan' };
    const o = liveOverlays(controlViewAt([sent, start, change], 1_500_000, []));
    const pending = o.find(x => x.kind === 'route' && x.variant === 'pending');
    expect(pending && pending.kind === 'route' && pending.points.length).toBeLessThan(r2.points.length);
    expect(pending && pending.kind === 'route' && pending.points.length).toBeGreaterThanOrEqual(2);
  });

  it('draws a route still on its way to the field as pending, with no traveller yet', () => {
    const o = liveOverlays(controlViewAt([sent], 300_000, []));
    expect(o.filter(x => x.kind === 'route').map(x => x.kind === 'route' && x.variant)).toEqual(['pending']);
    expect(o.some(x => x.kind === 'traveller')).toBe(false);
  });

  it('draws one traveller when the field is not moving', () => {
    const o = liveOverlays(controlViewAt([sent], 1_500_000, [])); // ready at the field, never started
    expect(o.filter(x => x.kind === 'traveller')).toHaveLength(1);
  });
});

describe('uplinkText and liveProgress', () => {
  it('words each uplink', () => {
    const view = controlViewAt([
      sent,
      { id: 'm', tMs: 10, type: 'message', origin: 'control', text: 'Sample at WP 2' },
      { id: 'c', tMs: 20, type: 'route-changed', origin: 'control', route: R, hazards: [], reason: 'hazard' },
    ], 100, []);
    expect(view.uplinks.map(uplinkText)).toEqual(['Route sent.', 'Sample at WP 2', 'Hazard ahead. Route changed by Control.']);
  });

  it('reports distance and leg along the received route', () => {
    const view = controlViewAt([sent, start], 1_380_000 + 600_000, []); // received 600 s after the start
    const p = liveProgress(view)!;
    expect(p.fraction).toBeCloseTo((PACE_MPS.astronaut * 600) / 2000, 5);
    expect(p.text).toBe('0.65 of 2.00 km');
    expect(p.leg).toBe('LEG 2 OF 4');
  });
});
