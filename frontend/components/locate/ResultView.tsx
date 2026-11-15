'use client';

import dynamic from 'next/dynamic';
import { useEffect, useMemo, useState } from 'react';
import type L from 'leaflet';
import type { OverlayState } from '@/components/jezero/JezeroMap';
import { circle, featureLine, featurePoint, featureDistanceDisagrees, heatmapPixels, photoWedges, resultExtent, verdict } from '@/lib/locate/resultGeo';
import type { LocateRequest, LocateResult } from '@/lib/locate/types';
import { distanceM } from '@/lib/nav/geo';
import { formatDistance } from '@/lib/nav/format';
import css from './result.module.css';

const JezeroMap = dynamic(() => import('@/components/jezero/JezeroMap'), {
  ssr: false,
  loading: () => <div className={css.mapLoading}>LOADING MAP…</div>,
});

const WEDGE_RANGE_M = 3000;
const HEAT_MAX_ALPHA = 0.45; // the best cell is see-through: the ground under the answer matters

type Props = {
  result: LocateResult;
  request: LocateRequest;
  /** Shown above everything when the answer is a saved one, not a live request. */
  savedNote?: string | null;
};

const fmtDist = (m: number) => {
  const d = formatDistance(m);
  return `${d.value} ${d.unit}`;
};
const fmtLatLon = (lat: number, lon: number) =>
  `${Math.abs(lat).toFixed(5)}° ${lat >= 0 ? 'N' : 'S'}  ${Math.abs(lon).toFixed(5)}° ${lon >= 0 ? 'E' : 'W'}`;
/** "—" for a number the engine could not compute (null): never a made-up value. */
const DASH = '—';
const orDash = (v: number | null | undefined, fmt: (n: number) => string) => (typeof v === 'number' ? fmt(v) : DASH);
const pct = (v: number | null | undefined) => orDash(v, n => `${Math.round(n * 100)} %`);
const compass = (deg: number) => ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'][Math.round((((deg % 360) + 360) % 360) / 45) % 8];

function cssVar(name: string, fallback: string): string {
  if (typeof document === 'undefined') return fallback;
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback;
}

function hexToRgb(hex: string): [number, number, number] {
  const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex.trim());
  return m ? [parseInt(m[1], 16), parseInt(m[2], 16), parseInt(m[3], 16)] : [255, 176, 0];
}

