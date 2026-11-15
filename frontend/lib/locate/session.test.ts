import { describe, expect, it } from 'vitest';
import {
  buildLocateRequest, emptySession, locateBlocker, reduce, relativeHeadings, specFor, type Action, type Session,
} from '@/lib/locate/session';
import { contractPhoto, contractResult, diagnostics, skylineResponse, trace } from '@/lib/testing/locateFixtures';

const run = (actions: Action[], s: Session = emptySession) => actions.reduce(reduce, s);
const add = (id: string): Action => ({ type: 'add', photo: { id, name: `${id}.jpg`, file: new Blob(), url: `blob:${id}` } });
const done = (id: string, response = skylineResponse()): Action[] => [add(id), { type: 'trace-start', id }, { type: 'trace-done', id, response }];
const traced = (id: string) => run(done(id));

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
    const rev = f.photos[0].rev;
    f = reduce(f, { type: 'camera', id: 'b', camera: { kind: 'fov', hfovDeg: 60 } });
    expect(f.photos[0].status).toBe('queued');
    expect(f.photos[0].rev).toBe(rev + 1); // a retry is a new request
  });

  it('a label or camera change while tracing retraces, and the old answer is ignored', () => {
    let s = run([add('c'), { type: 'trace-start', id: 'c', rev: 0 }]);
    s = reduce(s, { type: 'label', id: 'c', label: { camera: {} }, labelName: 'c.json' });
    expect(s.photos[0].status).toBe('queued');
    expect(s.photos[0].rev).toBe(1);
    // the request sent before the label (rev 0) now fails: it must not stop the retrace
    s = reduce(s, { type: 'trace-failed', id: 'c', rev: 0, error: 'no field of view' });
    expect(s.photos[0].status).toBe('queued');
    s = reduce(s, { type: 'trace-done', id: 'c', rev: 0, response: skylineResponse() });
    expect(s.photos[0].status).toBe('queued');
    s = run([{ type: 'trace-start', id: 'c', rev: 1 }, { type: 'trace-done', id: 'c', rev: 1, response: skylineResponse() }], s);
    expect(s.photos[0].status).toBe('traced');
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
    s = reduce(s, { type: 'convert-done', id: 'a', photo: contractPhoto(0.9), diagnostics: diagnostics(), rev });
    expect(s.photos[0].angles).toBe('stale');
    s = reduce(s, { type: 'convert-start', id: 'a' });
    s = reduce(s, { type: 'convert-done', id: 'a', photo: contractPhoto(0.9), diagnostics: diagnostics(), rev: s.photos[0].rev });
    expect(s.photos[0].angles).toBe('fresh');
    expect(s.photos[0].photo?.samples[0].weight).toBe(0.9);
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
    expect(locateBlocker(run(done('b', skylineResponse(0))))).toMatch(/No part of any skyline is trusted/);
    const short = { ...skylineResponse(), photo: contractPhoto(1, 5) };
    expect(locateBlocker(run(done('c', short)))).toMatch(/too little skyline/);
    const nine = run(Array.from({ length: 9 }, (_, k) => done(`p${k}`)).flat());
    expect(locateBlocker(nine)).toMatch(/At most 8 photos/);
  });

  it('removing the selected photo selects the next', () => {
    const s = run([add('a'), add('b'), { type: 'remove', id: 'a' }]);
    expect(s.selected).toBe('b');
  });
});

describe('relativeHeadings', () => {
  const at = (pose: string | null, az: number | null) => ({ diagnostics: diagnostics({ rover_pose: pose, rover_axis_azimuth_deg: az }) });

  it('turns photos from one rover pose together, first photo 0, clockwise positive, -180..180', () => {
    expect(relativeHeadings([at('3/1708', 100), at('3/1708', 160), at('3/1708', 20), at('3/1708', 300)])).toEqual([0, 60, -80, -160]);
  });
  it('leaves headings free when the poses differ, are unknown, or there is one photo', () => {
    expect(relativeHeadings([at('3/1708', 100), at('3/1416', 160)])).toEqual([null, null]);
    expect(relativeHeadings([at(null, null), at(null, null)])).toEqual([null, null]);
    expect(relativeHeadings([at('3/1708', 100)])).toEqual([null]);
  });
});

describe('buildLocateRequest', () => {
  it('builds the CONTRACTS.md section 2 body from the traced photos, in order', () => {
    const s = run([
      ...done('a', skylineResponse(1, { rover_pose: '3/1708', rover_axis_azimuth_deg: 100 })),
      ...done('b', skylineResponse(1, { rover_pose: '3/1708', rover_axis_azimuth_deg: 130 })),
      add('c'), // still tracing: left out
    ]);
    const body = buildLocateRequest(s);
    expect(body.contract_version).toBe('0.1');
    expect(body.photos.map(p => [p.id, p.relative_heading_deg])).toEqual([['photo_1', 0], ['photo_2', 30]]);
    expect(body.photos[0].samples).toHaveLength(30);
    expect(body.options).toEqual({ top_k: 5, include_likelihood_grid: true, include_residuals: true });
    expect(JSON.stringify(body)).not.toMatch(/diagnostics|rover_pose|trace/); // only contract fields go out
  });
});

describe('locate request state', () => {
  it('keeps the answer with the request that produced it', () => {
    let s = traced('a');
    const request = buildLocateRequest(s);
    s = reduce(s, { type: 'locate-start', request });
    expect(s.locate).toEqual({ status: 'sending', request });
    const answered = reduce(s, { type: 'locate-done', result: contractResult, at: '2026-11-15T01:00:00Z' });
    expect(answered.locate).toMatchObject({ status: 'answered', request, result: contractResult });
    // Photos edited while the request is out: the answer still lands, paired with what was sent.
    const edited = reduce(s, { type: 'time', id: 'a', timeUtc: '2026-11-15T10:00:00Z' });
    expect(reduce(edited, { type: 'locate-done', result: contractResult, at: 'x' }).locate).toMatchObject({ status: 'answered', request });
    // An answer with no request out (after a new edit reset an earlier answer) is ignored.
    const idle = reduce(answered, { type: 'time', id: 'a', timeUtc: '2026-11-15T11:00:00Z' });
    expect(idle.locate.status).toBe('idle');
    expect(reduce(idle, { type: 'locate-done', result: contractResult, at: 'y' }).locate.status).toBe('idle');
  });
});

describe('buildLocateRequest leaves out photos with nothing to match', () => {
  it('skips a photo whose skyline is all weight 0', () => {
    const s = run([...done('a'), ...done('b', skylineResponse(0))]);
    expect(buildLocateRequest(s).photos.map(p => p.id)).toEqual(['photo_1']);
  });
});
