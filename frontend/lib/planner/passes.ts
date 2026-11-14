import type { SatellitePass } from '@/lib/planner/types';

const PASS_MINUTES = [6, 19, 31, 47, 58, 76, 95, 121, 138, 160, 171, 190];
const SATELLITES = ['MRO', 'MAVEN', 'TGO'];

export function satellitePasses(): SatellitePass[] {
  return PASS_MINUTES.map((minute, i) => {
    const satellite = SATELLITES[i % SATELLITES.length];
    return { satellite, tMs: minute * 60_000, quality: satellite === 'MAVEN' ? 'low' : 'overhead' };
  });
}

/** Position uncertainty in metres after walking this far since the last fix. */
export function positionErrorM(distSinceFixM: number): number {
  return 1 + 0.02 * distSinceFixM;
}
