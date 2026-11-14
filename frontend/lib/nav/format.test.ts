import { describe, expect, it } from 'vitest';
import { formatClock, formatDistance, formatLat, formatLon } from '@/lib/nav/format';

describe('format', () => {
  it('formats distances', () => {
    expect(formatDistance(140.4)).toEqual({ value: '140', unit: 'm' });
    expect(formatDistance(1840)).toEqual({ value: '1.84', unit: 'km' });
  });
  it('formats clocks', () => {
    expect(formatClock(252_000)).toBe('04:12');
    expect(formatClock(680_000)).toBe('11:20');
    expect(formatClock(3_725_000)).toBe('1:02:05');
  });
  it('formats coordinates', () => {
    expect(formatLat(18.4446)).toBe('18.4446° N');
    expect(formatLat(-4.5895)).toBe('4.5895° S');
    expect(formatLon(-133.8)).toBe('226.2000° E');
  });
});
