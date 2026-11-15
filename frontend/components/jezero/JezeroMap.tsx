'use client';

import { useEffect, useRef, useState } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import {
  DATA_URL,
  MARS_RADIUS_M,
  MAX_ZOOM,
  SAND_ATTRIBUTION,
  SLOPE_ATTRIBUTION,
  loadMapLayers,
  loadPlaces,
  loadSand,
  steepOnly,
  loadSlopeBounds,
} from './mapData';
import css from './jezero.module.css';

export type OverlayState = { slope: boolean; sand: boolean };
export type MapStatus = { zoom: number; cursor: L.LatLng | null };

type Props = {
  overlays: OverlayState;
  onStatus?: (s: MapStatus) => void;
  /** The Leaflet map once it exists (null when it goes), for screens that draw their own layers on it. */
  onMap?: (map: L.Map | null) => void;
};

const MARS_CRS = L.extend({}, L.CRS.EPSG4326, { R: MARS_RADIUS_M }) as L.CRS;

function cssVar(name: string, fallback: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback;
}

export default function JezeroMap({ overlays, onStatus, onMap }: Props) {
  const targetRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const slopeRef = useRef<L.ImageOverlay | null>(null);
  const sandRef = useRef<L.GeoJSON | null>(null);
  const overlaysRef = useRef(overlays);
  const statusRef = useRef(onStatus);
  const mapCbRef = useRef(onMap);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    overlaysRef.current = overlays;
    statusRef.current = onStatus;
    mapCbRef.current = onMap;
  });

  useEffect(() => {
    const target = targetRef.current;
    if (!target) return;
    let cancelled = false;
    let map: L.Map | null = null;

    const show = (layer: L.Layer | null, on: boolean) => {
      if (!map || !layer) return;
      if (on) layer.addTo(map);
      else layer.remove();
    };

    (async () => {
      const cfg = await loadMapLayers();
      if (cancelled) return;

      map = L.map(target, {
        crs: MARS_CRS,
        center: cfg.center,
        zoom: cfg.zoom,
        minZoom: 0,
        maxZoom: MAX_ZOOM,
        zoomControl: false,
        attributionControl: false,
      });
      mapRef.current = map;

      // Fixed stacking regardless of load order: imagery < slope < sand < landing site.
      map.createPane('slope').style.zIndex = '410';
      map.createPane('sand').style.zIndex = '420';

      L.control.zoom({ position: 'topright' }).addTo(map);
      L.control.scale({ position: 'bottomleft', imperial: false, maxWidth: 160 }).addTo(map);
      L.control
        .attribution({ position: 'bottomright', prefix: '<a href="https://leafletjs.com" target="_blank" rel="noreferrer">Leaflet</a>' })
        .addAttribution(cfg.attribution)
        .addTo(map);

      // Base imagery, bottom to top, always on. URLs are used exactly as published.
      for (const spec of cfg.layers) {
        L.tileLayer(spec.url, {
          maxNativeZoom: spec.maxNativeZoom,
          maxZoom: MAX_ZOOM,
          bounds: spec.bounds ? L.latLngBounds(spec.bounds) : undefined,
          className: 'mars-tiles',
        }).addTo(map);
      }

      // Perseverance landing site.
      L.circleMarker(cfg.center, {
        pane: 'markerPane',
        radius: 7,
        color: cssVar('--surface', '#0A0A0B'),
        weight: 2,
        fillColor: cssVar('--text', '#FFFFFF'),
        fillOpacity: 1,
      })
        .bindTooltip('PERSEVERANCE LANDING SITE', {
          permanent: true,
          direction: 'right',
          offset: [10, 0],
          className: css.siteLabel,
        })
        .addTo(map);

      // Mission sites from the data team's places.geojson; the traverse in Control ends at the Western Delta Deposit.
      // Not awaited: the map and its overlays do not wait for them, and a missing file only drops the markers.
      loadPlaces().then(places => {
        if (cancelled || !map) return;
        for (const f of places.features) {
          if (f.properties.type !== 'mission_site') continue;
          const [lon, lat] = f.geometry.coordinates;
          const isEnd = f.properties.name === 'Western Delta Deposit';
          const height = f.properties.elevation_m === undefined ? '' : ` · ${Math.round(f.properties.elevation_m).toLocaleString('en-US')} m`;
          L.circleMarker([lat, lon], {
            pane: 'markerPane',
            radius: 6,
            color: cssVar('--text', '#FFFFFF'),
            weight: 2,
            fillColor: cssVar(isEnd ? '--route' : '--surface', isEnd ? '#FF5CE1' : '#0A0A0B'),
            fillOpacity: 1,
          })
            // Only the traverse end keeps its label up; the other sites show theirs on hover or tap, so labels
            // do not pile up when zoomed out.
            .bindTooltip(`${f.properties.name.toUpperCase()}${isEnd ? ' · TRAVERSE END' : ''}${height}`, {
              permanent: isEnd,
              direction: isEnd ? 'top' : 'right',
              offset: isEnd ? [0, -8] : [9, 0],
              className: css.siteLabel,
            })
            .addTo(map);
        }
      }).catch(() => {});

      map.on('zoomend', () => statusRef.current?.({ zoom: map!.getZoom(), cursor: null }));
      map.on('mousemove', e => statusRef.current?.({ zoom: map!.getZoom(), cursor: e.latlng }));
      map.on('mouseout', () => statusRef.current?.({ zoom: map!.getZoom(), cursor: null }));
      statusRef.current?.({ zoom: map.getZoom(), cursor: null });
      mapCbRef.current?.(map);

      const [slopeBounds, sand, slopeImage] = await Promise.all([loadSlopeBounds(), loadSand(), steepOnly(DATA_URL.slopePng)]);
      if (cancelled) return;

      slopeRef.current = L.imageOverlay(slopeImage, slopeBounds, {
        attribution: SLOPE_ATTRIBUTION,
        className: css.slope,
        pane: 'slope',
      });
      const sandColor = cssVar('--text', '#FFFFFF');
      sandRef.current = L.geoJSON(sand, {
        attribution: SAND_ATTRIBUTION,
        pane: 'sand',
        style: { color: sandColor, weight: 1.5, opacity: 0.9, fillColor: sandColor, fillOpacity: 0.12 },
      });
      show(slopeRef.current, overlaysRef.current.slope);
      show(sandRef.current, overlaysRef.current.sand);
    })().catch((e: unknown) => {
      if (!cancelled) setError(e instanceof Error ? e.message : String(e));
    });

    return () => {
      cancelled = true;
      mapRef.current = null;
      slopeRef.current = null;
      sandRef.current = null;
      if (map) mapCbRef.current?.(null);
      map?.remove();
    };
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    for (const [layer, on] of [[slopeRef.current, overlays.slope], [sandRef.current, overlays.sand]] as const) {
      if (!layer) continue;
      if (on && !map.hasLayer(layer)) layer.addTo(map);
      if (!on && map.hasLayer(layer)) layer.remove();
    }
  }, [overlays.slope, overlays.sand]);

  return (
    <div data-testid="jezero-map" className={css.map}>
      <div ref={targetRef} className={css.canvas} />
      {error && (
        <div role="alert" className={css.unavailable}>
          MAP DATA UNAVAILABLE · {error}
        </div>
      )}
    </div>
  );
}
