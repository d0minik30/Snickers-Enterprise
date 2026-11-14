import type { LatLon } from '@/lib/planner/types';

/**
 * Radius of the Mars 2000 sphere (IAU 2000), in metres. All map data (NASA Mars Trek tiles, the
 * Jezero DEM, slope, sand and the cost grid in ../data) is in degrees on this sphere, so distances,
 * the scale bar and the grid's 40 m cells all agree. The one radius for the whole frontend.
 */
export const MARS_RADIUS_M = 3396190;

const toRad = (deg: number) => (deg * Math.PI) / 180;
const toDeg = (rad: number) => (rad * 180) / Math.PI;

/** Great-circle distance in metres (haversine). */
export function distanceM(a: LatLon, b: LatLon): number {
  const dLat = toRad(b.lat - a.lat);
  const dLon = toRad(b.lon - a.lon);
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * MARS_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Initial bearing, 0..360, 0 = north, clockwise. */
export function bearingDeg(a: LatLon, b: LatLon): number {
  const dLon = toRad(b.lon - a.lon);
  const y = Math.sin(dLon) * Math.cos(toRad(b.lat));
  const x =
    Math.cos(toRad(a.lat)) * Math.sin(toRad(b.lat)) -
    Math.sin(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.cos(dLon);
  return (toDeg(Math.atan2(y, x)) + 360) % 360;
}

export function destination(from: LatLon, bearing: number, distM: number): LatLon {
  const d = distM / MARS_RADIUS_M;
  const br = toRad(bearing);
  const lat1 = toRad(from.lat);
  const lat2 = Math.asin(Math.sin(lat1) * Math.cos(d) + Math.cos(lat1) * Math.sin(d) * Math.cos(br));
  const lon2 =
    toRad(from.lon) +
    Math.atan2(Math.sin(br) * Math.sin(d) * Math.cos(lat1), Math.cos(d) - Math.sin(lat1) * Math.sin(lat2));
  return { lat: toDeg(lat2), lon: ((toDeg(lon2) + 540) % 360) - 180 };
}

/** Distance along the path at each point; starts at 0. */
export function cumulativeM(points: LatLon[]): number[] {
  const out = [0];
  for (let i = 1; i < points.length; i++) out.push(out[i - 1] + distanceM(points[i - 1], points[i]));
  return out;
}

function interpolate(a: LatLon, b: LatLon, t: number): LatLon {
  return { lat: a.lat + (b.lat - a.lat) * t, lon: a.lon + (b.lon - a.lon) * t };
}

/** Position and heading at a distance along the path, clamped to its ends. */
export function pointAlong(points: LatLon[], distM: number): { pos: LatLon; bearingDeg: number } {
  const cum = cumulativeM(points);
  const total = cum[cum.length - 1];
  const d = Math.min(Math.max(distM, 0), total);
  let i = 1;
  while (i < points.length - 1 && cum[i] < d) i++;
  const a = points[i - 1];
  const b = points[i];
  const segLen = cum[i] - cum[i - 1];
  const t = segLen === 0 ? 0 : (d - cum[i - 1]) / segLen;
  return { pos: t === 0 ? a : interpolate(a, b, t), bearingDeg: bearingDeg(a, b) };
}

/** Sub-path between two distances, with exact interpolated end points. */
export function slicePath(points: LatLon[], fromM: number, toM: number): LatLon[] {
  const cum = cumulativeM(points);
  const inner = points.filter((_, i) => cum[i] > fromM && cum[i] < toM);
  return [pointAlong(points, fromM).pos, ...inner, pointAlong(points, toM).pos];
}
