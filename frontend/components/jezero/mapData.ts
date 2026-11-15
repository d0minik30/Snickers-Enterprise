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
  places: '/data/places.geojson',
} as const;

export const SAND_ATTRIBUTION =
  'Sand: <a href="https://doi.org/10.3133/sim3464" target="_blank" rel="noreferrer">USGS SIM 3464 (Sun &amp; Stack, 2020)</a>';
export const SLOPE_ATTRIBUTION = 'Slope: MRO CTX Jezero DEM (20 m)';

export { MARS_RADIUS_M } from '@/lib/nav/geo';
export const MAX_ZOOM = 19;

/**
 * Slope classes, matching data/scripts/process_dem.py (alpha 128 is about 50 % opaque). The gentle class covers
 * most of the crater floor, so it is not drawn (see steepOnly) and its swatch is shown as clear.
 */
export const SLOPE_CLASSES = [
  { label: '< 10° (not shaded)', color: 'transparent' },
  { label: '10–25°', color: 'rgb(255 210 0)' },
  { label: '> 25°', color: 'rgb(230 0 0)' },
] as const;

/**
 * The data team's slope.png paints every pixel; green (< 10°) covers about 85 % of it and hides the imagery.
 * Returns a copy as a data URL with green made clear and the steepest class a little stronger, so only the
 * slopes that matter for a traverse stand out. Leaves the published file untouched.
 */
export async function steepOnly(url: string): Promise<string> {
  const img = new Image();
  img.src = url;
  await img.decode();
  const canvas = document.createElement('canvas');
  canvas.width = img.naturalWidth;
  canvas.height = img.naturalHeight;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) return url;
  ctx.drawImage(img, 0, 0);
  const data = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const px = data.data;
  for (let i = 0; i < px.length; i += 4) {
    const [r, g, b] = [px[i], px[i + 1], px[i + 2]];
    if (r < 60 && g > 120 && b < 60) px[i + 3] = 0; // gentle: clear
    else if (r > 180 && g < 60) px[i + 3] = Math.max(px[i + 3], 200); // > 25 degrees: stronger
  }
  ctx.putImageData(data, 0, 0);
  return canvas.toDataURL('image/png');
}

async function getJson<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  return (await res.json()) as T;
}

export const loadMapLayers = () => getJson<MapLayers>(DATA_URL.layers);
export const loadSlopeBounds = () => getJson<BoundsPair>(DATA_URL.slopeBounds);
export const loadSand = () => getJson<GeoJSON.FeatureCollection>(DATA_URL.sand);

export const loadPlaces = () => getJson<GeoJSON.FeatureCollection<GeoJSON.Point, { name: string; type: string; elevation_m?: number }>>(DATA_URL.places);
