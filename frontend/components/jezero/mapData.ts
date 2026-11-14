// Shapes of the files the data team publishes in data/ (copied to public/data/ by scripts/copy-data.mjs).
// Coordinates are [lat, lon] in degrees, east-positive, on the Mars 2000 sphere.

export type LatLonPair = [number, number];
export type BoundsPair = [LatLonPair, LatLonPair]; // [[lat_min, lon_min], [lat_max, lon_max]]

export type TileLayerSpec = {
  name: string;
  url: string;
  maxNativeZoom: number;
  bounds?: BoundsPair;
};

export type MapLayers = {
  center: LatLonPair;
  zoom: number;
  layers: TileLayerSpec[]; // bottom to top
  attribution: string;
};

export const DATA_URL = {
  layers: '/data/map_layers.json',
  slopePng: '/data/slope.png',
  slopeBounds: '/data/slope_bounds.json',
  sand: '/data/sand.geojson',
} as const;

export const SAND_ATTRIBUTION =
  'Sand: <a href="https://doi.org/10.3133/sim3464" target="_blank" rel="noreferrer">USGS SIM 3464 (Sun &amp; Stack, 2020)</a>';
export const SLOPE_ATTRIBUTION = 'Slope: MRO CTX Jezero DEM (20 m)';

/** Mars radius in metres, so the scale bar and distances are right. */
export const MARS_RADIUS_M = 3389500;
export const MAX_ZOOM = 19;

/** Slope classes, matching data/scripts/process_dem.py (alpha 128 is about 50 % opaque). */
export const SLOPE_CLASSES = [
  { label: '< 10°', color: 'rgb(0 190 0)' },
  { label: '10–25°', color: 'rgb(255 210 0)' },
  { label: '> 25°', color: 'rgb(230 0 0)' },
] as const;

async function getJson<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  return (await res.json()) as T;
}

export const loadMapLayers = () => getJson<MapLayers>(DATA_URL.layers);
export const loadSlopeBounds = () => getJson<BoundsPair>(DATA_URL.slopeBounds);
export const loadSand = () => getJson<GeoJSON.FeatureCollection>(DATA_URL.sand);
