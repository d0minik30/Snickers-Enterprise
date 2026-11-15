// The engine's answer in its three states, and with the nulls it writes for numbers it could not compute
// (FRONTEND_OUTPUT_BRIEF.md). Fixtures are copies of the real engine-pose3-770 answer, edited by hand.
import { describe, expect, it } from 'vitest';
import ambiguousFile from '@/lib/locate/fixtures/engine-ambiguous.json';
import noMatchFile from '@/lib/locate/fixtures/engine-no-match-nulls.json';
import realFile from '@/lib/locate/fixtures/engine-pose3-770.json';
import { featureDistanceDisagrees, featureLine, photoWedges, resultExtent } from '@/lib/locate/resultGeo';
import { isLocateResult, type LocateResult } from '@/lib/locate/types';

const real = realFile.result as unknown as LocateResult;
const ambiguous = ambiguousFile.result as unknown as LocateResult;
const noMatch = noMatchFile.result as unknown as LocateResult;

describe('isLocateResult with the engine\'s nulls', () => {
  it('accepts the real answer, the ambiguous one and the no_match one with nulls', () => {
    expect(isLocateResult(real)).toBe(true);
    expect(isLocateResult(ambiguous)).toBe(true);
    expect(isLocateResult(noMatch)).toBe(true);
  });

  it('accepts null in fields the app can do without', () => {
    const nulled = structuredClone(real) as unknown as Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
    nulled.best.ground_elevation_m = null;
    nulled.best.score = null;
    nulled.candidates[0].probability = null;
    nulled.dominant_feature.distance_check_m = null;
    nulled.dominant_feature.elev_angle_deg = null;
    nulled.photos[0].rms_residual_deg = null;
    nulled.photos[0].heading_deg = null;
    expect(isLocateResult(nulled)).toBe(true);
  });

  it('rejects a result without a position or without its uncertainty radii', () => {
    for (const key of ['uncertainty_m', 'uncertainty_95_m', 'lat', 'lon']) {
      const broken = structuredClone(real) as unknown as Record<string, Record<string, unknown>>;
      broken.best[key] = null;
      expect(isLocateResult(broken), key).toBe(false);
    }
  });

  it('knows the photo fields the engine sends, horizon_tilt_deg included', () => {
    expect(real.photos[0]).toHaveProperty('horizon_tilt_deg');
    expect(noMatch.photos[0].horizon_tilt_deg).toBeNull();
  });
});

describe('drawing an answer with nulls', () => {
  it('only claims the distance check disagrees when both distances are numbers', () => {
    expect(noMatch.dominant_feature!.distance_check_m).toBeNull();
    expect(featureDistanceDisagrees(noMatch.dominant_feature)).toBe(false);
    const f = real.dominant_feature!;
    expect(featureDistanceDisagrees({ ...f, distance_m: 1000, distance_check_m: 1500 })).toBe(true);
    expect(featureDistanceDisagrees({ ...f, distance_m: 1000, distance_check_m: 1100 })).toBe(false);
    expect(featureDistanceDisagrees({ ...f, distance_m: null, distance_check_m: 1100 })).toBe(false);
    expect(featureDistanceDisagrees(null)).toBe(false);
  });

  it('draws no wedge for a photo without a heading, and no feature line without a feature position', () => {
    const r = structuredClone(real);
    r.photos[0].heading_deg = null;
    expect(photoWedges(r, {}, 1000).map(w => w.id)).not.toContain(r.photos[0].id);
    r.dominant_feature = { ...r.dominant_feature!, lat: null };
    expect(featureLine(r)).toBeNull();
    expect(resultExtent(r).every(p => Number.isFinite(p.lat) && Number.isFinite(p.lon))).toBe(true);
  });

  it('keeps the other candidates of an ambiguous answer in view', () => {
    expect(ambiguous.candidates.length).toBeGreaterThan(1);
    expect(resultExtent(ambiguous)).toContainEqual(ambiguous.candidates[1]);
  });
});
