// The Locate screen's state: the photos, what we know about each camera, the traced and edited
// skylines, and the request to the engine. A pure reducer; the screen runs the network calls that the
// statuses ask for ('queued' -> trace it, angles 'stale' -> convert it).

import type { CameraChoice } from '@/lib/locate/presets';
import type { CameraSpec, Skyline, SkylineResponse, Trace } from '@/lib/locate/types';

export type Tilt = { source: 'assumed' | 'manual' | 'sensor'; pitchDeg: number; rollDeg: number };

export type PhotoEntry = {
  id: string;
  name: string;
  file: Blob;
  url: string; // object URL for display
  camera: CameraChoice;
  tilt: Tilt;
  timeUtc: string; // ISO 8601 or ''
  label: unknown | null; // Perseverance raw-image record
  labelName: string | null;
  status: 'queued' | 'tracing' | 'traced' | 'error';
  error: string | null;
  response: SkylineResponse | null; // as first traced (the original line, for restore)
  trace: Trace | null; // as edited now
  history: Trace[]; // for undo
  skyline: Skyline | null; // angles for the current trace and camera info
  angles: 'fresh' | 'stale' | 'updating' | 'failed';
  anglesError: string | null;
  rev: number; // bumped by every change that makes the angles stale
};

export type LocateRequest =
  | { status: 'idle' }
  | { status: 'sending' }
  | { status: 'answered'; answer: unknown; at: string }
  | { status: 'failed'; error: string };

export type Session = { photos: PhotoEntry[]; selected: string | null; locate: LocateRequest };

export type Action =
  | { type: 'add'; photo: Pick<PhotoEntry, 'id' | 'name' | 'file' | 'url'> & Partial<Pick<PhotoEntry, 'tilt' | 'timeUtc' | 'camera'>> }
  | { type: 'remove'; id: string }
  | { type: 'select'; id: string }
  | { type: 'camera'; id: string; camera: CameraChoice }
  | { type: 'tilt'; id: string; tilt: Tilt }
  | { type: 'time'; id: string; timeUtc: string }
  | { type: 'label'; id: string; label: unknown | null; labelName: string | null }
  | { type: 'trace-start'; id: string }
  | { type: 'trace-done'; id: string; response: SkylineResponse }
  | { type: 'trace-failed'; id: string; error: string }
  | { type: 'edit'; id: string; trace: Trace }
  | { type: 'undo'; id: string }
  | { type: 'reset-edits'; id: string }
  | { type: 'convert-start'; id: string }
  | { type: 'convert-done'; id: string; skyline: Skyline; rev: number }
  | { type: 'convert-failed'; id: string; error: string }
  | { type: 'locate-start' }
  | { type: 'locate-done'; answer: unknown; at: string }
  | { type: 'locate-failed'; error: string };

export const MAX_UNDO = 50;

export const emptySession: Session = { photos: [], selected: null, locate: { status: 'idle' } };

export function newPhoto(p: Action & { type: 'add' }): PhotoEntry {
  const { photo } = p;
  return {
    id: photo.id, name: photo.name, file: photo.file, url: photo.url,
    camera: photo.camera ?? { kind: 'auto' },
    tilt: photo.tilt ?? { source: 'assumed', pitchDeg: 0, rollDeg: 0 },
    timeUtc: photo.timeUtc ?? '',
    label: null, labelName: null,
    status: 'queued', error: null, response: null, trace: null, history: [],
    skyline: null, angles: 'fresh', anglesError: null, rev: 0,
  };
}

/** The camera JSON the skyline API gets for this photo. */
export function specFor(p: PhotoEntry): CameraSpec {
  const spec: CameraSpec = {};
  if (p.camera.kind === 'preset') spec.preset = p.camera.id;
  if (p.camera.kind === 'fov') spec.hfov_deg = p.camera.hfovDeg;
  if (p.label === null && p.tilt.source !== 'assumed') {
    spec.pitch_deg = p.tilt.pitchDeg;
    spec.roll_deg = p.tilt.rollDeg;
    spec.level_source = p.tilt.source;
  }
  if (p.timeUtc) spec.time_utc = p.timeUtc;
  return spec;
}

/** Camera info changed: angles must be recomputed, or the trace retried if it failed. */
function cameraChanged(p: PhotoEntry): PhotoEntry {
  if (p.status === 'error') return { ...p, status: 'queued', error: null, rev: p.rev + 1 };
  if (p.status === 'traced') return { ...p, angles: 'stale', anglesError: null, rev: p.rev + 1 };
  return p;
}

