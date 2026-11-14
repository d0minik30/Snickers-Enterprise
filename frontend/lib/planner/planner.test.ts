import { describe, expect, it } from 'vitest';
import { destination, distanceM, pointAlong } from '@/lib/nav/geo';
import { straightRoute } from '@/lib/testing/fixtures';
import type { Hazard, Route } from '@/lib/planner/types';
import {
  DEFAULT_END,
  DEFAULT_START,
  FLAG_RADIUS_M,
  PRESET_HAZARDS,
  isInsideHazard,
  planRoutes,
  positionErrorM,
  satellitePasses,
  spliceRoute,
} from '@/lib/planner';

describe('mock planner', () => {
  const routes = planRoutes(DEFAULT_START, DEFAULT_END, PRESET_HAZARDS);
  const [safest, shortest, flattest] = routes;
  const enters = (r: Route, hs: Hazard[]) => r.points.some(p => hs.some(h => isInsideHazard(p, h)));

  it('returns safest, shortest, flattest in that order', () =>
    expect(routes.map(r => r.profile)).toEqual(['safest', 'shortest', 'flattest']));
  it('every route starts and ends exactly on the requested points', () => routes.forEach(r => {
    expect(r.points[0]).toEqual(DEFAULT_START); expect(r.points.at(-1)).toEqual(DEFAULT_END);
    expect(r.elevationM).toHaveLength(r.points.length);
    expect(r.waypoints.at(-1)).toMatchObject({ name: 'End' });
    expect(r.waypoints.at(-1)!.distM).toBeCloseTo(r.lengthM, 0);
    expect(r.waypoints.length).toBeGreaterThanOrEqual(3); expect(r.waypoints.length).toBeLessThanOrEqual(7);
  }));
  it('shortest is the shortest and crosses the dune field', () => {
    expect(shortest.lengthM).toBeLessThanOrEqual(safest.lengthM);
    expect(shortest.lengthM).toBeLessThanOrEqual(flattest.lengthM);
    expect(shortest.risk).toBe('high');
  });
  it('safest avoids every hazard and is not high risk', () => {
    expect(enters(safest, PRESET_HAZARDS)).toBe(false); expect(safest.risk).not.toBe('high');
  });
  it('flattest is no steeper than shortest', () =>
    expect(flattest.maxSlopeDeg).toBeLessThanOrEqual(shortest.maxSlopeDeg));
  it('slopes are believable', () => routes.forEach(r => {
    expect(r.maxSlopeDeg).toBeGreaterThan(0); expect(r.maxSlopeDeg).toBeLessThanOrEqual(35); })); // real DEM: steepest cell in the area is 33°
  it('all three avoid a hazard flagged by Control', () => {
    const flagged: Hazard = { id: 'c1', center: pointAlong(shortest.points, shortest.lengthM / 3).pos,
                              radiusM: FLAG_RADIUS_M, label: 'Flagged', source: 'control' };
    planRoutes(DEFAULT_START, DEFAULT_END, [...PRESET_HAZARDS, flagged])
      .forEach(r => expect(enters(r, [flagged])).toBe(false));
  });
  it('is deterministic', () =>
    expect(planRoutes(DEFAULT_START, DEFAULT_END, PRESET_HAZARDS)).toEqual(routes));
  it('still plans when the start is inside a hazard', () => {
    const r = planRoutes(PRESET_HAZARDS[0].center, DEFAULT_END, PRESET_HAZARDS);
    expect(r).toHaveLength(3); r.forEach(x => expect(x.points.length).toBeGreaterThanOrEqual(2));
  });
  it('returns no routes when start and end are almost the same point', () =>
    expect(planRoutes(DEFAULT_START, destination(DEFAULT_START, 90, 20), PRESET_HAZARDS)).toEqual([]));
  it('plans the default pair quickly', () => {
    const t = performance.now(); planRoutes(DEFAULT_START, DEFAULT_END, PRESET_HAZARDS);
    expect(performance.now() - t).toBeLessThan(1500);
  });
  it('spliceRoute keeps the walked part and joins the tail', () => {
    const old = straightRoute(2000);
    const at = pointAlong(old.points, 1000).pos;
    const tailPts = [at, destination(at, 90, 250), destination(at, 90, 500)];
    const tail: Route = { ...old, id: 't', points: tailPts, elevationM: [0, 0, 0], lengthM: 500,
                          waypoints: [{ name: 'End', distM: 500, pos: tailPts[2] }] };
    const s = spliceRoute(old, 1000, tail);
    expect(s.lengthM).toBeCloseTo(1500, 0);
    expect(pointAlong(s.points, 400).pos.lat).toBeCloseTo(pointAlong(old.points, 400).pos.lat, 6);
    expect(s.waypoints.map(w => w.name)).toEqual(['WP 1', 'End']);   // WP 1 at 500 m kept, later ones replaced
    expect(s.waypoints.at(-1)!.distM).toBeCloseTo(1500, 0);
    expect(s.elevationM).toHaveLength(s.points.length);
  });
  it('position error grows 2 % of distance from a 1 m base', () => {
    expect(positionErrorM(0)).toBe(1); expect(positionErrorM(250)).toBeCloseTo(6, 5);
  });
  it('satellite passes are sorted and irregular', () => {
    const p = satellitePasses(); expect(p.length).toBeGreaterThanOrEqual(10);
    expect(p[0].tMs).toBe(6 * 60_000);
    expect([...p].sort((a, b) => a.tMs - b.tMs)).toEqual(p);
  });

  describe('candidate routes are visibly distinct', () => {
    // greatest distance from any point of a to the nearest point of b
    const separationM = (a: Route, b: Route) =>
      Math.max(...a.points.map(p => Math.min(...b.points.map(q => distanceM(p, q)))));
    const pairs = (r: Route[]): [Route, Route][] => [[r[0], r[1]], [r[0], r[2]], [r[1], r[2]]];

    // On the real DEM safest and shortest share the one easy gap up the delta front, so they stay closer than on made-up terrain.
    it('default pair: every two routes are at least 250 m apart somewhere', () =>
      pairs(routes).forEach(([a, b]) => {
        expect(separationM(a, b)).toBeGreaterThanOrEqual(250);
        expect(separationM(b, a)).toBeGreaterThanOrEqual(250);
      }));
    it('default pair: slopes step down from shortest to safest to flattest', () => {
      expect(flattest.maxSlopeDeg).toBeLessThanOrEqual(safest.maxSlopeDeg - 2);
      expect(safest.maxSlopeDeg).toBeLessThanOrEqual(shortest.maxSlopeDeg - 2);
    });
    it('default pair: lengths differ pairwise by at least 100 m', () =>
      pairs(routes).forEach(([a, b]) => expect(Math.abs(a.lengthM - b.lengthM)).toBeGreaterThanOrEqual(100)));
    it('second pair elsewhere in the area also gives distinct routes', () => {
      const r = planRoutes({ lat: 18.4300, lon: 77.3950 }, { lat: 18.4850, lon: 77.4650 }, PRESET_HAZARDS);
      expect(r).toHaveLength(3);
      expect(separationM(r[2], r[1])).toBeGreaterThanOrEqual(150);
      expect(separationM(r[1], r[2])).toBeGreaterThanOrEqual(150);
      expect(r[2].maxSlopeDeg).toBeLessThanOrEqual(r[1].maxSlopeDeg);
    });
  });
});
