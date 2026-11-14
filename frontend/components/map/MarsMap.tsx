'use client';

import { useEffect, useRef, useState } from 'react';
import OlMap from 'ol/Map';
import View from 'ol/View';
import Feature from 'ol/Feature';
import { LineString, Point, Polygon, type Geometry } from 'ol/geom';
import { boundingExtent } from 'ol/extent';
import { defaults as defaultInteractions } from 'ol/interaction/defaults';
import TileLayer from 'ol/layer/Tile';
import VectorLayer from 'ol/layer/Vector';
import VectorSource from 'ol/source/Vector';
import XYZ from 'ol/source/XYZ';
import TileGrid from 'ol/tilegrid/TileGrid';
import type { MapCamera, MapOverlay } from '@/components/map/overlays';
import { groundCircle, overlayStyle, readTheme, toCoord, type MapTheme } from '@/components/map/styles';
import { createTileHealth, type TileHealth } from '@/lib/mars/tileHealth';
import { MARS_RESOLUTIONS, TREK_LAYERS, trekTileUrl, type TrekLayer } from '@/lib/mars/tiles';
import { DEMO_BOUNDS } from '@/lib/planner';
import type { LatLon } from '@/lib/planner/types';
import css from './MarsMap.module.css';

type Props = {
  overlays: MapOverlay[];
  camera: MapCamera;
  onMapClick?: (p: LatLon) => void;
  armed?: boolean;
  /** Let the user pan and zoom even while the camera is 'fit' (it is always allowed in 'free'). */
  interactive?: boolean;
  className?: string;
};

const MIN_ZOOM = 12;
const MAX_ZOOM = 18;
const FIT_PADDING_PX = [60, 60, 60, 60]; // top, right, bottom, left
const FOLLOW_ANCHOR = [0.5, 0.65]; // where the followed position sits, as fractions of width and height
const WORLD_EXTENT = [-180, -90, 180, 90];
const DEMO_EXTENT = [DEMO_BOUNDS.west, DEMO_BOUNDS.south, DEMO_BOUNDS.east, DEMO_BOUNDS.north];
// The tile table stops at zoom 17; one more level of the same series lets the view reach zoom 18
// while view zoom N stays exactly tile zoom N.
const VIEW_RESOLUTIONS = [...MARS_RESOLUTIONS, MARS_RESOLUTIONS[MARS_RESOLUTIONS.length - 1] / 2];

function trekTileLayer(layer: TrekLayer, health: TileHealth, onHealth: () => void): TileLayer<XYZ> {
  const source = new XYZ({
    projection: 'EPSG:4326',
    wrapX: false,
    transition: 0,
    tileGrid: new TileGrid({
      extent: WORLD_EXTENT,
      origin: [-180, 90],
      tileSize: 256,
      minZoom: layer.minZoom,
      resolutions: MARS_RESOLUTIONS.slice(0, layer.maxNativeZoom + 1),
    }),
    tileUrlFunction: ([z, x, y]) => trekTileUrl(layer.id, layer.ext, z, x, y),
  });
  source.on('tileloadend', () => { health.loaded(); onHealth(); });
  source.on('tileloaderror', () => { health.failed(); onHealth(); });
  const b = layer.bounds;
  return new TileLayer({
    source,
    className: 'mars-tiles',
    extent: b ? [b.west, b.south, b.east, b.north] : undefined,
  });
}

function overlayGeometry(o: MapOverlay): Geometry {
  switch (o.kind) {
    case 'route': return new LineString(o.points.map(toCoord));
    case 'hazard': return new Polygon([groundCircle(o.hazard.center, o.hazard.radiusM)]);
    case 'ring': return new Polygon([groundCircle(o.center, o.radiusM)]);
    case 'waypoint':
    case 'endpoint':
    case 'traveller':
    case 'label': return new Point(toCoord(o.pos));
  }
}

function toFeature(o: MapOverlay): Feature {
  const feature = new Feature(overlayGeometry(o));
  feature.set('overlay', o);
  return feature;
}

/** Heading-up, with the followed position at FOLLOW_ANCHOR of the map; applied without animation. */
function applyFollow(map: OlMap, camera: Extract<MapCamera, { mode: 'follow' }>) {
  const size = map.getSize();
  if (!size) return;
  const view = map.getView();
  view.setRotation((-camera.headingDeg * Math.PI) / 180);
  view.setZoom(camera.zoom);
  view.centerOn(toCoord(camera.center), size, [size[0] * FOLLOW_ANCHOR[0], size[1] * FOLLOW_ANCHOR[1]]);
}