/** The engine's answer on the Jezero map, with the numbers beside it. */
export function ResultView({ result, request, savedNote }: Props) {
  const [map, setMap] = useState<L.Map | null>(null);
  const [overlays] = useState<OverlayState>({ slope: false, sand: false });
  const [showHeat, setShowHeat] = useState(true);
  const v = verdict(result);
  const hfovById = useMemo(() => Object.fromEntries(request.photos.map(p => [p.id, p.camera.hfov_deg])), [request]);
  const line = featureLine(result);

  useResultLayers(map, result, hfovById, showHeat);
  useFitResult(map, result);

  return (
    <section className={css.result} aria-label="Where the photos were taken" data-testid="result-view" data-status={result.status}>
      {savedNote && <p className={css.saved} data-testid="saved-banner">{savedNote}</p>}
      <div className={css.panel}>
        <h2 className={`${css.verdict} ${css[`tone-${v.tone}`]}`}>{v.title}</h2>
        {result.status === 'no_match' && (
          <p className={css.note}>Nothing fits well enough. The point shown is only the least bad place: do not rely on it.</p>
        )}
        {result.status === 'ambiguous' && (
          <p className={css.note}>Another, separate place fits nearly as well. Look at the candidates and the heat map, not one point.</p>
        )}

        <dl className={css.facts}>
          <div><dt>POSITION</dt><dd data-testid="best-latlon">{fmtLatLon(result.best.lat, result.best.lon)}</dd></div>
          <div>
            <dt>FROM LANDING SITE</dt>
            <dd>{fmtDist(Math.hypot(result.best.east_m, result.best.north_m))} {compass(Math.atan2(result.best.east_m, result.best.north_m) * 180 / Math.PI)}</dd>
          </div>
          <div><dt>WITHIN (68 %)</dt><dd data-testid="best-uncertainty">± {fmtDist(result.best.uncertainty_m)}</dd></div>
          <div><dt>WITHIN (95 %)</dt><dd>± {fmtDist(result.best.uncertainty_95_m)}</dd></div>
          <div><dt>FACING (PHOTO 1)</dt><dd>{orDash(result.best.heading_deg, h => `${h.toFixed(1)}° ${compass(h)}`)}</dd></div>
          <div><dt>SKYLINE FIT</dt><dd>{orDash(result.best.score, n => `${Math.round(n * 100)} % of the trusted line`)}</dd></div>
          <div><dt>SHARE OF LIKELIHOOD</dt><dd>{pct(result.best.probability)}</dd></div>
          <div><dt>GROUND HEIGHT</dt><dd data-testid="best-ground">{orDash(result.best.ground_elevation_m, n => `${Math.round(n)} m`)}</dd></div>
        </dl>

        <h3 className={css.sub}>DOMINANT FEATURE</h3>
        {result.dominant_feature && line ? (
          <p className={css.body} data-testid="dominant-feature">
            {result.dominant_feature.name ?? 'Unnamed terrain'}, {fmtDist(result.dominant_feature.distance_m ?? line.distanceM)} to the{' '}
            {compass(line.bearingDeg)} ({line.bearingDeg.toFixed(0)}°)
            {typeof result.dominant_feature.elev_angle_deg === 'number'
              && `, ${result.dominant_feature.elev_angle_deg.toFixed(1)}° above the horizon`}.
            {featureDistanceDisagrees(result.dominant_feature) && ' The distance check disagrees: treat it with care.'}
          </p>
        ) : !result.dominant_feature && <p className={css.note}>The engine did not name one for this answer.</p>}

        {result.warnings.length > 0 && (
          <>
            <h3 className={css.sub}>WARNINGS</h3>
            <ul className={css.warnings}>{result.warnings.map(w => <li key={w}>{w}</li>)}</ul>
          </>
        )}

        <h3 className={css.sub}>CANDIDATES</h3>
        <ol className={css.table} data-testid="candidates">
          {result.candidates.map(c => (
            <li key={c.rank}>
              <span className={css.rank}>{c.rank}</span>
              <span>{c.rank === 1 ? 'best' : `${fmtDist(distanceM(result.best, c))} away`}</span>
              <span>{pct(c.probability)}</span>
              <span>fit {pct(c.score)}</span>
            </li>
          ))}
        </ol>

        <h3 className={css.sub}>PHOTOS</h3>
        <ol className={css.table}>
          {result.photos.map(p => (
            <li key={p.id}>
              <span className={css.rank}>{p.id.replace('photo_', '')}</span>
              <span>{orDash(p.heading_deg, h => `${h.toFixed(1)}° ${compass(h)}`)}</span>
              <span>{pct(p.inlier_fraction)} fits</span>
              <span>{orDash(p.rms_residual_deg, n => `±${n.toFixed(2)}°`)}</span>
            </li>
          ))}
        </ol>

        <label className={css.toggle}>
          <input type="checkbox" checked={showHeat} onChange={e => setShowHeat(e.target.checked)} /> HEAT MAP
        </label>
        <p className={css.engine}>
          Engine {result.engine.version} · {result.engine.terrain_sources.join(', ')} · {result.engine.candidate_spacing_m} m grid
          {result.engine.timing_ms.total !== undefined && ` · ${(result.engine.timing_ms.total / 1000).toFixed(1)} s`}
        </p>
      </div>

      <div className={css.mapBox}>
        <JezeroMap overlays={overlays} onMap={setMap} />
        <ul className={css.key} aria-label="Map key">
          <li><i className={css.kBest} /> BEST</li>
          <li><i className={css.k68} /> 68 %</li>
          <li><i className={css.k95} /> 95 %</li>
          <li><i className={css.kCand} /> OTHER PLACES</li>
          <li><i className={css.kWedge} /> FACING</li>
          {showHeat && <li><i className={css.kHeat} /> LIKELIHOOD</li>}
          {line && <li><i className={css.kFeature} /> FEATURE</li>}
        </ul>
      </div>
    </section>
  );
}

