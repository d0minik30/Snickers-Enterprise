import { describe, expect, it } from 'vitest';
import { caseVerdict, headingError, isValidationReport, type ValidationCase } from '@/lib/locate/validation';
import { contractPhoto, contractResult } from '@/lib/testing/locateFixtures';

const base: ValidationCase = {
  name: 'site 3 drive 578 (sol 17)', pose: '3/578', sol: 17,
  truth: { lat: 18.4452799, lon: 77.45149726, source: 'waypoint' },
  photos: ['a', 'b'], trusted_share: 0.8, error_m: 20, error_bearing_deg: 200, inside_68: true, inside_95: true,
  headings: [
    { id: 'photo_1', image_id: 'a', true_deg: 61.8, found_deg: 62.6, error_deg: 0.8 },
    { id: 'photo_2', image_id: 'b', true_deg: 17.7, found_deg: 16.5, error_deg: -1.2 },
  ],
  seconds: 50,
  request: { contract_version: '0.1', photos: [{ ...contractPhoto(), id: 'photo_1' }] },
  result: contractResult,
};

describe('validation report', () => {
  it('accepts a report of real cases and rejects a broken one', () => {
    const report = { source: { what: 'x', cases_from: 'y', run_utc: 'z', note: 'n', engine: null }, summary: {}, cases: [base] };
    expect(isValidationReport(report)).toBe(true);
    expect(isValidationReport({ ...report, cases: [{ ...base, result: { status: 'ok' } }] })).toBe(false);
    expect(isValidationReport({ ...report, cases: [{ ...base, truth: { lat: 'x' } }] })).toBe(false);
  });

  it('words each case by both accuracy and honesty', () => {
    expect(caseVerdict(base).tone).toBe('ok');
    expect(caseVerdict({ ...base, error_m: 80, inside_95: false }).text).toBe('CLOSE, OVERCONFIDENT');
    const ambiguous = { ...base, error_m: 3000, result: { ...contractResult, status: 'ambiguous' as const } };
    expect(caseVerdict(ambiguous).text).toBe('UNSURE, AND SAYS SO');
    expect(caseVerdict({ ...ambiguous, inside_95: false }).text).toBe('OFF, OUTSIDE ITS 95 %');
  });

  it('takes the median absolute heading error', () => {
    expect(headingError(base)).toBeCloseTo(1.0, 9);
  });
});
