import { describe, expect, it } from 'vitest';
import { PERSEVERANCE_LANDING_UTC_MS, hhmmss, lmstMs, marsSolDate, perseveranceSol } from '@/lib/mission/marsTime';

describe('Mars24 time at Jezero', () => {
  it('matches the Mars24 worked example (2000-01-06 00:00:00 UTC)', () => {
    // Mars24 algorithm page, example: MSD 44795.9998, MTC 23:59:39 (we use the current 69.184 s TT-UTC).
    const msd = marsSolDate(Date.UTC(2000, 0, 6));
    expect(msd).toBeCloseTo(44795.9998, 3);
  });

  it('landing day is sol 0', () => expect(perseveranceSol(PERSEVERANCE_LANDING_UTC_MS)).toBe(0));

  it('Perseverance landed in the afternoon, local mean solar time', () => {
    // NASA: touchdown at about 15:53 LMST at Jezero.
    const [h, m] = hhmmss(lmstMs(PERSEVERANCE_LANDING_UTC_MS)).split(':').map(Number);
    expect(h * 60 + m).toBeGreaterThan(15 * 60 + 30);
    expect(h * 60 + m).toBeLessThan(16 * 60 + 15);
  });

  it('counts sols like the mission does', () => {
    // NASA raw images: sol 1000 was 2023-12-12 (Earth date of the sol, UTC).
    expect(perseveranceSol(Date.UTC(2023, 11, 12, 12))).toBeGreaterThanOrEqual(999);
    expect(perseveranceSol(Date.UTC(2023, 11, 12, 12))).toBeLessThanOrEqual(1000);
  });
});
