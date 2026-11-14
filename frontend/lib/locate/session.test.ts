import { describe, expect, it } from 'vitest';
import { emptySession, locateBlocker, reduce, specFor, type Action, type Session } from '@/lib/locate/session';
import type { Skyline, SkylineResponse, Trace } from '@/lib/locate/types';

const trace: Trace = { width: 4, height: 3, x: [0, 1, 2, 3], y: [1, 1, 1, 1], weight: [1, 1, 1, 1], reason: [null, null, null, null], sun_px: null };
const skyline = (w = 1): Skyline => ({
  format: 'skyline/draft-1',
  camera: { model: 'pinhole', width: 4, height: 3, hfov_deg: 60, vfov_deg: 47, pitch_deg: 0, roll_deg: 0, source: 'preset' },
  level_source: 'assumed', eye_height_m: 1.7, time_utc: null, sun: null, az_step_deg: 0.1,
  samples: [{ az_offset_deg: 0, elev_deg: 1, weight: w }],
});
const response: SkylineResponse = { skyline: skyline(), trace, debug_image: 'data:image/jpeg;base64,' };

const run = (actions: Action[], s: Session = emptySession) => actions.reduce(reduce, s);
const add = (id: string): Action => ({ type: 'add', photo: { id, name: `${id}.jpg`, file: new Blob(), url: `blob:${id}` } });
const traced = (id: string) => run([add(id), { type: 'trace-start', id }, { type: 'trace-done', id, response }]);

describe('session', () => {
  it('queues a new photo for tracing and selects the first one', () => {
    const s = run([add('a'), add('b')]);
    expect(s.photos.map(p => p.status)).toEqual(['queued', 'queued']);
    expect(s.selected).toBe('a');
  });

  it('camera changes make traced angles stale, and retry a failed trace', () => {
    let s = traced('a');
    s = reduce(s, { type: 'camera', id: 'a', camera: { kind: 'preset', id: 'pixel-main' } });
    expect(s.photos[0].angles).toBe('stale');
    expect(s.photos[0].status).toBe('traced');
    let f = run([add('b'), { type: 'trace-start', id: 'b' }, { type: 'trace-failed', id: 'b', error: 'no field of view' }]);
    f = reduce(f, { type: 'camera', id: 'b', camera: { kind: 'fov', hfovDeg: 60 } });
    expect(f.photos[0].status).toBe('queued');
  });

  it('edits are undoable and make the angles stale', () => {
    const moved = { ...trace, y: [2, 2, 1, 1] };
    let s = reduce(traced('a'), { type: 'edit', id: 'a', trace: moved });
    expect(s.photos[0].trace).toBe(moved);
    expect(s.photos[0].angles).toBe('stale');
    s = reduce(s, { type: 'undo', id: 'a' });
    expect(s.photos[0].trace).toBe(trace);
  });

  it('ignores angles that arrive after a newer change', () => {
    let s = traced('a');
    s = reduce(s, { type: 'tilt', id: 'a', tilt: { source: 'manual', pitchDeg: 3, rollDeg: 0 } });
    const rev = s.photos[0].rev;
    s = reduce(s, { type: 'convert-start', id: 'a' });
    s = reduce(s, { type: 'tilt', id: 'a', tilt: { source: 'manual', pitchDeg: 4, rollDeg: 0 } }); // changed meanwhile
    s = reduce(s, { type: 'convert-done', id: 'a', skyline: skyline(0.9), rev });
    expect(s.photos[0].angles).toBe('stale');
    s = reduce(s, { type: 'convert-start', id: 'a' });
    s = reduce(s, { type: 'convert-done', id: 'a', skyline: skyline(0.9), rev: s.photos[0].rev });
    expect(s.photos[0].angles).toBe('fresh');
    expect(s.photos[0].skyline?.samples[0].weight).toBe(0.9);
  });

  it('a label sets the camera, and its tilt replaces the manual one', () => {
    let s = traced('a');
    s = reduce(s, { type: 'tilt', id: 'a', tilt: { source: 'manual', pitchDeg: 5, rollDeg: 1 } });
    expect(specFor(s.photos[0])).toMatchObject({ pitch_deg: 5, roll_deg: 1, level_source: 'manual' });
    s = reduce(s, { type: 'label', id: 'a', label: { camera: {} }, labelName: 'l.json' });
    expect(s.photos[0].camera).toEqual({ kind: 'label' });
    expect(specFor(s.photos[0]).pitch_deg).toBeUndefined();
  });

  it('says what blocks sending to the engine', () => {
    expect(locateBlocker(emptySession)).toMatch(/Add at least one photo/);
    expect(locateBlocker(run([add('a')]))).toMatch(/Tracing/);
    const ok = traced('a');
    expect(locateBlocker(ok)).toBeNull();
    const stale = reduce(ok, { type: 'time', id: 'a', timeUtc: '2026-11-15T10:00:00Z' });
    expect(locateBlocker(stale)).toMatch(/Updating angles/);
    const untrusted = run([add('b'), { type: 'trace-done', id: 'b', response: { ...response, skyline: skyline(0) } }]);
    expect(locateBlocker(untrusted)).toMatch(/No part of any skyline is trusted/);
  });

  it('removing the selected photo selects the next', () => {
    const s = run([add('a'), add('b'), { type: 'remove', id: 'a' }]);
    expect(s.selected).toBe('b');
  });
});
