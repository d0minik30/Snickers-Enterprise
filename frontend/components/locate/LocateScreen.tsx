'use client';

import Link from 'next/link';
import { useCallback, useEffect, useReducer, useRef, useState } from 'react';
import { CameraCapture, type Captured } from '@/components/locate/CameraCapture';
import { CameraPanel, LocateBar, PhotoList } from '@/components/locate/Panels';
import { SkylineEditor } from '@/components/locate/SkylineEditor';
import { ENGINE_URL, EngineError, postConvert, postLocate, postSkyline } from '@/lib/locate/engine';
import { hfovFor } from '@/lib/locate/presets';
import { buildLocateRequest, emptySession, locateBlocker, reduce, specFor, type PhotoEntry } from '@/lib/locate/session';
import css from './locate.module.css';

const CONVERT_DELAY_MS = 400; // wait for the user to stop dragging before recomputing angles

const message = (e: unknown) => (e instanceof EngineError || e instanceof Error ? e.message : String(e));

let counter = 0;
const newId = () => (typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `p${Date.now()}-${counter++}`);

export default function LocateScreen() {
  const [session, dispatch] = useReducer(reduce, emptySession);
  const [capturing, setCapturing] = useState(false);
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
    dispatch({ type: 'trace-start', id: p.id });
    postSkyline(p.file, p.name, specFor(p), p.label)
      .then(response => dispatch({ type: 'trace-done', id: p.id, response }))
      .catch(e => dispatch({ type: 'trace-failed', id: p.id, error: message(e) }));
  }, [busyTracing, nextQueued]);

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
    dispatch({ type: 'locate-start' });
    postLocate(request)
      .then(result => dispatch({ type: 'locate-done', result, at: new Date().toISOString() }))
      .catch(e => dispatch({ type: 'locate-failed', error: message(e) }));
  }, []);

  const photo = session.photos.find(p => p.id === session.selected) ?? null;

  return (
    <div className={css.screen}>
      <header className={css.topBar}>
        <Link href="/" className={css.home}>MARS MAP</Link>
        <span className={css.place}>LOCATE · WHERE WAS THIS PHOTO TAKEN?</span>
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
            <p className={css.note}>A few photos of the skyline in different directions work best.</p>
          </section>
          <PhotoList session={session} dispatch={dispatch} />
        </aside>

        {photo && <div className={css.camera}><CameraPanel photo={photo} dispatch={dispatch} /></div>}

        <div className={css.work}>
          {photo ? <PhotoView photo={photo} dispatch={dispatch} /> : (
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
      {(photo.status === 'queued' || photo.status === 'tracing') && <p className={css.busy}>TRACING THE SKYLINE…</p>}
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
