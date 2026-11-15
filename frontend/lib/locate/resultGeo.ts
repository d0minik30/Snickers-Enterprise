// Map geometry for the engine's answer (CONTRACTS.md section 3), on the Mars 2000 sphere.
// Pure functions: the map component only draws what these return.

import { bearingDeg, destination, distanceM } from '@/lib/nav/geo';
import type { LatLon } from '@/lib/planner/types';
import type { LocateResult } from '@/lib/locate/types';

/** A circle of `radiusM` around `center`, as a closed ring of points. */
export function circle(center: LatLon, radiusM: number, steps = 72): LatLon[] {
  const pts: LatLon[] = [];
  for (let i = 0; i <= steps; i++) pts.push(destination(center, (360 * i) / steps, radiusM));
  return pts;
}

/**
 * The part of the ground a photo saw: a wedge from the camera, centred on the heading, as wide as the
 * horizontal field of view, `rangeM` long. Closed polygon (camera, arc, camera).
 */
export function fovWedge(camera: LatLon, headingDeg: number, hfovDeg: number, rangeM: number, steps = 24): LatLon[] {
  const half = Math.min(hfovDeg, 359.9) / 2;
  const pts: LatLon[] = [camera];
  for (let i = 0; i <= steps; i++) pts.push(destination(camera, headingDeg - half + (2 * half * i) / steps, rangeM));
  pts.push(camera);
  return pts;
}

/** Bounds as Leaflet takes them: [[south, west], [north, east]]. */
export type Bounds = [[number, number], [number, number]];

/**
 * The likelihood grid as RGBA pixels, one per cell, row 0 = north. Value 0 is transparent; higher
 * likelihood is more opaque, on a square-root curve so the shoulders of a peak stay visible.
 */
export function heatmapPixels(grid: NonNullable<LocateResult['likelihood_grid']>, rgb: [number, number, number],
  maxAlpha = 0.75): Uint8ClampedArray {
  const px = new Uint8ClampedArray(grid.rows * grid.cols * 4);
  for (let r = 0; r < grid.rows; r++) {
    for (let c = 0; c < grid.cols; c++) {
      const v = Math.max(0, Math.min(1, grid.values[r][c] / grid.scale));
      const k = (r * grid.cols + c) * 4;
      px[k] = rgb[0];
      px[k + 1] = rgb[1];
      px[k + 2] = rgb[2];
      px[k + 3] = v > 0 ? Math.round(255 * maxAlpha * Math.sqrt(v)) : 0;
    }
  }
  return px;
}

/** A view that holds the best position, its 95 % circle, the candidates and the feature. */
export function resultExtent(r: LocateResult): LatLon[] {
  const pts: LatLon[] = [r.best, ...r.candidates];
  const span = Math.max(r.best.uncertainty_95_m, r.best.uncertainty_m, 300);
  for (const b of [0, 90, 180, 270]) pts.push(destination(r.best, b, span));
  const f = featurePoint(r);
  if (f) pts.push(f);
  return pts;
}

/** Where the dominant feature is, or null when there is none or the engine could not place it. */
export function featurePoint(r: LocateResult): LatLon | null {
  const f = r.dominant_feature;
  return f && typeof f.lat === 'number' && typeof f.lon === 'number' ? { lat: f.lat, lon: f.lon } : null;
}

/**
 * Where to draw each photo's wedge: from the best position, using each photo's matched heading.
 * A photo whose heading the engine could not compute (null) gets no wedge.
 */
export function photoWedges(r: LocateResult, hfovById: Record<string, number>, rangeM: number) {
  return r.photos.flatMap(p => p.heading_deg === null ? [] : [{
    id: p.id,
    headingDeg: p.heading_deg,
    points: fovWedge(r.best, p.heading_deg, hfovById[p.id] ?? 60, rangeM),
  }]);
}

/** The line from the camera to the dominant feature, with its length and direction. */
export function featureLine(r: LocateResult): { points: [LatLon, LatLon]; distanceM: number; bearingDeg: number } | null {
  const f = featurePoint(r);
  if (!f) return null;
  return { points: [r.best, f], distanceM: distanceM(r.best, f), bearingDeg: bearingDeg(r.best, f) };
}

/**
 * True when the feature's distance, recomputed from its height and angle (`distance_check_m`), is more
 * than 20 % off its ground distance. False when either number is missing: no check, no claim.
 */
export function featureDistanceDisagrees(f: LocateResult['dominant_feature']): boolean {
  if (!f || typeof f.distance_m !== 'number' || typeof f.distance_check_m !== 'number') return false;
  return Math.abs(f.distance_m - f.distance_check_m) > 0.2 * f.distance_m;
}

/** Headline numbers in plain words, for the result panel. */
export function verdict(r: LocateResult): { title: string; tone: 'ok' | 'caution' | 'bad' } {
  if (r.status === 'no_match') return { title: 'NO GOOD MATCH', tone: 'bad' };
  if (r.status === 'ambiguous') return { title: 'SEVERAL PLACES FIT', tone: 'caution' };
  return { title: 'POSITION FOUND', tone: 'ok' };
}
