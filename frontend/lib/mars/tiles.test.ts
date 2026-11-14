import { describe, expect, it } from 'vitest';
import { MARS_RESOLUTIONS, TREK_LAYERS, tileCoordFor, trekTileUrl } from '@/lib/mars/tiles';

describe('Mars Trek tiles', () => {
  it('has 18 resolutions, two 256 px tiles across 360 degrees at zoom 0', () => {
    expect(MARS_RESOLUTIONS).toHaveLength(18);
    expect(MARS_RESOLUTIONS[0]).toBe(0.703125);
  });
  it('finds the tile under a position', () => {
    expect(tileCoordFor({ lat: 18.4446, lon: 77.4509 }, 15)).toEqual({ x: 46867, y: 13026 });
    expect(tileCoordFor({ lat: 90, lon: -180 }, 0)).toEqual({ x: 0, y: 0 });
  });
  it('builds the Trek WMTS url as z/y/x', () =>
    expect(trekTileUrl('JEZ_hirise_soc_006_orthoMosaic_25cm_Eqc_latTs0_lon0_first_dd', 'png', 15, 46867, 13026)).toBe(
      'https://trek.nasa.gov/tiles/Mars/EQ/JEZ_hirise_soc_006_orthoMosaic_25cm_Eqc_latTs0_lon0_first_dd/1.0.0/default/default028mm/15/13026/46867.png'));
  it('stacks the layers from global to HiRISE', () =>
    expect(TREK_LAYERS.map(l => l.maxNativeZoom)).toEqual([7, 13, 17]));
});
