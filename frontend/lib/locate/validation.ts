// The validation report made by backend/skyline/scripts/validate.py: real Perseverance photos with
// known positions, run through the whole chain, scored against the truth.

import { isLocateResult, type LocateRequest, type LocateResult } from '@/lib/locate/types';

export type ValidationCase = {
  name: string;
  pose: string;
  sol: number;
  truth: { lat: number; lon: number; source: string };
  photos: string[];
  skipped_photos?: string[];
  trusted_share: number;
  error_m: number;
  error_bearing_deg: number;
  inside_68: boolean;
  inside_95: boolean;
  headings: { id: string; image_id: string; true_deg: number; found_deg: number; error_deg: number }[];
  /** The traced skyline against the terrain at the TRUE position and headings: small = the skyline step
   *  did its job, so a position error is the search's. 'far' (terrain over 2 km away) is the fair measure. */
  skyline_at_truth?: { far: FitStats | null; near: FitStats | null };
  seconds: number;
  request: LocateRequest;
  result: LocateResult;
};

export type FitStats = { n: number; median_deg: number; mad_deg: number };

export type ValidationReport = {
  source: {
    what: string; cases_from: string; run_utc: string; note: string; engine: LocateResult['engine'] | null;
    /** Optional plain-words label for the run, shown in the banner (e.g. which terrain it used). */
    label?: string;
  };
  summary: {
    cases: number; median_error_m: number | null; mean_error_m: number | null;
    within_50_m: number; within_100_m: number; inside_68: number; inside_95: number;
    median_abs_heading_error_deg: number | null;
  };
  cases: ValidationCase[];
};

const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

export function isValidationReport(v: unknown): v is ValidationReport {
  if (typeof v !== 'object' || v === null) return false;
  const r = v as Record<string, unknown>;
  return typeof r.source === 'object' && r.source !== null && typeof r.summary === 'object' && r.summary !== null
    && Array.isArray(r.cases) && r.cases.every(c => {
      const k = c as Record<string, unknown>;
      const t = k.truth as Record<string, unknown> | undefined;
      return typeof k.pose === 'string' && isNum(k.error_m) && !!t && isNum(t.lat) && isNum(t.lon)
        && Array.isArray(k.headings) && isLocateResult(k.result);
    });
}

/** Plain-words verdict for one case. */
export function caseVerdict(c: ValidationCase): { text: string; tone: 'ok' | 'caution' | 'bad' } {
  const honest = c.inside_95;
  if (c.result.status === 'ok' && c.error_m <= 50) return { text: 'FOUND', tone: 'ok' };
  if (c.result.status === 'ok' && c.error_m <= 150) return { text: honest ? 'CLOSE' : 'CLOSE, OVERCONFIDENT', tone: 'caution' };
  if (c.result.status !== 'ok' && honest) return { text: 'UNSURE, AND SAYS SO', tone: 'caution' };
  return { text: honest ? 'OFF, BUT WITHIN ITS 95 %' : 'OFF, OUTSIDE ITS 95 %', tone: 'bad' };
}

/** The median absolute heading error over a case's photos. */
export function headingError(c: ValidationCase): number {
  const e = c.headings.map(h => Math.abs(h.error_deg)).sort((a, b) => a - b);
  if (e.length === 0) return NaN;
  const m = Math.floor(e.length / 2);
  return e.length % 2 ? e[m] : (e[m - 1] + e[m]) / 2;
}
