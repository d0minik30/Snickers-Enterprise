'use client';

import dynamic from 'next/dynamic';
import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import type L from 'leaflet';
import type { OverlayState } from '@/components/jezero/JezeroMap';
import { SiteNav } from '@/components/shared/SiteNav';
import { circle } from '@/lib/locate/resultGeo';
import { caseVerdict, headingError, isValidationReport, type ValidationCase, type ValidationReport } from '@/lib/locate/validation';
import css from './validate.module.css';

const JezeroMap = dynamic(() => import('@/components/jezero/JezeroMap'), {
  ssr: false,
  loading: () => <div className={css.mapLoading}>LOADING MAP…</div>,
});

const OVERLAYS: OverlayState = { slope: false, sand: false };

function cssVar(name: string, fallback: string): string {
  if (typeof document === 'undefined') return fallback;
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback;
}

type Load = { status: 'loading' } | { status: 'failed'; error: string } | { status: 'ready'; report: ValidationReport };

/**
 * Validation: real Perseverance photos with known positions, run through the whole chain
 * (backend/skyline/scripts/validate.py). Shows the saved run: true vs found position and the error.
 */
const VALIDATION_URL = '/validation.json';

export default function ValidateScreen() {
  const [load, setLoad] = useState<Load>({ status: 'loading' });
  const [map, setMap] = useState<L.Map | null>(null);
  const [selected, setSelected] = useState<string | null>(null);

  useEffect(() => {
    // Loaded at run time, not imported: the saved run only exists after someone has run validate.py, and a
    // missing import would break the whole build. validate.py writes it to frontend/public/validation.json.
    fetch(VALIDATION_URL)
      .then(r => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); })
      .then(json => {
        const report: unknown = json;
        setLoad(isValidationReport(report)
          ? { status: 'ready', report }
          : { status: 'failed', error: 'The saved validation run is not in the expected format.' });
      })
      .catch(() => setLoad({ status: 'failed', error: 'No saved validation run in this build.' }));
  }, []);

  const report = load.status === 'ready' ? load.report : null;
  const cases = useMemo(() => report?.cases ?? [], [report]);
  const current = cases.find(c => c.pose === selected) ?? null;
  useValidationLayers(map, cases, current, setSelected);

  return (
    <div className={css.screen}>
      <header className={css.topBar}>
        <Link href="/" className={css.home}>MARSFINDER</Link>
        <span className={css.place}>VALIDATE · REAL PHOTOS, KNOWN POSITIONS</span>
        <SiteNav />
      </header>

      <main className={css.main}>
        {report && (
          <p className={css.saved} data-testid="validation-banner">
            SAVED VALIDATION RUN · {report.source.run_utc.slice(0, 16).replace('T', ' ')} UTC · engine{' '}
            {report.source.engine?.version ?? '?'} · truth: NASA rover waypoints · no prior given to the engine
          </p>
        )}
        <section className={css.side} aria-label="Validation run">
          {load.status === 'loading' && <p className={css.note}>LOADING THE RUN…</p>}
          {load.status === 'failed' && <p className={css.alert} role="alert">{load.error}</p>}
          {report && (
            <>
              <Summary report={report} />
              <h2 className={css.sub}>CASES</h2>
              <ol className={css.cases} data-testid="validation-cases">
                {cases.map(c => <CaseRow key={c.pose} c={c} active={c.pose === selected} onPick={() => setSelected(c.pose === selected ? null : c.pose)} />)}
              </ol>
              <p className={css.note}>
                Photos: Perseverance Navcam raw images (NASA/JPL-Caltech). Truth: the rover&apos;s localized waypoint for each
                site/drive, used only to score. To run again: <code>py -3.10 backend/skyline/scripts/validate.py</code>.
              </p>
            </>
          )}
        </section>

        <div className={css.mapBox}>
          <JezeroMap overlays={OVERLAYS} onMap={setMap} />
          <ul className={css.key} aria-label="Map key">
            <li><i className={css.kTruth} /> TRUE</li>
            <li><i className={css.kFound} /> FOUND</li>
            <li><i className={css.kError} /> ERROR</li>
            {current && <li><i className={css.k68} /> 68 % / 95 %</li>}
          </ul>
        </div>
      </main>
    </div>
  );
}

