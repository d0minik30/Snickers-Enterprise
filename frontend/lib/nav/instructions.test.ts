import { describe, expect, it } from 'vitest';
import { classifyTurn, nextMove } from '@/lib/nav/instructions';
import { cornerRoute, straightRoute } from '@/lib/testing/fixtures';

describe('classifyTurn', () => {
  it('classifies angles', () => {
    expect(classifyTurn(4)).toBe('continue');
    expect(classifyTurn(-30)).toBe('bear-left');
    expect(classifyTurn(30)).toBe('bear-right');
    expect(classifyTurn(-90)).toBe('turn-left');
    expect(classifyTurn(75)).toBe('turn-right');
  });
});

describe('nextMove', () => {
  it('announces the corner ahead', () => {
    const m = nextMove(cornerRoute(), 100);
    expect(m.maneuver).toBe('turn-left');
    expect(Math.abs(m.distanceM - 200)).toBeLessThan(25);
  });
  it('says continue to the next waypoint on a straight leg', () => {
    const m = nextMove(straightRoute(2000), 100);
    expect(m).toMatchObject({ maneuver: 'continue', waypointIndex: 0, waypointName: 'WP 1' });
    expect(m.distanceM).toBeCloseTo(400, 0);
  });
  it('says arrive on the last leg', () => {
    const m = nextMove(straightRoute(2000), 1700);
    expect(m).toMatchObject({ maneuver: 'arrive', waypointName: 'End' });
    expect(m.distanceM).toBeCloseTo(300, 0);
  });
});