/** Frames the answer once per answer, not on every layer toggle. */
function useFitResult(map: L.Map | null, result: LocateResult) {
  useEffect(() => {
    if (!map) return;
    void import('leaflet').then(({ default: Lf }) => {
      const pts = resultExtent(result).map(p => Lf.latLng(p.lat, p.lon));
      map.fitBounds(Lf.latLngBounds(pts), { padding: [40, 40], maxZoom: 16 });
    });
  }, [map, result]);
}

/** Draws the answer on the map; everything is removed again when the answer or the map changes. */
function useResultLayers(map: L.Map | null, result: LocateResult, hfovById: Record<string, number>, showHeat: boolean) {
  useEffect(() => {
    if (!map) return;
    let cancelled = false;
    let group: L.LayerGroup | null = null;
    void import('leaflet').then(({ default: Lf }) => {
      if (cancelled) return;
      const text = cssVar('--text', '#FFFFFF');
      const surface = cssVar('--surface', '#0A0A0B');
      const caution = cssVar('--caution', '#FFB000');
      const nominal = cssVar('--nominal', '#5BE37D');
      if (!map.getPane('result-heat')) map.createPane('result-heat').style.zIndex = '430';
      if (!map.getPane('result')) map.createPane('result').style.zIndex = '450';
      group = Lf.layerGroup().addTo(map);
      const ll = (p: { lat: number; lon: number }) => Lf.latLng(p.lat, p.lon);

      const grid = result.likelihood_grid;
      if (showHeat && grid && grid.rows > 0 && grid.cols > 0) {
        const canvas = document.createElement('canvas');
        canvas.width = grid.cols;
        canvas.height = grid.rows;
        const ctx = canvas.getContext('2d');
        if (ctx) {
          const img = ctx.createImageData(grid.cols, grid.rows);
          img.data.set(heatmapPixels(grid, hexToRgb(caution), HEAT_MAX_ALPHA));
          ctx.putImageData(img, 0, 0);
          Lf.imageOverlay(canvas.toDataURL(), grid.bounds, { pane: 'result-heat', className: 'result-heat' }).addTo(group);
        }
      }

      for (const w of photoWedges(result, hfovById, WEDGE_RANGE_M)) {
        Lf.polygon(w.points.map(ll), { pane: 'result', color: text, weight: 1, opacity: 0.7, fillColor: text, fillOpacity: 0.1 })
          .bindTooltip(`${w.id.replace('_', ' ').toUpperCase()} · ${w.headingDeg.toFixed(0)}°`, { sticky: true })
          .addTo(group);
      }
      const line = featureLine(result);
      if (line) {
        Lf.polyline(line.points.map(ll), { pane: 'result', color: nominal, weight: 2, dashArray: '6 6' })
          .bindTooltip(`${(line.distanceM / 1000).toFixed(1)} km`, { permanent: true, direction: 'center' })
          .addTo(group);
        Lf.circleMarker(ll(featurePoint(result)!), { pane: 'result', radius: 5, color: nominal, fillColor: nominal, fillOpacity: 1 })
          .addTo(group);
      }
      Lf.polygon(circle(result.best, result.best.uncertainty_95_m).map(ll), {
        pane: 'result', color: text, weight: 1.5, dashArray: '6 5', fill: false,
      }).addTo(group);
      Lf.polygon(circle(result.best, result.best.uncertainty_m).map(ll), {
        pane: 'result', color: text, weight: 2, fillColor: text, fillOpacity: 0.08,
      }).addTo(group);
      for (const c of result.candidates.slice(1)) {
        Lf.circleMarker(ll(c), { pane: 'result', radius: 7, color: caution, weight: 2, fill: false })
          .bindTooltip(String(c.rank), { permanent: true, direction: 'right', offset: [8, 0], className: 'result-rank' })
          .addTo(group);
      }
      Lf.circleMarker(ll(result.best), { pane: 'result', radius: 7, color: surface, weight: 2, fillColor: text, fillOpacity: 1 })
        // On the left: the landing site's own label sits on the right, and the answer is often near it.
        .bindTooltip('BEST', { permanent: true, direction: 'left', offset: [-10, 0], className: 'result-rank' })
        .addTo(group);

    });
    return () => {
      cancelled = true;
      group?.remove();
    };
  }, [map, result, hfovById, showHeat]);
}
