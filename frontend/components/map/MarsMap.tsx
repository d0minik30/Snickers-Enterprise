'use client';

import { useEffect, useRef, useState } from 'react';
import OlMap from 'ol/Map';
import View from 'ol/View';
import Feature from 'ol/Feature';
import { LineString, MultiPolygon, Point, Polygon, type Geometry } from 'ol/geom';
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
    case 'area': return new MultiPolygon(o.rings.map(ring => [ring.map(toCoord)]));
    case 'route': return new LineString(o.points.map(toCoord));
    case 'hazard': return new Polygon([groundCircle(o.hazard.center, o.hazard.radiusM)]);
    case 'ring': return new Polygon([groundCircle(o.center, o.radiusM)]);
    case 'waypoint':
    case 'endpoint':
    case 'traveller':
    case 'label': return new Point(toCoord(o.pos));
  }
}

/**
 * Which label wins when two would overlap: lower first. What the traveller and the routes are doing matters most,
 * then where the route starts and ends, then hazards, then sand.
 */
function labelPriority(o: MapOverlay): number {
  const id = o.id;
  if (id.startsWith('label:received') || id.startsWith('label:estimated') || id.startsWith('label:pending')) return 0;
  if (id.startsWith('label:route')) return 1;
  if (id === 'label:start' || id === 'label:end') return 2;
  if (id.startsWith('label:hazard')) return o.kind === 'label' && o.tone === 'inverse' ? 1 : 3; // a fresh flag outranks old survey hazards
  if (id.startsWith('label:sand')) return 5;
  return 4;
}

function toFeature(o: MapOverlay): Feature {
  const feature = new Feature(overlayGeometry(o));
  feature.set('overlay', o);
  return feature;
}

/** Heading-up, with the followed position at FOLLOW_ANCHOR of the uncovered map; applied without animation. */
function applyFollow(map: OlMap, camera: Extract<MapCamera, { mode: 'follow' }>) {
  const size = map.getSize();
  if (!size) return;
  const view = map.getView();
  view.setRotation((-camera.headingDeg * Math.PI) / 180);
  view.setZoom(camera.zoom);
  const visibleH = Math.max(0, size[1] - (camera.insetBottomPx ?? 0));
  view.centerOn(toCoord(camera.center), size, [size[0] * FOLLOW_ANCHOR[0], visibleH * FOLLOW_ANCHOR[1]]);
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
    case 'follow': return `follow:${camera.center.lat},${camera.center.lon},${camera.headingDeg},${camera.zoom},${camera.insetBottomPx ?? 0}`;
    case 'fit': return `fit:${camera.points.map(p => `${p.lat},${p.lon}`).join(';')}`;
    case 'free': return 'free';
  }
}

const ZOOM_ANIM_MS = 200;

/**
 * Pans and zooms like an everyday web map: drag, wheel, pinch, double-click and the +/- buttons.
 * Once the user moves the map it stops following the camera (route fit or crew follow) until RECENTER is pressed;
 * a new fit (a different route) takes the camera back by itself.
 */
