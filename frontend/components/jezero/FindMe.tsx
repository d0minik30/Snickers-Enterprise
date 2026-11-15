'use client';

import { useEffect, useRef, useState } from 'react';
import type L from 'leaflet';
import { DEMO_PHOTOS, DEMO_TRUTH, demoAnswerFor, sha256Hex } from '@/lib/locate/demo';
import { ENGINE_URL, EngineError, postLocate, postSkyline } from '@/lib/locate/engine';
import { circle, fovWedge } from '@/lib/locate/resultGeo';
import { CONTRACT_VERSION, type LocateRequest, type LocateResult } from '@/lib/locate/types';
import { distanceM } from '@/lib/nav/geo';
import { formatDistance } from '@/lib/nav/format';
import css from './findMe.module.css';

type Photo = { id: string; name: string; file: Blob; url: string };
type Answer = { request: LocateRequest; result: LocateResult; saved: boolean; truth: typeof DEMO_TRUTH | null };
type Step = 'pick' | 'working' | 'done' | 'error';

const fmtDist = (m: number) => { const d = formatDistance(m); return `${d.value} ${d.unit}`; };
const compass = (deg: number) =>
  ['north', 'north-east', 'east', 'south-east', 'south', 'south-west', 'west', 'north-west'][Math.round((((deg % 360) + 360) % 360) / 45) % 8];
const fmtLatLon = (lat: number, lon: number) =>
  `${Math.abs(lat).toFixed(4)}° ${lat >= 0 ? 'N' : 'S'}, ${Math.abs(lon).toFixed(4)}° ${lon >= 0 ? 'E' : 'W'}`;

let counter = 0;
const newId = () => `p${Date.now()}-${counter++}`;

/** "Where am I?": add photos of the horizon, get a pin on the map. The main feature of the site. */
export function FindMe({ map, open, onOpen }: { map: L.Map | null; open: boolean; onOpen: (open: boolean) => void }) {
  const [photos, setPhotos] = useState<Photo[]>([]);
  const [step, setStep] = useState<Step>('pick');
  const [progress, setProgress] = useState('');
  const [answer, setAnswer] = useState<Answer | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Object URLs live as long as their photos.
  const urls = useRef<string[]>([]);
  useEffect(() => {
    const live = new Set(photos.map(p => p.url));
    urls.current.filter(u => !live.has(u) && u.startsWith('blob:')).forEach(u => URL.revokeObjectURL(u));
    urls.current = [...live];
  }, [photos]);

  useAnswerOnMap(map, answer);

  const add = (files: FileList | null) => {
    const list = Array.from(files ?? []).filter(f => f.type.startsWith('image/'));
    setPhotos(ps => [...ps, ...list.map(f => ({ id: newId(), name: f.name, file: f, url: URL.createObjectURL(f) }))]);
    setStep('pick');
    setError(null);
  };

  const useExamples = async () => {
    setError(null);
    setStep('pick');
    try {
      const loaded = await Promise.all(DEMO_PHOTOS.map(async d => {
        const res = await fetch(d.url);
        if (!res.ok) throw new Error(`Could not load ${d.url}`);
        const file = await res.blob();
        return { id: newId(), name: `${d.id}.png`, file, url: URL.createObjectURL(file) };
      }));
      setPhotos(loaded);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setStep('error');
    }
  };

  const clear = () => {
    setPhotos([]);
    setAnswer(null);
    setError(null);
    setStep('pick');
  };

  const find = async () => {
    setStep('working');
    setError(null);
    setAnswer(null);
    try {
      setProgress('Looking at the photos…');
      const hashed = await Promise.all(photos.map(async p => ({ sha256: await sha256Hex(p.file), name: p.name })));
      const saved = demoAnswerFor(hashed);
      if (saved) {
        setAnswer({ request: saved.request, result: saved.result, saved: true, truth: DEMO_TRUTH });
        setStep('done');
        return;
      }
      // Any other photo goes to the live engine.
      const traced = [];
      for (const [i, p] of photos.entries()) {
        setProgress(`Reading the skyline in photo ${i + 1} of ${photos.length}…`);
        traced.push(await postSkyline(p.file, p.name, {}, null));
      }
      setProgress('Comparing the skyline with the Mars terrain…');
      const request: LocateRequest = {
        contract_version: CONTRACT_VERSION,
        photos: traced.map((t, i) => ({ ...t.photo, id: `photo_${i + 1}` })),
        options: { top_k: 5, include_likelihood_grid: false },
      };
      const result = await postLocate(request);
      setAnswer({ request, result, saved: false, truth: null });
      setStep('done');
    } catch (e) {
      const offline = e instanceof EngineError && (e.kind === 'unreachable' || e.status === 404);
      setError(offline
        ? `The live engine isn't running (${ENGINE_URL.replace(/^https?:\/\//, '')}), so only the example photos work right now.`
        : e instanceof Error ? e.message : String(e));
      setStep('error');
    }
  };

  if (!open) {
    return (
      <button type="button" className={css.launch} onClick={() => onOpen(true)} data-testid="findme-open">
        <CameraIcon />
        <span>
          <span className={css.launchTitle}>WHERE AM I?</span>
          <span className={css.launchText}>Upload a photo of the horizon</span>
        </span>
      </button>
    );
  }

  const r = answer?.result;
  return (
    <section className={css.panel} aria-label="Find my position from a photo" data-testid="findme">
      <header className={css.head}>
        <h2 className={css.title}>WHERE AM I?</h2>
        <button type="button" className={css.close} onClick={() => onOpen(false)} aria-label="Close">✕</button>
      </header>

      {step !== 'done' && (
        <>
          <p className={css.lead}>There is no GPS on Mars. Take photos of the horizon and we match the skyline to the terrain.</p>
          <div className={css.buttons}>
            <label className={css.primary} data-testid="findme-upload">
              <CameraIcon /> UPLOAD PHOTOS
              <input type="file" accept="image/*" multiple className={css.srOnly}
                onChange={e => { add(e.target.files); e.target.value = ''; }} />
            </label>
            <button type="button" className={css.secondary} onClick={useExamples} data-testid="findme-examples">
              USE EXAMPLE PHOTOS
            </button>
          </div>
          <p className={css.hint}>Example: 6 real photos from the Perseverance rover, sols 17–18.</p>
        </>
      )}

      {photos.length > 0 && (
        <ul className={css.thumbs} aria-label="Photos">
          {photos.map(p => (
            <li key={p.id}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={p.url} alt={p.name} />
              {step === 'pick' && (
                <button type="button" aria-label={`Remove ${p.name}`} onClick={() => setPhotos(ps => ps.filter(x => x.id !== p.id))}>✕</button>
              )}
            </li>
          ))}
        </ul>
      )}

      {(step === 'pick' || step === 'error') && photos.length > 0 && (
        <button type="button" className={css.go} onClick={find} data-testid="findme-go">FIND MY POSITION →</button>
      )}

      {step === 'working' && <p className={css.working} role="status"><span className={css.spinner} aria-hidden />{progress}</p>}
      {step === 'error' && error && <p className={css.error} role="alert">{error}</p>}

      {step === 'done' && r && answer && (
        <div className={css.result} data-testid="findme-result" data-status={r.status}>
          <p className={`${css.verdict} ${r.status === 'ok' ? css.ok : css.caution}`}>
            {r.status === 'ok' ? 'FOUND YOU' : r.status === 'ambiguous' ? 'NOT SURE: SEVERAL PLACES FIT' : 'NO GOOD MATCH'}
          </p>
          <dl className={css.facts}>
            <div><dt>You are here</dt><dd>{fmtLatLon(r.best.lat, r.best.lon)}</dd></div>
            <div><dt>Accurate to</dt><dd>± {fmtDist(r.best.uncertainty_95_m)}</dd></div>
            <div><dt>First photo faces</dt><dd>{compass(r.best.heading_deg)} ({Math.round(r.best.heading_deg)}°)</dd></div>
            {answer.truth && (
              <div className={css.check}>
                <dt>Real position (NASA)</dt>
                <dd>{fmtDist(distanceM(r.best, answer.truth))} away</dd>
              </div>
            )}
          </dl>
          {answer.saved && (
            <p className={css.saved}>Saved answer from our engine for these {answer.request.photos.length} example photos.</p>
          )}
          <button type="button" className={css.secondary} onClick={clear}>TRY OTHER PHOTOS</button>
        </div>
      )}
    </section>
  );
}

