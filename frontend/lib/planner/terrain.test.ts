import { describe, expect, it } from 'vitest';
import { DEFAULT_END, DEFAULT_START, PRESET_HAZARDS, planRoutes } from '@/lib/planner';
import { DEMO_BOUNDS, TERRAIN, elevationAt, isSandAt, sandAreas, slopeAt } from '@/lib/planner/terrain';
import { pointAlong } from '@/lib/nav/geo';

describe('real Jezero terrain', () => {
  it('the extract covers the whole demo area', () => {
    expect(TERRAIN.north).toBeGreaterThanOrEqual(DEMO_BOUNDS.north);
    expect(TERRAIN.west).toBeLessThanOrEqual(DEMO_BOUNDS.west);
    expect(TERRAIN.north - TERRAIN.rows * TERRAIN.cellDeg).toBeLessThanOrEqual(DEMO_BOUNDS.south);
    expect(TERRAIN.west + TERRAIN.cols * TERRAIN.cellDeg).toBeGreaterThanOrEqual(DEMO_BOUNDS.east);
  });

  it('reads the landing site at its known height', () =>
    // data/output/places.geojson gives -2567.2 m for the 20 m DEM pixel; the 40 m grid is within a couple of metres.
    expect(Math.abs(elevationAt(DEFAULT_START) - -2567.2)).toBeLessThan(3));

  it('elevation is continuous between cells', () => {
    const a = elevationAt(DEFAULT_START);
    const b = elevationAt({ lat: DEFAULT_START.lat + 0.00005, lon: DEFAULT_START.lon });
    expect(Math.abs(a - b)).toBeLessThan(1);
  });

  it('has real slope and sand in the demo area', () => {
    let steep = 0;
    let sand = 0;
    for (let lat = DEMO_BOUNDS.south; lat < DEMO_BOUNDS.north; lat += 0.0005) {
      for (let lon = DEMO_BOUNDS.west; lon < DEMO_BOUNDS.east; lon += 0.0005) {
        if (slopeAt({ lat, lon }) > 20) steep++;
        if (isSandAt({ lat, lon })) sand++;
      }
    }
    expect(steep).toBeGreaterThan(0);
    expect(sand).toBeGreaterThan(0);
  });

  it('the shortest route climbs the delta scarp that the slope-aware routes go around', () => {
    const [safest, shortest, flattest] = planRoutes(DEFAULT_START, DEFAULT_END, PRESET_HAZARDS);
    expect(shortest.maxSlopeDeg).toBeGreaterThan(25);
    expect(safest.maxSlopeDeg).toBeLessThan(shortest.maxSlopeDeg - 5);
    expect(flattest.maxSlopeDeg).toBeLessThanOrEqual(15);
  });

  it('the safest route keeps off mapped sand', () => {
    const [safest] = planRoutes(DEFAULT_START, DEFAULT_END, PRESET_HAZARDS);
    let onSandM = 0;
    for (let d = 0; d < safest.lengthM; d += 20) if (isSandAt(pointAlong(safest.points, d).pos)) onSandM += 20;
    expect(onSandM).toBeLessThanOrEqual(80);
  });

  it('draws sand exactly where the grid has it', () => {
    const patches = sandAreas();
    expect(patches.length).toBeGreaterThan(0);
    for (const a of patches) {
      expect(isSandAt(a.labelAt)).toBe(true);
      for (const ring of a.rings) {
        expect(ring[0]).toEqual(ring[ring.length - 1]); // closed
        const mid = { lat: (ring[0].lat + ring[2].lat) / 2, lon: (ring[0].lon + ring[2].lon) / 2 };
        expect(isSandAt(mid)).toBe(true);
      }
    }
  });
});
