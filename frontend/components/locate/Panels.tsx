'use client';

import { useId, useState, type Dispatch } from 'react';
import { trustedShare } from '@/lib/locate/edit';
import { PRESETS, type CameraChoice } from '@/lib/locate/presets';
import type { Action, PhotoEntry, Session } from '@/lib/locate/session';
import css from './locate.module.css';

// ------------------------------------------------------------------ photo list

export function photoStatus(p: PhotoEntry): { text: string; tone: 'busy' | 'bad' | 'ok' | 'weak' } {
  if (p.status === 'queued' || p.status === 'tracing') return { text: 'TRACING…', tone: 'busy' };
  if (p.status === 'error') return { text: 'ERROR', tone: 'bad' };
  if (p.angles === 'stale' || p.angles === 'updating') return { text: 'UPDATING…', tone: 'busy' };
  if (p.angles === 'failed') return { text: 'ANGLES FAILED', tone: 'bad' };
  const share = p.trace ? trustedShare(p.trace) : 0;
  return { text: `${Math.round(share * 100)} % USED`, tone: share >= 0.3 ? 'ok' : 'weak' };
}

export function PhotoList({ session, dispatch }: { session: Session; dispatch: Dispatch<Action> }) {
  if (session.photos.length === 0) return null;
  return (
    <ul className={css.photoList} aria-label="Photos">
      {session.photos.map((p, k) => {
        const st = photoStatus(p);
        return (
          <li key={p.id} className={css.photoItem} aria-current={session.selected === p.id}>
            <button type="button" className={css.photoPick} onClick={() => dispatch({ type: 'select', id: p.id })}
              data-testid="photo-item" data-status={p.status}>
              {/* eslint-disable-next-line @next/next/no-img-element -- local object URL */}
              <img src={p.url} alt="" className={css.thumb} />
              <span className={css.photoMeta}>
                <span className={css.photoName}>{k + 1}. {p.name}</span>
                <span className={css[`status-${st.tone}`]}>{st.text}</span>
              </span>
            </button>
            <button type="button" className={css.remove} aria-label={`Remove ${p.name}`}
              onClick={() => dispatch({ type: 'remove', id: p.id })}>×</button>
          </li>
        );
      })}
    </ul>
  );
}

// ------------------------------------------------------------------ camera panel

const choiceValue = (c: CameraChoice) => (c.kind === 'preset' ? `preset:${c.id}` : c.kind);

function parseChoice(value: string, current: CameraChoice): CameraChoice {
  if (value.startsWith('preset:')) return { kind: 'preset', id: value.slice(7) };
  if (value === 'fov') return { kind: 'fov', hfovDeg: current.kind === 'fov' ? current.hfovDeg : 65 };
  if (value === 'label') return { kind: 'label' };
  return { kind: 'auto' };
}

/** "2026-11-15T10:04:05Z" <-> the value of a datetime-local input, read as UTC. */
const toInput = (iso: string) => iso.replace(/Z$/, '').slice(0, 19);
const fromInput = (v: string) => (v ? `${v.length === 16 ? `${v}:00` : v}Z` : '');