function applyFit(map: OlMap, points: LatLon[]) {
  if (!map.getSize() || points.length === 0) return;
  const view = map.getView();
  view.setRotation(0);
  view.fit(boundingExtent(points.map(toCoord)), { padding: FIT_PADDING_PX });
}

function applyCamera(map: OlMap, camera: MapCamera) {
  if (camera.mode === 'follow') applyFollow(map, camera);
  else if (camera.mode === 'fit') applyFit(map, camera.points);
}

/** Changes whenever the camera should be re-applied: every follow update, but a fit only when its points change. */
function cameraKey(camera: MapCamera): string {
  switch (camera.mode) {
    case 'follow': return `follow:${camera.center.lat},${camera.center.lon},${camera.headingDeg},${camera.zoom}`;
    case 'fit': return `fit:${camera.points.map(p => `${p.lat},${p.lon}`).join(';')}`;
    case 'free': return 'free';
  }
}

export default function MarsMap({ overlays, camera, onMapClick, armed = false, interactive = false, className }: Props) {
  const targetRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<OlMap | null>(null);
  const sourceRef = useRef<VectorSource | null>(null);
  const cameraRef = useRef(camera);
  const clickRef = useRef(onMapClick);
  const [tilesUnavailable, setTilesUnavailable] = useState(false);

  useEffect(() => {
    cameraRef.current = camera;
    clickRef.current = onMapClick;
  });

  useEffect(() => {
    const target = targetRef.current;
    if (!target) return;
    const health = createTileHealth();
    const tileLayers = TREK_LAYERS.map(l => trekTileLayer(l, health, () => setTilesUnavailable(health.unavailable)));
    const source = new VectorSource();
    const view = new View({
      projection: 'EPSG:4326',
      resolutions: VIEW_RESOLUTIONS,
      constrainResolution: false,
      minZoom: MIN_ZOOM,
      maxZoom: MAX_ZOOM,
      extent: DEMO_EXTENT,
      center: [(DEMO_BOUNDS.west + DEMO_BOUNDS.east) / 2, (DEMO_BOUNDS.south + DEMO_BOUNDS.north) / 2],
      zoom: 14,
    });
    const map = new OlMap({
      target,
      view,
      controls: [],
      interactions: defaultInteractions({ altShiftDragRotate: false, pinchRotate: false }),
      layers: tileLayers,
    });
    const theme: MapTheme = readTheme(document.documentElement, map.getPixelRatio());
    const overlayLayer = new VectorLayer({
      source,
      updateWhileAnimating: true,
      updateWhileInteracting: true,
      style: (feature, resolution) =>
        overlayStyle(feature.get('overlay') as MapOverlay, { theme, resolution, rotation: view.getRotation() }),
    });
    map.addLayer(overlayLayer);

    // Ring labels sit at a fixed screen position on the ring, so re-style when the map turns.
    view.on('change:rotation', () => overlayLayer.changed());
    map.on('change:size', () => applyCamera(map, cameraRef.current));
    map.on('click', e => clickRef.current?.({ lat: e.coordinate[1], lon: e.coordinate[0] }));

    let disposed = false;
    document.fonts.ready.then(() => { if (!disposed) overlayLayer.changed(); });

    mapRef.current = map;
    sourceRef.current = source;
    return () => {
      disposed = true;
      mapRef.current = null;
      sourceRef.current = null;
      map.setTarget(undefined);
      map.dispose();
    };
  }, []);

  useEffect(() => {
    const source = sourceRef.current;
    if (!source) return;
    source.clear(true);
    source.addFeatures(overlays.map(toFeature));
  }, [overlays]);

  const key = cameraKey(camera);
  useEffect(() => {
    const map = mapRef.current;
    if (map) applyCamera(map, cameraRef.current);
  }, [key]);

  const free = camera.mode === 'free' || interactive;
  useEffect(() => {
    mapRef.current?.getInteractions().forEach(i => i.setActive(free));
  }, [free]);

  const classes = [css.map, armed ? css.armed : '', className ?? ''].filter(Boolean).join(' ');
  return (
    <div data-testid="mars-map" className={classes}>
      <div ref={targetRef} className={css.canvas} />
      {tilesUnavailable && (
        <div data-testid="tiles-unavailable" className={css.unavailable}>
          MAP IMAGERY UNAVAILABLE · ROUTE DATA STILL LIVE
        </div>
      )}
    </div>
  );
}