/** Pin, accuracy circle, what each photo saw, and the real position when known; the map flies there. */
function useAnswerOnMap(map: L.Map | null, answer: Answer | null) {
  useEffect(() => {
    if (!map || !answer) return;
    let group: L.LayerGroup | null = null;
    let cancelled = false;
    void import('leaflet').then(({ default: Lf }) => {
      if (cancelled) return;
      const r = answer.result;
      const route = getComputedStyle(document.documentElement).getPropertyValue('--route').trim() || '#FF5CE1';
      const text = getComputedStyle(document.documentElement).getPropertyValue('--text').trim() || '#FFFFFF';
      const ll = (p: { lat: number; lon: number }) => [p.lat, p.lon] as [number, number];
      group = Lf.layerGroup().addTo(map);

      for (const p of r.photos) {
        const hfov = answer.request.photos.find(q => q.id === p.id)?.camera.hfov_deg ?? 60;
        Lf.polygon(fovWedge(r.best, p.heading_deg, hfov, 250).map(ll), {
          color: text, weight: 1, opacity: 0.5, fillColor: text, fillOpacity: 0.04, interactive: false,
        }).addTo(group);
      }
      const radius = Math.max(r.best.uncertainty_95_m, 15);
      Lf.polygon(circle(r.best, radius).map(ll), { color: route, weight: 2, fillColor: route, fillOpacity: 0.2, interactive: false }).addTo(group);
      if (answer.truth) {
        Lf.circleMarker(ll(answer.truth), { radius: 6, color: '#0A0A0B', weight: 2, fillColor: text, fillOpacity: 1 })
          .bindTooltip('REAL POSITION (NASA)', { permanent: true, direction: 'left', offset: [-8, 0], className: 'findme-label' })
          .addTo(group);
      }
      Lf.circleMarker(ll(r.best), { radius: 9, color: '#0A0A0B', weight: 3, fillColor: route, fillOpacity: 1 })
        .bindTooltip('YOU ARE HERE', { permanent: true, direction: 'top', offset: [0, -10], className: 'findme-label findme-here' })
        .addTo(group);

      const pts = [ll(r.best), ...circle(r.best, Math.max(radius * 3, 150)).map(ll)];
      if (answer.truth) pts.push(ll(answer.truth));
      map.flyToBounds(Lf.latLngBounds(pts), { padding: [60, 60], duration: 2.5, maxZoom: 18 });
    });
    return () => {
      cancelled = true;
      group?.remove();
    };
  }, [map, answer]);
}

function CameraIcon() {
  return (
    <svg width="22" height="18" viewBox="0 0 22 18" aria-hidden="true">
      <path d="M2 4h4l2-3h6l2 3h4v13H2z" fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" />
      <circle cx="11" cy="10" r="3.5" fill="none" stroke="currentColor" strokeWidth="2" />
    </svg>
  );
}