export function CameraPanel({ photo, dispatch }: { photo: PhotoEntry; dispatch: Dispatch<Action> }) {
  const ids = useId();
  const [labelError, setLabelError] = useState<string | null>(null);
  const cam = photo.photo?.camera;
  const diag = photo.diagnostics;
  const fromLabel = photo.label !== null;
  const set = (tilt: Partial<PhotoEntry['tilt']>) => dispatch({ type: 'tilt', id: photo.id, tilt: { ...photo.tilt, ...tilt } });

  const readLabel = async (file: File | undefined) => {
    if (!file) return;
    try {
      const parsed: unknown = JSON.parse(await file.text());
      if (typeof parsed !== 'object' || parsed === null) throw new Error('not an object');
      setLabelError(null);
      dispatch({ type: 'label', id: photo.id, label: parsed, labelName: file.name });
    } catch {
      setLabelError(`${file.name} is not a JSON label.`);
    }
  };

  return (
    <section className={css.panel} aria-label="Camera">
      <h2 className={css.panelTitle}>CAMERA</h2>
      <label className={css.field} htmlFor={`${ids}-cam`}>
        <span className={css.fieldLabel}>LENS</span>
        <select id={`${ids}-cam`} className={css.select} value={choiceValue(photo.camera)} data-testid="camera-select"
          onChange={e => dispatch({ type: 'camera', id: photo.id, camera: parseChoice(e.target.value, photo.camera) })}>
          <option value="auto">From the photo (EXIF)</option>
          {(['Phone', 'Perseverance'] as const).map(g => (
            <optgroup key={g} label={g}>
              {PRESETS.filter(p => p.group === g).map(p => <option key={p.id} value={`preset:${p.id}`}>{p.label}</option>)}
            </optgroup>
          ))}
          <option value="fov">Field of view I know</option>
          {fromLabel && <option value="label">Perseverance label</option>}
        </select>
      </label>
      {photo.camera.kind === 'fov' && (
        <label className={css.field} htmlFor={`${ids}-fov`}>
          <span className={css.fieldLabel}>HORIZONTAL FIELD OF VIEW</span>
          <span className={css.inputRow}>
            <input id={`${ids}-fov`} className={css.number} type="number" min={1} max={170} step={0.1}
              value={photo.camera.hfovDeg}
              onChange={e => {
                const v = Number(e.target.value);
                if (Number.isFinite(v) && v >= 1 && v <= 170) dispatch({ type: 'camera', id: photo.id, camera: { kind: 'fov', hfovDeg: v } });
              }} />
            <span className={css.unit}>°</span>
          </span>
        </label>
      )}
      {cam && diag && (
        <p className={css.note} data-testid="camera-in-use">
          In use: {cam.hfov_deg.toFixed(1)}° × {cam.vfov_deg.toFixed(1)}°, {diag.camera_model === 'cahvore' ? 'CAHVORE model' : 'pinhole'}
          {' '}({diag.camera_source})
        </p>
      )}

      <h2 className={css.panelTitle}>TILT</h2>
      {fromLabel ? (
        <p className={css.note}>From the Perseverance label: only the direction of “down” is read, never the heading.</p>
      ) : (
        <>
          <div className={css.segmented} role="radiogroup" aria-label="Where the tilt comes from">
            {([['assumed', 'ASSUME LEVEL'], ['manual', 'SET BY HAND'], ['sensor', 'TILT SENSOR']] as const).map(([v, label]) => (
              <button key={v} type="button" role="radio" aria-checked={photo.tilt.source === v} className={css.segment}
                disabled={v === 'sensor' && photo.tilt.source !== 'sensor'}
                title={v === 'sensor' ? 'Recorded when the photo is taken with TAKE PHOTO' : undefined}
                onClick={() => set({ source: v })}>{label}</button>
            ))}
          </div>
          {photo.tilt.source === 'manual' && (
            <>
              {([['pitchDeg', 'PITCH', 'Camera pointing up +'], ['rollDeg', 'ROLL', 'Right side down +']] as const).map(([key, label, hint]) => (
                <label key={key} className={css.field}>
                  <span className={css.fieldLabel}>{label} <span className={css.fieldHint}>{hint}</span></span>
                  <span className={css.inputRow}>
                    <input type="range" min={-30} max={30} step={0.1} className={css.range} value={photo.tilt[key]}
                      data-testid={`tilt-${key}`}
                      onChange={e => set({ [key]: Number(e.target.value) })} />
                    <span className={css.rangeValue}>{photo.tilt[key].toFixed(1)}°</span>
                  </span>
                </label>
              ))}
              <p className={css.note}>Line up the dashed LEVEL line with a flat horizon far away.</p>
            </>
          )}
          {photo.tilt.source === 'sensor' && (
            <p className={css.note}>
              From the phone at the moment of capture: pitch {photo.tilt.pitchDeg.toFixed(1)}°, roll {photo.tilt.rollDeg.toFixed(1)}°.
            </p>
          )}
          {photo.tilt.source === 'assumed' && <p className={css.note}>Treated as level. Set it by hand if the camera was tilted.</p>}
        </>
      )}

      <h2 className={css.panelTitle}>TIME</h2>
      <label className={css.field} htmlFor={`${ids}-time`}>
        <span className={css.fieldLabel}>TAKEN AT (UTC) <span className={css.fieldHint}>Lets the sun fix the heading</span></span>
        <input id={`${ids}-time`} className={css.input} type="datetime-local" step={1} value={toInput(photo.timeUtc)}
          onChange={e => dispatch({ type: 'time', id: photo.id, timeUtc: fromInput(e.target.value) })} />
      </label>
      {!photo.timeUtc && photo.photo?.time_utc && (
        <p className={css.note}>In use: {photo.photo.time_utc.slice(0, 19).replace('T', ' ')} UTC, from the {fromLabel ? 'label' : 'photo'}.</p>
      )}

      <h2 className={css.panelTitle}>PERSEVERANCE LABEL</h2>
      {photo.labelName ? (
        <p className={css.inputRow}>
          <span className={`${css.note} ${css.ellipsis}`} title={photo.labelName}>{photo.labelName}</span>
          <button type="button" className={css.smallButton} onClick={() => dispatch({ type: 'label', id: photo.id, label: null, labelName: null })}>REMOVE</button>
        </p>
      ) : (
        <label className={css.fileButton}>
          ADD LABEL (.JSON)
          <input type="file" accept=".json,application/json" className={css.srOnly} onChange={e => readLabel(e.target.files?.[0])} />
        </label>
      )}
      {labelError && <p className={css['status-bad']} role="alert">{labelError}</p>}
    </section>
  );
}

// ------------------------------------------------------------------ send to the engine

export function LocateBar({ session, blocker, onLocate }: { session: Session; blocker: string | null; onLocate: () => void }) {
  const { locate } = session;
  const n = session.photos.filter(p => p.status === 'traced').length;
  return (
    <section className={css.locateBar} aria-label="Locate" aria-live="polite">
      <div className={css.locateText}>
        {locate.status === 'sending' && <span className={css['status-busy']}>ASKING THE ENGINE…</span>}
        {locate.status === 'failed' && <span className={css['status-bad']} data-testid="locate-error">{locate.error}</span>}
        {locate.status === 'answered' && (
          <span className={css['status-ok']} data-testid="locate-answer">
            Engine answered at {locate.at.slice(11, 19)} UTC: see RESULT.
          </span>
        )}
        {locate.status === 'idle' && <span className={css.note}>{blocker ?? `${n} photo${n === 1 ? '' : 's'} ready.`}</span>}
      </div>
      <button type="button" className={css.locateButton} disabled={blocker !== null || locate.status === 'sending'}
        onClick={onLocate} data-testid="locate-button">
        LOCATE
      </button>
    </section>
  );
}