export default function MarsMap({ overlays, camera, onMapClick, armed = false, className }: Props) {
  const targetRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<OlMap | null>(null);
  const sourceRef = useRef<VectorSource | null>(null);
  const labelSourceRef = useRef<VectorSource | null>(null);
  const cameraRef = useRef(camera);
  const clickRef = useRef(onMapClick);
  const [tilesUnavailable, setTilesUnavailable] = useState(false);
  const [detached, setDetached] = useState(false); // the user moved the map: the camera no longer drives it
  const detachedRef = useRef(false);
  const detach = () => { detachedRef.current = true; setDetached(true); };
  const detachRef = useRef(detach);

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
    const labelSource = new VectorSource();
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

    // Text chips on their own layer with decluttering, so no two labels ever draw on top of each other. When two
    // would collide, the one earlier in labelPriority order is kept; the other reappears once you zoom in.
    const labelLayer = new VectorLayer({
      source: labelSource,
      declutter: 'labels',
      updateWhileAnimating: true,
      updateWhileInteracting: true,
      renderOrder: (a, b) => labelPriority(a.get('overlay') as MapOverlay) - labelPriority(b.get('overlay') as MapOverlay),
      style: (feature, resolution) =>
        overlayStyle(feature.get('overlay') as MapOverlay, { theme, resolution, rotation: view.getRotation() }),
    });
    map.addLayer(labelLayer);

    // Ring labels sit at a fixed screen position on the ring, so re-style when the map turns.
    view.on('change:rotation', () => overlayLayer.changed());
    map.on('change:size', () => { if (!detachedRef.current) applyCamera(map, cameraRef.current); });
    // Any move made by hand (drag, wheel, pinch, double-click) hands the view to the user.
    map.on('pointerdrag', () => detachRef.current());
    map.on('dblclick', () => detachRef.current());
    const onWheel = () => detachRef.current();
    target.addEventListener('wheel', onWheel, { passive: true });
    map.on('click', e => clickRef.current?.({ lat: e.coordinate[1], lon: e.coordinate[0] }));

    let disposed = false;
    document.fonts.ready.then(() => { if (!disposed) { overlayLayer.changed(); labelLayer.changed(); } });

    mapRef.current = map;
    sourceRef.current = source;
    labelSourceRef.current = labelSource;
    return () => {
      disposed = true;
      target.removeEventListener('wheel', onWheel);
      mapRef.current = null;
      sourceRef.current = null;
      labelSourceRef.current = null;
      map.setTarget(undefined);
      map.dispose();
    };
  }, []);

  useEffect(() => {
    const source = sourceRef.current;
    const labelSource = labelSourceRef.current;
    if (!source || !labelSource) return;
    source.clear(true);
    labelSource.clear(true);
    source.addFeatures(overlays.filter(o => o.kind !== 'label').map(toFeature));
    labelSource.addFeatures(overlays.filter(o => o.kind === 'label').map(toFeature));
  }, [overlays]);

  const key = cameraKey(camera);
  // A new fit (another route, new start or end) takes the view back; follow updates do not.
  const fitKey = camera.mode === 'fit' ? key : '';
  const [seenFitKey, setSeenFitKey] = useState(fitKey);
  if (seenFitKey !== fitKey) {
    setSeenFitKey(fitKey);
    if (fitKey) setDetached(false);
  }
  useEffect(() => {
    detachedRef.current = detached;
  }, [detached]);
  useEffect(() => {
    const map = mapRef.current;
    if (map && !detached) applyCamera(map, cameraRef.current);
  }, [key, detached]);

  const zoomBy = (delta: number) => {
    const view = mapRef.current?.getView();
    const zoom = view?.getZoom();
    if (!view || zoom === undefined) return;
    detach();
    view.animate({ zoom: Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom + delta)), duration: ZOOM_ANIM_MS });
  };
  const canRecenter = detached && camera.mode !== 'free';

  const classes = [css.map, armed ? css.armed : '', className ?? ''].filter(Boolean).join(' ');
  return (
    <div data-testid="mars-map" className={classes}>
      <div ref={targetRef} className={css.canvas} />
      <div className={css.controls} onPointerDown={e => e.stopPropagation()}>
        {canRecenter && (
          <button type="button" className={css.recenter} data-testid="map-recenter" onClick={() => setDetached(false)}>
            RECENTER
          </button>
        )}
        <button type="button" className={css.zoomButton} aria-label="Zoom in" data-testid="map-zoom-in" onClick={() => zoomBy(1)}>+</button>
        <button type="button" className={css.zoomButton} aria-label="Zoom out" data-testid="map-zoom-out" onClick={() => zoomBy(-1)}>−</button>
      </div>
      {tilesUnavailable && (
        <div data-testid="tiles-unavailable" className={css.unavailable}>
          MAP IMAGERY UNAVAILABLE · ROUTE DATA STILL LIVE
        </div>
      )}
    </div>
  );
}
