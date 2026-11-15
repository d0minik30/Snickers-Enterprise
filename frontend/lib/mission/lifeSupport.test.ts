import { describe, expect, it } from 'vitest';
import { fieldStateAt } from '@/lib/mission/field';
import { BATTERY_WH, BREATH, O2_TANK_L, ROVER_W, lifeSupportAt } from '@/lib/mission/lifeSupport';
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