function Summary({ report }: { report: ValidationReport }) {
  const s = report.summary;
  const n = s.cases;
  return (
    <dl className={css.summary} data-testid="validation-summary">
      <div><dt>CASES</dt><dd>{n}</dd></div>
      <div><dt>MEDIAN ERROR</dt><dd>{s.median_error_m === null ? '—' : `${Math.round(s.median_error_m)} m`}</dd></div>
      <div><dt>WITHIN 50 M</dt><dd>{s.within_50_m} of {n}</dd></div>
      <div><dt>WITHIN 100 M</dt><dd>{s.within_100_m} of {n}</dd></div>
      <div><dt>TRUTH INSIDE 68 %</dt><dd>{s.inside_68} of {n}</dd></div>
      <div><dt>TRUTH INSIDE 95 %</dt><dd>{s.inside_95} of {n}</dd></div>
      <div><dt>MEDIAN HEADING ERROR</dt><dd>{s.median_abs_heading_error_deg === null ? '—' : `${s.median_abs_heading_error_deg.toFixed(1)}°`}</dd></div>
    </dl>
  );
}

function CaseRow({ c, active, onPick }: { c: ValidationCase; active: boolean; onPick: () => void }) {
  const v = caseVerdict(c);
  const h = headingError(c);
  return (
    <li>
      <button type="button" className={css.caseRow} aria-pressed={active} onClick={onPick} data-testid="validation-case">
        <span className={css.caseName}>{c.name}</span>
        <span className={css[`tone-${v.tone}`]}>{v.text}</span>
        <span className={css.caseNums}>
          {Math.round(c.error_m)} m off · ±{Math.round(c.result.best.uncertainty_m)} / ±{Math.round(c.result.best.uncertainty_95_m)} m
          · heading {Number.isFinite(h) ? `${h.toFixed(1)}°` : '—'} · {c.photos.length} photo{c.photos.length === 1 ? '' : 's'}
          {c.skipped_photos?.length ? ` (+${c.skipped_photos.length} without sky)` : ''}
        </span>
        {c.skyline_at_truth?.far && (
          <span className={css.caseNums} title="Traced skyline minus the terrain's horizon at the true position and headings (terrain over 2 km away)">
            skyline vs terrain at the truth: {c.skyline_at_truth.far.median_deg >= 0 ? '+' : ''}{c.skyline_at_truth.far.median_deg.toFixed(2)}°
            {' '}± {c.skyline_at_truth.far.mad_deg.toFixed(2)}°
          </span>
        )}
      </button>
    </li>
  );
}

/** True (green) and found (white) per case, joined by the error; the selected case gets its circles. */
function useValidationLayers(map: L.Map | null, cases: ValidationCase[], current: ValidationCase | null,
  onPick: (pose: string) => void) {
  useEffect(() => {
    if (!map || cases.length === 0) return;
    let cancelled = false;
    let group: L.LayerGroup | null = null;
    void import('leaflet').then(({ default: Lf }) => {
      if (cancelled) return;
      const text = cssVar('--text', '#FFFFFF');
      const surface = cssVar('--surface', '#0A0A0B');
      const nominal = cssVar('--nominal', '#5BE37D');
      const caution = cssVar('--caution', '#FFB000');
      if (!map.getPane('validate')) map.createPane('validate').style.zIndex = '450';
      group = Lf.layerGroup().addTo(map);
      const ll = (p: { lat: number; lon: number }) => Lf.latLng(p.lat, p.lon);
      const shown = current ? [current] : cases;
      if (current) {
        for (const [r, dash] of [[current.result.best.uncertainty_95_m, '6 5'], [current.result.best.uncertainty_m, undefined]] as const) {
          Lf.polygon(circle(current.result.best, r).map(ll), { pane: 'validate', color: text, weight: 1.5, dashArray: dash, fill: false }).addTo(group);
        }
      }
      for (const c of shown) {
        Lf.polyline([ll(c.truth), ll(c.result.best)], { pane: 'validate', color: caution, weight: 2 }).addTo(group);
        Lf.circleMarker(ll(c.result.best), { pane: 'validate', radius: 5, color: surface, weight: 1.5, fillColor: text, fillOpacity: 1 })
          .bindTooltip(`${c.pose}: found, ${Math.round(c.error_m)} m off`).on('click', () => onPick(c.pose)).addTo(group);
        Lf.circleMarker(ll(c.truth), { pane: 'validate', radius: 5, color: surface, weight: 1.5, fillColor: nominal, fillOpacity: 1 })
          .bindTooltip(`${c.pose}: true`).on('click', () => onPick(c.pose)).addTo(group);
      }
      const pts = shown.flatMap(c => [ll(c.truth), ll(c.result.best)]);
      map.fitBounds(Lf.latLngBounds(pts), { padding: [60, 60], maxZoom: 18 });
    });
    return () => {
      cancelled = true;
      group?.remove();
    };
  }, [map, cases, current, onPick]);
}
