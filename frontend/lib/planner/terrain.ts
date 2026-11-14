import type { LatLon } from '@/lib/planner/types';
import { MARS_RADIUS_M } from '@/lib/nav/geo';

export const DEMO_BOUNDS = { south: 18.415, west: 77.380, north: 18.500, east: 77.480 };

const M_PER_DEG_LAT = (MARS_RADIUS_M * Math.PI) / 180;
const M_PER_DEG_LON = M_PER_DEG_LAT * Math.cos((((DEMO_BOUNDS.south + DEMO_BOUNDS.north) / 2) * Math.PI) / 180);

export type LocalM = { x: number; y: number }; // metres east / north of the south-west corner of DEMO_BOUNDS

export function toLocalM(p: LatLon): LocalM {
  return { x: (p.lon - DEMO_BOUNDS.west) * M_PER_DEG_LON, y: (p.lat - DEMO_BOUNDS.south) * M_PER_DEG_LAT };
}

export function fromLocalM(m: LocalM): LatLon {
  return { lat: DEMO_BOUNDS.south + m.y / M_PER_DEG_LAT, lon: DEMO_BOUNDS.west + m.x / M_PER_DEG_LON };
}

export const AREA_WIDTH_M = (DEMO_BOUNDS.east - DEMO_BOUNDS.west) * M_PER_DEG_LON;
export const AREA_HEIGHT_M = (DEMO_BOUNDS.north - DEMO_BOUNDS.south) * M_PER_DEG_LAT;

// Two steep local features on the straight line between the default start and end: a mound and a pit.
const MOUND = { ...toLocalM({ lat: 18.4557, lon: 77.4402 }), heightM: 18, sigmaM: 55 };
const PIT = { ...toLocalM({ lat: 18.4779, lon: 77.4187 }), heightM: -16, sigmaM: 50 };

const bump = (b: typeof MOUND, x: number, y: number) =>
  b.heightM * Math.exp(-((x - b.x) ** 2 + (y - b.y) ** 2) / (2 * b.sigmaM ** 2));

/** Made-up terrain: a gentle regional tilt, broad crossing relief with gentler corridors between the slopes, and two steep local features. Metres, deterministic. */
export function elevationAt(p: LatLon): number {
  const { x, y } = toLocalM(p);
  return (
    -2517 +
    0.0015 * x -
    0.001 * y +
    20 * Math.sin(x / 90 + 0.6) * Math.sin(y / 80 + 1.3) +
    10 * Math.sin((x - y) / 130 + 2.1) +
    4 * Math.sin((x + 2 * y) / 75) +
    bump(MOUND, x, y) +
    bump(PIT, x, y)
  );
}
