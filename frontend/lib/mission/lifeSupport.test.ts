import { describe, expect, it } from 'vitest';
import { fieldStateAt } from '@/lib/mission/field';
import { BATTERY_WH, BREATH, O2_TANK_L, RESERVE_PERCENT, ROVER_W, arrivalPercent, costPercent, lifeSupportAt, lifeTone, routeEndPercent } from '@/lib/mission/lifeSupport';
import type { Route } from '@/lib/planner/types';
import { PACE_MPS, type MissionEvent } from '@/lib/mission/types';
import { straightRoute } from '@/lib/testing/fixtures';

const R = straightRoute(2000);
const sent = (traveller: 'astronaut' | 'rover'): MissionEvent =>
  ({ id: 'r1', tMs: 0, type: 'route-sent', origin: 'control', traveller, route: R, hazards: [] });
const start: MissionEvent = { id: 's1', tMs: 700_000, type: 'traverse-started', origin: 'field' };

describe('lifeSupportAt', () => {
  it('has nothing before a route arrives, and a full tank before Start', () => {
    expect(lifeSupportAt(fieldStateAt([sent('astronaut')], 0))).toBeNull();
    expect(lifeSupportAt(fieldStateAt([sent('astronaut')], 690_000))).toMatchObject({ kind: 'oxygen', percent: 100 });
  });

  it('uses oxygen at the walking breath rate while walking', () => {
    const s = fieldStateAt([sent('astronaut'), start], 700_000 + 10 * 60_000); // 10 minutes on the move
    const life = lifeSupportAt(s)!;
    const used = 10 * BREATH.walking.perMin * BREATH.walking.o2L;
    expect(life.kind).toBe('oxygen');
    expect(life.percent).toBeCloseTo(100 * (1 - used / O2_TANK_L), 6);
    if (life.kind === 'oxygen') expect(Math.abs(life.breathsPerMin - BREATH.walking.perMin)).toBeLessThanOrEqual(3);
  });

  it('keeps breathing (slower) after arrival', () => {
    const walkMin = R.lengthM / PACE_MPS.astronaut / 60;
    const at = (min: number) => lifeSupportAt(fieldStateAt([sent('astronaut'), start], 700_000 + min * 60_000))!;
    const restUsedPer10Min = 10 * BREATH.resting.perMin * BREATH.resting.o2L;
    expect(at(walkMin + 10).percent - at(walkMin + 20).percent).toBeCloseTo(100 * restUsedPer10Min / O2_TANK_L, 6);
    const late = at(walkMin + 20);
    if (late.kind === 'oxygen') expect(Math.abs(late.breathsPerMin - BREATH.resting.perMin)).toBeLessThanOrEqual(3);
  });

  it('drains the rover battery by its net driving draw', () => {
    const life = lifeSupportAt(fieldStateAt([sent('rover'), start], 700_000 + 20 * 60_000))!; // 1.44 km of the 2 km route
    const usedWh = (20 / 60) * (ROVER_W.driving - ROVER_W.generator);
    expect(life).toMatchObject({ kind: 'battery', netW: ROVER_W.driving - ROVER_W.generator });
    expect(life.percent).toBeCloseTo(100 * (1 - usedWh / BATTERY_WH), 6);
  });
});

describe('route costs', () => {
  it('costs a share of the tank per km walked and per hour resting', () => {
    expect(costPercent('astronaut', 1000, 0)).toBeCloseTo(5.83, 2);
    expect(costPercent('astronaut', 0, 3_600_000)).toBeCloseTo(5.53, 2);
    expect(costPercent('rover', 1000, 0)).toBeCloseTo(2.80, 2);
    expect(costPercent('rover', 0, 3_600_000)).toBeCloseTo(1.67, 2);
  });

  it('says what a route leaves from a full tank', () => {
    expect(routeEndPercent({ lengthM: 10_000 } as Route, 'astronaut')).toBeCloseTo(41.7, 1);
  });

  it('expects the rest of the route to cost what walking it costs', () => {
    const r3 = straightRoute(3000);
    const log: MissionEvent[] = [{ id: 'r1', tMs: 0, type: 'route-sent', origin: 'control', traveller: 'astronaut', route: r3, hazards: [] }, start];
    const s = fieldStateAt(log, 700_000 + (1000 / PACE_MPS.astronaut) * 1000); // 1000 m along
    expect(s.distM).toBeCloseTo(1000, 0);
    expect(arrivalPercent(s)!).toBeCloseTo(lifeSupportAt(s)!.percent - costPercent('astronaut', r3.lengthM - s.distM, 0), 6);
    expect(arrivalPercent(fieldStateAt([], 0))).toBeNull();
  });

  it('tones a value by the reserve', () => {
    expect(RESERVE_PERCENT).toBe(20);
    expect(lifeTone(-1)).toBe('danger');
    expect(lifeTone(19.9)).toBe('caution');
    expect(lifeTone(20)).toBe('plain');
  });
});