function update(s: Session, id: string, f: (p: PhotoEntry) => PhotoEntry): Session {
  return { ...s, photos: s.photos.map(p => (p.id === id ? f(p) : p)), locate: s.locate.status === 'sending' ? s.locate : { status: 'idle' } };
}

export function reduce(s: Session, a: Action): Session {
  switch (a.type) {
    case 'add':
      return { ...s, photos: [...s.photos, newPhoto(a)], selected: s.selected ?? a.photo.id, locate: { status: 'idle' } };
    case 'remove': {
      const photos = s.photos.filter(p => p.id !== a.id);
      const selected = s.selected === a.id ? (photos[0]?.id ?? null) : s.selected;
      return { ...s, photos, selected, locate: { status: 'idle' } };
    }
    case 'select':
      return s.photos.some(p => p.id === a.id) ? { ...s, selected: a.id } : s;
    case 'camera':
      return update(s, a.id, p => cameraChanged({ ...p, camera: a.camera }));
    case 'tilt':
      return update(s, a.id, p => cameraChanged({ ...p, tilt: a.tilt }));
    case 'time':
      return update(s, a.id, p => cameraChanged({ ...p, timeUtc: a.timeUtc }));
    case 'label':
      return update(s, a.id, p => cameraChanged({
        ...p, label: a.label, labelName: a.labelName,
        camera: a.label !== null ? { kind: 'label' } : p.camera.kind === 'label' ? { kind: 'auto' } : p.camera,
      }));
    case 'trace-start':
      return update(s, a.id, p => ({ ...p, status: 'tracing', error: null }));
    case 'trace-done':
      return update(s, a.id, p => ({
        ...p, status: 'traced', response: a.response, trace: a.response.trace, history: [],
        skyline: a.response.skyline, angles: 'fresh', anglesError: null,
      }));
    case 'trace-failed':
      return update(s, a.id, p => ({ ...p, status: 'error', error: a.error }));
    case 'edit':
      return update(s, a.id, p => (p.trace === null ? p : {
        ...p, trace: a.trace, history: [...p.history, p.trace].slice(-MAX_UNDO), angles: 'stale', anglesError: null, rev: p.rev + 1,
      }));
    case 'undo':
      return update(s, a.id, p => (p.history.length === 0 ? p : {
        ...p, trace: p.history[p.history.length - 1], history: p.history.slice(0, -1), angles: 'stale', rev: p.rev + 1,
      }));
    case 'reset-edits':
      return update(s, a.id, p => (p.response === null ? p : {
        ...p, trace: p.response.trace, history: p.trace ? [...p.history, p.trace].slice(-MAX_UNDO) : p.history, angles: 'stale', rev: p.rev + 1,
      }));
    case 'convert-start':
      return update(s, a.id, p => ({ ...p, angles: 'updating' }));
    case 'convert-done':
      // Only accept the angles if nothing changed meanwhile (otherwise they are stale already).
      return update(s, a.id, p => (p.rev === a.rev ? { ...p, skyline: a.skyline, angles: 'fresh', anglesError: null } : p));
    case 'convert-failed':
      return update(s, a.id, p => (p.angles === 'updating' ? { ...p, angles: 'failed', anglesError: a.error } : p));
    case 'locate-start':
      return { ...s, locate: { status: 'sending' } };
    case 'locate-done':
      return { ...s, locate: { status: 'answered', answer: a.answer, at: a.at } };
    case 'locate-failed':
      return { ...s, locate: { status: 'failed', error: a.error } };
  }
}

/** What stops the photos being sent to the engine, or null when they can go. */
export function locateBlocker(s: Session): string | null {
  const traced = s.photos.filter(p => p.status === 'traced');
  if (s.photos.length === 0) return 'Add at least one photo.';
  if (s.photos.some(p => p.status === 'queued' || p.status === 'tracing')) return 'Tracing the skyline…';
  if (s.photos.some(p => p.angles === 'stale' || p.angles === 'updating')) return 'Updating angles…';
  if (traced.length === 0) return 'No photo has a skyline yet.';
  if (traced.some(p => p.angles === 'failed')) return 'Angles failed for a photo: fix it or remove it.';
  if (traced.every(p => (p.skyline?.samples ?? []).every(x => x.weight < 0.5))) return 'No part of any skyline is trusted.';
  return null;
}
