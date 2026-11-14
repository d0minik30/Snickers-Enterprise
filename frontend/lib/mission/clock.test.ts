import { describe, expect, it } from 'vitest';
import { newClock, missionTimeAt, withPaused, withRate } from '@/lib/mission/clock';

describe('mission clock', () => {
  it('runs at the rate, stays continuous across changes, and freezes when paused', () => {
    const c = newClock(1_000);
    expect(missionTimeAt(c, 2_000)).toBe(30_000);
    const c2 = withRate(c, 60, 2_000);
    expect(missionTimeAt(c2, 2_000)).toBe(30_000);
    expect(missionTimeAt(c2, 3_000)).toBe(90_000);
    const c3 = withPaused(c2, true, 3_000);
    expect(missionTimeAt(c3, 9_000)).toBe(90_000);
    expect(c3.rev).toBeGreaterThan(c.rev);
  });
});
