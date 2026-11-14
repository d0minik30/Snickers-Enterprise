import { describe, expect, it } from 'vitest';
import { bearingDeg, cumulativeM, destination, distanceM, pointAlong, slicePath } from '@/lib/nav/geo';
import { ORIGIN, straightRoute } from '@/lib/testing/fixtures';

describe('geo', () => {
  it('measures one degree of latitude on Mars', () =>
    expect(distanceM({ lat: 0, lon: 0 }, { lat: 1, lon: 0 })).toBeCloseTo(59157.9, 0));
  it('bearing is 0 north, 90 east, 270 west', () => {
    expect(bearingDeg(ORIGIN, destination(ORIGIN, 0, 100))).toBeCloseTo(0, 1);
    expect(bearingDeg(ORIGIN, destination(ORIGIN, 90, 100))).toBeCloseTo(90, 1);
    expect(bearingDeg(ORIGIN, destination(ORIGIN, 270, 100))).toBeCloseTo(270, 1);
  });
  it('destination then distance round-trips', () =>
    expect(distanceM(ORIGIN, destination(ORIGIN, 37, 1234))).toBeCloseTo(1234, 1));
  it('pointAlong interpolates and clamps', () => {
    const r = straightRoute(2000);
    expect(distanceM(ORIGIN, pointAlong(r.points, 750).pos)).toBeCloseTo(750, 0);
    expect(distanceM(ORIGIN, pointAlong(r.points, 9999).pos)).toBeCloseTo(2000, 0);
    expect(pointAlong(r.points, -5).pos).toEqual(r.points[0]);
  });
  it('slicePath keeps exact ends', () => {
    const s = slicePath(straightRoute(2000).points, 250, 1250);
    expect(cumulativeM(s).at(-1)).toBeCloseTo(1000, 0);
  });
});
