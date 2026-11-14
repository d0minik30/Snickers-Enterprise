// The Locate screen's state: the photos, what we know about each camera, the traced and edited
// skylines, and the request to the engine. A pure reducer; the screen runs the network calls that the
// statuses ask for ('queued' -> trace it, angles 'stale' -> convert it).

import type { CameraChoice } from '@/lib/locate/presets';
import { CONTRACT_VERSION, type CameraSpec, type ContractPhoto, type Diagnostics, type LocateRequest, type LocateResult, type SkylineResponse, type Trace } from '@/lib/locate/types';

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
  photo: ContractPhoto | null; // the engine's view of it: angles for the current trace and camera info
  diagnostics: Diagnostics | null; // how the skyline API set the camera up
  angles: 'fresh' | 'stale' | 'updating' | 'failed';
  anglesError: string | null;
  rev: number; // bumped by every change that makes the angles stale
};

export type LocateState =
  | { status: 'idle' }
  | { status: 'sending' }
  | { status: 'answered'; result: LocateResult; at: string }
  | { status: 'failed'; error: string };

export type Session = { photos: PhotoEntry[]; selected: string | null; locate: LocateState };

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
  | { type: 'convert-done'; id: string; photo: ContractPhoto; diagnostics: Diagnostics; rev: number }
  | { type: 'convert-failed'; id: string; error: string }
  | { type: 'locate-start' }
  | { type: 'locate-done'; result: LocateResult; at: string }
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
    photo: null, diagnostics: null, angles: 'fresh', anglesError: null, rev: 0,
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
        photo: a.response.photo, diagnostics: a.response.diagnostics, angles: 'fresh', anglesError: null,
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
      return update(s, a.id, p => (p.rev === a.rev ? { ...p, photo: a.photo, diagnostics: a.diagnostics, angles: 'fresh', anglesError: null } : p));
    case 'convert-failed':
      return update(s, a.id, p => (p.angles === 'updating' ? { ...p, angles: 'failed', anglesError: a.error } : p));
    case 'locate-start':
      return { ...s, locate: { status: 'sending' } };
    case 'locate-done':
      return { ...s, locate: { status: 'answered', result: a.result, at: a.at } };
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
  if (traced.every(p => (p.photo?.samples ?? []).every(x => x.weight < 0.5))) return 'No part of any skyline is trusted.';
  if (traced.length > MAX_PHOTOS) return `At most ${MAX_PHOTOS} photos per request.`;
  if (traced.some(p => (p.photo?.samples.length ?? 0) < MIN_SAMPLES)) return 'A photo has too little skyline: fix it or remove it.';
  return null;
}

export const MAX_PHOTOS = 8; // CONTRACTS.md section 2
export const MIN_SAMPLES = 20;

/**
 * Photos taken at the same rover pose turn together: their heading difference is known from the
 * camera models (relative_heading_deg). Any other photo is matched at its own free heading (null).
 */
export function relativeHeadings(photos: { diagnostics: Diagnostics | null }[]): (number | null)[] {
  const first = photos[0]?.diagnostics;
  const shared = first && first.rover_pose !== null && first.rover_axis_azimuth_deg !== null
    && photos.every(p => p.diagnostics?.rover_pose === first.rover_pose && p.diagnostics.rover_axis_azimuth_deg !== null);
  if (!shared || photos.length < 2) return photos.map(() => null);
  const base = first.rover_axis_azimuth_deg as number;
  return photos.map(p => {
    const d = ((p.diagnostics!.rover_axis_azimuth_deg as number) - base) % 360;
    return Math.round((((d + 540) % 360) - 180) * 1e4) / 1e4; // -180..180
  });
}

/** The POST /locate body (CONTRACTS.md section 2) for the traced photos, in the order shown. */
export function buildLocateRequest(s: Session): LocateRequest {
  const traced = s.photos.filter((p): p is PhotoEntry & { photo: ContractPhoto } => p.status === 'traced' && p.photo !== null);
  const rel = relativeHeadings(traced);
  return {
    contract_version: CONTRACT_VERSION,
    photos: traced.map((p, k) => ({ ...p.photo, id: `photo_${k + 1}`, relative_heading_deg: rel[k] })),
    options: { top_k: 5, include_likelihood_grid: true, include_residuals: true },
  };
}
