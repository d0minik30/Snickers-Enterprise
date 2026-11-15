'use client';

import Link from 'next/link';
import { SiteNav } from '@/components/shared/SiteNav';
import { useCallback, useEffect, useReducer, useRef, useState } from 'react';
import { CameraCapture, type Captured } from '@/components/locate/CameraCapture';
import { CameraPanel, LocateBar, PhotoList } from '@/components/locate/Panels';
import { ResultView } from '@/components/locate/ResultView';
import { SkylineEditor } from '@/components/locate/SkylineEditor';
import { ENGINE_URL, EngineError, postConvert, postLocate, postSkyline } from '@/lib/locate/engine';
import { hfovFor } from '@/lib/locate/presets';
import { buildLocateRequest, emptySession, locateBlocker, reduce, specFor, type PhotoEntry } from '@/lib/locate/session';
import { isLocateResult, type LocateRequest, type LocateResult } from '@/lib/locate/types';
import css from './locate.module.css';

const CONVERT_DELAY_MS = 400; // wait for the user to stop dragging before recomputing angles

const message = (e: unknown) => (e instanceof EngineError || e instanceof Error ? e.message : String(e));

type Saved = { request: LocateRequest; result: LocateResult; note: string };

/**
 * /locate/?result=saved shows a saved, real answer of the engine (made by
 * backend/skyline/scripts/engine_result.py), clearly marked, for working on the result view while the
 * engine server is not running. Loaded only on request, and checked like a live answer.
 */
async function loadSaved(prefix: string): Promise<Saved | null> {
  const m = await import('@/lib/locate/fixtures/engine-pose3-770.json');
  const file = m.default as unknown as { source: { photos: string[]; pose: string; sol: number; run_utc: string }; request: LocateRequest; result: unknown };
  if (!isLocateResult(file.result)) return null;
  const { photos, pose, sol, run_utc } = file.source;
  return {
    request: file.request,
    result: file.result,
    note: `${prefix ? `${prefix} · ` : ''}SAVED ENGINE RESPONSE · pose ${pose}, sol ${sol}, ${photos.length} Perseverance Navcam photos, run ${run_utc.slice(0, 10)}. Not a live request.`,
  };
}

function useSavedResult(): Saved | null {
  const [saved, setSaved] = useState<Saved | null>(null);
  useEffect(() => {
    if (new URLSearchParams(window.location.search).get('result') !== 'saved') return;
    void loadSaved('').then(setSaved);
  }, []);
  return saved;
}

/** Only an engine that can't be reached or doesn't answer falls back to the saved answer; real errors (422, 503) are shown. */
const isOffline = (e: unknown) => e instanceof EngineError && (e.kind === 'unreachable' || e.kind === 'timeout');

let counter = 0;
const newId = () => (typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `p${Date.now()}-${counter++}`);

/** Sol 20 Perseverance Navcam photos (pose 3/770, NASA/JPL-Caltech) with their labels, in public/demo-photos/. */
const EXAMPLE_PHOTOS = [
  'NLF_0020_0668728525_175ECM_N0030770NCAM03020_01_295J',
  'NLF_0020_0668728577_477ECM_N0030770NCAM02020_01_295J',
  'NLF_0020_0668728666_168ECM_N0030770NCAM02020_01_295J',
];

