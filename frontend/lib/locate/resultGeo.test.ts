import { describe, expect, it } from 'vitest';
import { circle, featureLine, fovWedge, heatmapPixels, photoWedges, resultExtent, verdict } from '@/lib/locate/resultGeo';
import { bearingDeg, distanceM } from '@/lib/nav/geo';
import { contractResult } from '@/lib/testing/locateFixtures';
import { isLocateResult } from '@/lib/locate/types';

const site = { lat: 18.4447, lon: 77.4508 };

describe('circle', () => {
  it('is a closed ring at the radius', () => {
    const ring = circle(site, 420, 36);
    expect(ring).toHaveLength(37);
    for (const p of ring) expect(distanceM(site, p)).toBeCloseTo(420, 3);
    expect(ring[0].lat).toBeCloseTo(ring[36].lat, 9);
  });
});

describe('fovWedge', () => {
  it('spans the field of view around the heading, out to the range', () => {
    const w = fovWedge(site, 90, 60, 5000, 6);
    expect(w[0]).toEqual(site);
    expect(w[w.length - 1]).toEqual(site);
    expect(bearingDeg(site, w[1])).toBeCloseTo(60, 6);
    expect(bearingDeg(site, w[w.length - 2])).toBeCloseTo(120, 6);
    for (const p of w.slice(1, -1)) expect(distanceM(site, p)).toBeCloseTo(5000, 2);
  });
  it('wraps through north', () => {
    const w = fovWedge(site, 350, 40, 1000, 4);
    expect(bearingDeg(site, w[1])).toBeCloseTo(330, 6);
    expect(bearingDeg(site, w[w.length - 2])).toBeCloseTo(10, 6);
  });
});

describe('heatmapPixels', () => {
  it('maps grid values to opacity, row 0 north, zero transparent', () => {
    const grid = contractResult.likelihood_grid!;
    const px = heatmapPixels(grid, [255, 176, 0], 0.8);
    expect(px).toHaveLength(2 * 4 * 4);
    expect(px[3]).toBe(0); // row 0, col 0: value 0
    const last = (1 * 4 + 3) * 4; // row 1, col 3: value 255 = the best cell
    expect(px[last + 3]).toBe(Math.round(255 * 0.8));
    expect([px[last], px[last + 1], px[last + 2]]).toEqual([255, 176, 0]);
    const weak = (0 * 4 + 2) * 4; // value 3 of 255: faint but visible
    expect(px[weak + 3]).toBeGreaterThan(0);
    expect(px[weak + 3]).toBeLessThan(px[last + 3]);
  });
});

describe('result geometry', () => {
  it('draws a wedge per photo from the best position', () => {
    const [w] = photoWedges(contractResult, { photo_1: 96 }, 2000);
    expect(w.id).toBe('photo_1');
    expect(w.points[0]).toEqual(contractResult.best);
    expect(bearingDeg(contractResult.best, w.points[1])).toBeCloseTo(262.5 - 48, 4);
  });
  it('measures the line to the dominant feature', () => {
    const line = featureLine(contractResult)!;
    // Agrees with the example's own distance_m (9530 m) and azimuth_deg (274.6) to within rounding.
    expect(line.distanceM).toBeCloseTo(contractResult.dominant_feature!.distance_m as number, -2);
    expect(line.bearingDeg).toBeCloseTo(contractResult.dominant_feature!.azimuth_deg as number, 0);
    expect(featureLine({ ...contractResult, dominant_feature: null })).toBeNull();
  });
  it('frames best, its 95 % circle, the candidates and the feature', () => {
    const pts = resultExtent(contractResult);
    expect(pts).toContainEqual(contractResult.candidates[1]);
    const f = contractResult.dominant_feature!;
    expect(pts).toContainEqual({ lat: f.lat, lon: f.lon });
  });
  it('words the status plainly', () => {
    expect(verdict(contractResult).tone).toBe('ok');
    expect(verdict({ ...contractResult, status: 'ambiguous' }).title).toBe('SEVERAL PLACES FIT');
    expect(verdict({ ...contractResult, status: 'no_match' }).tone).toBe('bad');
  });
});

describe('the saved real engine answer', () => {
  it('passes the same contract check as a live answer', async () => {
    const file = (await import('@/lib/locate/fixtures/engine-pose3-770.json')).default as unknown as { result: unknown };
    expect(isLocateResult(file.result)).toBe(true);
  });
});
