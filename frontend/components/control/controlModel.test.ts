import { describe, expect, it } from 'vitest';
import {
  earthClock,
  setClockEpoch,
  marsClock,
  passesDuring,
  planFitPoints,
  planOverlays,
  recommendationText,
  summarizeRoute,
  timeOfDay,
  waypointLegs,
} from '@/components/control/controlModel';
import { PACE_MPS } from '@/lib/mission/types';
import { formatDistance } from '@/lib/nav/format';
import { destination, distanceM } from '@/lib/nav/geo';
import { DEFAULT_END, DEFAULT_START, PRESET_HAZARDS, planRoutes } from '@/lib/planner';
import type { Route } from '@/lib/planner/types';
import { straightRoute } from '@/lib/testing/fixtures';

const routes = planRoutes(DEFAULT_START, DEFAULT_END, PRESET_HAZARDS);

describe('controlModel', () => {
  it('summarises a route for its card', () => {
    const s = summarizeRoute(straightRoute(2310), 'astronaut');
    expect(s).toMatchObject({ length: '2.31 km', time: '35:32', riskLabel: 'Risk low' });      // 2310 m at 3.9 km/h
    expect(summarizeRoute(straightRoute(2310), 'rover').time).toBe('32:05');                   // 2310 m at 1.2 m/s
    expect(summarizeRoute(routes[1], 'astronaut')).toMatchObject({ letter: 'B', title: 'Shortest', riskLabel: 'Risk high' });
  });

  it('explains the recommendation with real numbers', () => {
    const t = recommendationText(routes);
    expect(t).toMatch(/steep slope \d+°/); // a real steep core the shortest route climbs onto the delta
    expect(t).toContain(formatDistance(routes[0].lengthM - routes[1].lengthM).value);
  });

  it('finds the passes during a traverse and the worst drift', () => {
    const p = passesDuring(straightRoute(2000), 'astronaut', 0);            // 30:46 long, passes at 6, 19, 31 min
    expect(p.passes.map(x => x.tMs / 60_000)).toEqual([6, 19]);
    expect(p.longestGapMs).toBe(13 * 60_000);
    expect(p.worstDriftM).toBeCloseTo(1 + 0.02 * PACE_MPS.astronaut * 13 * 60, 1);
  });

  it('draws the selected route in magenta and the others as alternatives', () => {
    const o = planOverlays(routes, 'safest', PRESET_HAZARDS, DEFAULT_START, DEFAULT_END);
    expect(o.filter(x => x.kind === 'route').map(x => x.kind === 'route' && x.variant).sort())
      .toEqual(['active', 'alternative', 'alternative-dotted']);
    expect(o.filter(x => x.kind === 'endpoint')).toHaveLength(2);
    expect(o.filter(x => x.kind === 'waypoint')).toHaveLength(routes[0].waypoints.length - 1);   // 'End' is the endpoint
  });

  // Added beyond the brief: the helpers the right rail and the top bar read from.

  it('does not claim a hazard the shortest route avoids', () => {
    const shortest: Route = { ...straightRoute(2000), profile: 'shortest', maxSlopeDeg: 14, risk: 'medium' };
    const safest: Route = { ...straightRoute(2600), profile: 'safest', maxSlopeDeg: 6 };
    const t = recommendationText([safest, shortest], 'astronaut', []);
    expect(t).not.toMatch(/avoids/i);
    expect(t).toContain('14°');
    expect(t).toContain('6°');
    expect(t).toContain('600 m');
  });

  it('counts the fix at the start and the stretch after the last pass', () => {
    const p = passesDuring(straightRoute(2000), 'astronaut', 20 * 60_000);  // 20:00 to 50:46, passes at 31 and 47 min
    expect(p.passes.map(x => x.tMs / 60_000)).toEqual([31, 47]);
    expect(p.longestGapMs).toBe(16 * 60_000);
  });

  it('lists each leg with its length and steepest slope', () => {
    const legs = waypointLegs(routes[0]);
    expect(legs).toHaveLength(routes[0].waypoints.length);
    expect(legs.at(-1)?.name).toBe('End');
    expect(legs.reduce((sum, l) => sum + l.lengthM, 0)).toBeCloseTo(routes[0].lengthM, 3);
    expect(Math.max(...legs.map(l => l.maxSlopeDeg))).toBeLessThanOrEqual(routes[0].maxSlopeDeg + 1);
    expect(waypointLegs(straightRoute(1200)).map(l => l.maxSlopeDeg)).toEqual([0, 0, 0]);
  });

  it('fits the Plan camera on the selected route, never tighter than 600 m', () => {
    expect(planFitPoints(routes[0], DEFAULT_START, DEFAULT_END).slice(0, routes[0].points.length)).toEqual(routes[0].points);
    const lats = planFitPoints(undefined, DEFAULT_START, destination(DEFAULT_START, 90, 20)).map(p => p.lat);
    expect(distanceM({ lat: Math.min(...lats), lon: 77 }, { lat: Math.max(...lats), lon: 77 })).toBeCloseTo(600, 0);
  });

  it('runs the Earth and Mars clocks on mission time', () => {
    setClockEpoch(Date.UTC(2021, 1, 18, 20, 43, 49)); // Perseverance touchdown
    expect(earthClock(0)).toBe('20:43:49');
    expect(earthClock(61_000)).toBe('20:44:50');
    expect(marsClock(0).sol).toBe(0);
    expect(marsClock(0).time.startsWith('15:5')).toBe(true); // NASA: touchdown about 15:53 LMST
    expect(marsClock(88_775_244).sol).toBe(1); // one sol later
    expect(timeOfDay(61_000)).toBe('00:01:01');
  });
});