export default function LocateScreen() {
  const [session, dispatch] = useReducer(reduce, emptySession);
  const [capturing, setCapturing] = useState(false);
  const [tab, setTab] = useState<'photos' | 'result'>('photos');
  const saved = useSavedResult();
  const [offline, setOffline] = useState<Saved | null>(null);
  // The engine (tracing or locating) can't be reached: show the saved answer, clearly marked.
  const showOffline = useCallback(() => {
    void loadSaved(`OFFLINE DEMO · the engine at ${ENGINE_URL.replace(/^https?:\/\//, '')} did not answer, so this is NOT your photos' result`)
      .then(s => { if (s) { setOffline(s); setTab('result'); } });
  }, []);
  const latest = useRef(session);
  useEffect(() => {
    latest.current = session;
  });
  const started = useRef(new Set<string>()); // trace requests already sent (effects can run twice in dev)

  // ---------------------------------------------------------------- tracing: one photo at a time
  const busyTracing = session.photos.some(p => p.status === 'tracing');
  const nextQueued = session.photos.find(p => p.status === 'queued');
  useEffect(() => {
    if (busyTracing || !nextQueued) return;
    const p = nextQueued;
    const key = `${p.id}:${p.rev}`; // a retry after a camera change has a new rev
    if (started.current.has(key)) return;
    started.current.add(key);
    dispatch({ type: 'trace-start', id: p.id, rev: p.rev });
    postSkyline(p.file, p.name, specFor(p), p.label)
      .then(response => dispatch({ type: 'trace-done', id: p.id, rev: p.rev, response }))
      .catch(e => {
        dispatch({ type: 'trace-failed', id: p.id, rev: p.rev, error: message(e) });
        if (isOffline(e)) showOffline();
      });
  }, [busyTracing, nextQueued, showOffline]);

  // ---------------------------------------------------------------- angles for edits and camera changes
  const staleKey = session.photos.filter(p => p.angles === 'stale').map(p => `${p.id}:${p.rev}`).join(',');
  useEffect(() => {
    if (!staleKey) return;
    const timer = setTimeout(() => {
      for (const p of latest.current.photos) {
        if (p.angles !== 'stale' || !p.trace) continue;
        const { id, rev, trace } = p;
        dispatch({ type: 'convert-start', id });
        postConvert(specFor(p), p.label, trace)
          .then(r => dispatch({ type: 'convert-done', id, photo: r.photo, diagnostics: r.diagnostics, rev }))
          .catch(e => dispatch({ type: 'convert-failed', id, error: message(e) }));
      }
    }, CONVERT_DELAY_MS);
    return () => clearTimeout(timer);
  }, [staleKey]);

  // ---------------------------------------------------------------- object URLs live as long as their photos
  const urls = useRef(new Set<string>());
  useEffect(() => {
    const live = new Set(session.photos.map(p => p.url));
    for (const u of urls.current) if (!live.has(u)) URL.revokeObjectURL(u);
    urls.current = live;
  }, [session.photos]);
  useEffect(() => () => urls.current.forEach(u => URL.revokeObjectURL(u)), []);

  const addFiles = (files: FileList | null) => {
    for (const file of Array.from(files ?? [])) {
      if (!file.type.startsWith('image/')) continue;
      dispatch({ type: 'add', photo: { id: newId(), name: file.name, file, url: URL.createObjectURL(file) } });
    }
  };

  const [exampleError, setExampleError] = useState<string | null>(null);
  /** Loads the example photos with their labels; they trace at once and LOCATE sends a normal live request. */
  const addExamples = async () => {
    setExampleError(null);
    try {
      const loaded = await Promise.all(EXAMPLE_PHOTOS.map(async name => {
        const [img, lbl] = await Promise.all([fetch(`/demo-photos/${name}.png`), fetch(`/demo-photos/${name}.label.json`)]);
        if (!img.ok || !lbl.ok) throw new Error(name);
        return { name, blob: await img.blob(), label: (await lbl.json()) as unknown };
      }));
      for (const { name, blob, label } of loaded) {
        const id = newId();
        dispatch({ type: 'add', photo: { id, name: `${name}.png`, file: blob, url: URL.createObjectURL(blob) } });
        dispatch({ type: 'label', id, label, labelName: `${name}.label.json` });
      }
    } catch {
      setExampleError('Could not load the example photos.');
    }
  };

  const addCaptured = (c: Captured) => {
    setCapturing(false);
    const stamp = c.timeUtc.slice(11, 19).replaceAll(':', '');
    dispatch({
      type: 'add',
      photo: {
        id: newId(), name: `photo-${stamp}.jpg`, file: c.blob, url: URL.createObjectURL(c.blob),
        camera: { kind: 'preset', id: 'generic-phone' }, timeUtc: c.timeUtc,
        tilt: c.tilt ? { source: 'sensor', ...c.tilt } : { source: 'assumed', pitchDeg: 0, rollDeg: 0 },
      },
    });
  };

  const blocker = locateBlocker(session);
  const locate = useCallback(() => {
    const request = buildLocateRequest(latest.current);
    dispatch({ type: 'locate-start', request });
    setOffline(null);
    postLocate(request)
      .then(result => dispatch({ type: 'locate-done', result, at: new Date().toISOString() }))
      .catch(e => {
        dispatch({ type: 'locate-failed', error: message(e) });
        if (isOffline(e)) showOffline();
      });
  }, [showOffline]);

  const photo = session.photos.find(p => p.id === session.selected) ?? null;
  const answer = session.locate.status === 'answered' ? session.locate : null;
  // A new answer opens on the result; the user can switch back to the photos.
  const answerAt = answer?.at;
  useEffect(() => {
    if (answerAt) setTab('result');
  }, [answerAt]);
  const fallback = answer ? null : offline ?? saved;
  const shown = answer ?? (fallback ? { request: fallback.request, result: fallback.result } : null);
  const showResult = shown !== null && (tab === 'result' || (saved !== null && !answer && session.photos.length === 0));

  return (
    <div className={css.screen}>
      <header className={css.topBar}>
        <Link href="/" className={css.home}>MARSFINDER</Link>
        <span className={css.place}>LOCATE · WHERE WAS THIS PHOTO TAKEN?</span>
        <SiteNav />
        <span className={css.spacer} />
        <span className={css.engine} title="Set NEXT_PUBLIC_ENGINE_URL when building">ENGINE {ENGINE_URL.replace(/^https?:\/\//, '')}</span>
      </header>

      <main className={css.main}>
        <aside className={css.side}>
          <section className={css.panel} aria-label="Add photos">
            <h2 className={css.panelTitle}>PHOTOS</h2>
            <div className={css.addRow}>
              <label className={css.fileButton} data-testid="add-photos">
                ADD PHOTOS
                <input type="file" accept="image/*" multiple className={css.srOnly}
                  onChange={e => { addFiles(e.target.files); e.target.value = ''; }} />
              </label>
              <button type="button" className={css.fileButton} onClick={() => setCapturing(true)}>TAKE PHOTO</button>
            </div>
            <button type="button" className={css.fileButton} data-testid="use-examples" onClick={() => void addExamples()}>
              USE EXAMPLE PHOTOS
            </button>
            {exampleError && <p className={css['status-bad']} role="alert">{exampleError}</p>}
            <p className={css.note}>A few photos of the skyline in different directions work best.</p>
          </section>
          <PhotoList session={session} dispatch={dispatch} />
        </aside>

        {photo && <div className={css.camera}><CameraPanel photo={photo} dispatch={dispatch} /></div>}

        <div className={css.work}>
          {shown && (
            <div className={css.tabs} role="tablist" aria-label="View">
              <button type="button" role="tab" className={css.tab} aria-selected={!showResult} onClick={() => setTab('photos')}>PHOTOS</button>
              <button type="button" role="tab" className={css.tab} aria-selected={showResult} onClick={() => setTab('result')}
                data-testid="tab-result">RESULT</button>
            </div>
          )}
          {showResult && shown ? (
            <ResultView result={shown.result} request={shown.request} savedNote={fallback?.note ?? null} />
          ) : photo ? <PhotoView photo={photo} dispatch={dispatch} /> : (
            <div className={css.empty}>
              <p className={css.emptyTitle}>NO PHOTOS YET</p>
              <p className={css.note}>Add photos of the horizon. The skyline is traced for you; fix it if it is wrong, then press LOCATE.</p>
            </div>
          )}
        </div>
      </main>

      <LocateBar session={session} blocker={blocker} onLocate={locate} />
      {capturing && <CameraCapture onCapture={addCaptured} onClose={() => setCapturing(false)} />}
    </div>
  );
}

/** The skyline API's messages are written for developers; say what the user can do instead. */
function friendlyError(error: string): string {
  if (error.includes('no field of view')) {
    return 'This photo does not say which camera took it. Choose the LENS under CAMERA, or add the Perseverance label.';
  }
  return error;
}

function PhotoView({ photo, dispatch }: { photo: PhotoEntry; dispatch: React.Dispatch<Parameters<typeof reduce>[1]> }) {
  const trace = photo.trace;
  // The level guide is for levelling by hand, with a pinhole camera whose field of view we know.
  const hfov = photo.diagnostics?.camera_model === 'pinhole' && photo.photo
    ? photo.photo.camera.hfov_deg
    : trace ? hfovFor(photo.camera, trace.width, trace.height) : null;
  const guide = trace && hfov && photo.label === null && photo.tilt.source === 'manual'
    ? { hfovDeg: hfov, pitchDeg: photo.tilt.pitchDeg, rollDeg: photo.tilt.rollDeg }
    : null;

  return (
    <>
      {photo.status === 'error' && (
        <p className={css.alert} role="alert" data-testid="photo-error">{friendlyError(photo.error ?? '')}</p>
      )}
      {(photo.status === 'queued' || photo.status === 'tracing') && <p className={css.busy}>SKYLINE EXTRACTION…</p>}
      {photo.angles === 'failed' && <p className={css.alert} role="alert">Angles not updated: {photo.anglesError}</p>}
      <SkylineEditor
        url={photo.url}
        name={photo.name}
        trace={trace}
        original={photo.response?.trace ?? null}
        guide={guide}
        canUndo={photo.history.length > 0}
        onEdit={t => dispatch({ type: 'edit', id: photo.id, trace: t })}
        onUndo={() => dispatch({ type: 'undo', id: photo.id })}
        onReset={() => dispatch({ type: 'reset-edits', id: photo.id })}
      />
    </>
  );
}
