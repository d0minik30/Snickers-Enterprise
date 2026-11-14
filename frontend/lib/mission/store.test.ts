import { describe, expect, it } from 'vitest';
import { fieldStateAt } from '@/lib/mission/field';
import {
  STORAGE_KEY, createMissionStore, freshSnapshot, loadSnapshot, mergeSnapshots,
  type ChannelLike, type StorageLike,
} from '@/lib/mission/store';
import { straightRoute } from '@/lib/testing/fixtures';

function fakeStorage(): StorageLike {
  const map = new Map<string, string>();
  return { getItem: k => map.get(k) ?? null, setItem: (k, v) => { map.set(k, v); } };
}

function fakeBus() {
  const channels: ChannelLike[] = [];
  return {
    connect(): ChannelLike {
      const ch: ChannelLike = {
        onmessage: null,
        postMessage(data) {
          for (const other of channels) if (other !== ch) other.onmessage?.({ data });
        },
      };
      channels.push(ch);
      return ch;
    },
  };
}

const ev = { type: 'traverse-started', origin: 'field' } as const;

describe('mission store', () => {
  it('a second window sees an event appended in the first', () => {
    const storage = fakeStorage(), bus = fakeBus();
    const a = createMissionStore(storage, bus.connect(), () => 1_000);
    const b = createMissionStore(storage, bus.connect(), () => 1_000);
    let told = 0; b.subscribe(() => told++);
    const e = a.append(ev);
    expect(told).toBe(1); expect(b.getSnapshot().log).toEqual([e]);
  });
  it('stamps events with mission time', () => {
    let real = 1_000; const s = createMissionStore(fakeStorage(), fakeBus().connect(), () => real);
    real = 3_000; expect(s.append(ev).tMs).toBe(60_000);            // 2 s real at 30x
  });
  it('a window opened later rebuilds the same state from storage', () => {
    const storage = fakeStorage(), bus = fakeBus();
    const a = createMissionStore(storage, bus.connect(), () => 1_000);
    a.append({ type: 'route-sent', origin: 'control', traveller: 'astronaut', route: straightRoute(2000), hazards: [] });
    a.append(ev);
    const late = createMissionStore(storage, bus.connect(), () => 50_000);
    expect(late.getSnapshot()).toEqual(a.getSnapshot());
    expect(fieldStateAt(late.getSnapshot().log, 1_000_000)).toEqual(fieldStateAt(a.getSnapshot().log, 1_000_000));
  });
  it('keeps both events when two windows append at once', () => {
    const base = freshSnapshot(5);
    const e1 = { id: 'b', tMs: 10, ...ev }, e2 = { id: 'a', tMs: 10, ...ev };
    const m = mergeSnapshots({ ...base, log: [e1] }, { ...base, log: [e2] });
    expect(m.log.map(e => e.id)).toEqual(['a', 'b']);
  });
  it('a reset in one window clears the other', () => {
    const storage = fakeStorage(), bus = fakeBus(); let real = 1_000;
    const a = createMissionStore(storage, bus.connect(), () => real), b = createMissionStore(storage, bus.connect(), () => real);
    a.append(ev); real = 2_000; b.reset();
    expect(a.getSnapshot().log).toEqual([]); expect(a.getSnapshot().epoch).toBe(2_000);
  });
  it('a speed change reaches the other window and keeps time continuous', () => {
    const storage = fakeStorage(), bus = fakeBus(); let real = 1_000;
    const a = createMissionStore(storage, bus.connect(), () => real), b = createMissionStore(storage, bus.connect(), () => real);
    real = 2_000; a.setRate(60); real = 3_000;
    expect(b.now()).toBe(90_000);
  });
  it('windows opened one after the other on empty storage share the first epoch', () => {
    const storage = fakeStorage(), bus = fakeBus(); let real = 1_000;
    const a = createMissionStore(storage, bus.connect(), () => real);
    real = 5_000;
    const b = createMissionStore(storage, bus.connect(), () => real);
    expect(a.getSnapshot().epoch).toBe(1_000); expect(b.getSnapshot().epoch).toBe(1_000);
    const e = b.append(ev);
    expect(a.getSnapshot().log).toEqual([e]);
  });
  it('reset always gets an epoch above the current one', () => {
    const s = createMissionStore(fakeStorage(), fakeBus().connect(), () => 1_000);
    s.reset();
    expect(s.getSnapshot().epoch).toBe(1_001);
  });
  it('ignores incoming messages that are not valid snapshots', () => {
    const bus = fakeBus(), ch = bus.connect();
    const s = createMissionStore(fakeStorage(), ch, () => 1_000);
    const before = s.getSnapshot(); let told = 0; s.subscribe(() => told++);
    for (const junk of [null, 'x', 42, {}, { epoch: 'x' }, { epoch: 9, log: 'nope', clock: {} }]) ch.onmessage?.({ data: junk });
    expect(told).toBe(0); expect(s.getSnapshot()).toBe(before);
  });
  it('keeps working and still posts when storage.setItem throws', () => {
    const bus = fakeBus(); const other = bus.connect();
    const broken: StorageLike = { getItem: () => null, setItem: () => { throw new Error('quota'); } };
    const s = createMissionStore(broken, bus.connect(), () => 1_000);
    let got: unknown = null; other.onmessage = m => { got = m.data; };
    const e = s.append(ev);
    expect(s.getSnapshot().log).toEqual([e]);
    expect(got).toEqual(s.getSnapshot());
  });
  it('getSnapshot returns the same reference until something changes', () => {
    const s = createMissionStore(fakeStorage(), fakeBus().connect(), () => 1_000);
    expect(s.getSnapshot()).toBe(s.getSnapshot());
    const before = s.getSnapshot(); s.append(ev);
    expect(s.getSnapshot()).not.toBe(before);
  });
  it('writes a fresh snapshot to empty storage on creation', () => {
    const storage = fakeStorage();
    createMissionStore(storage, fakeBus().connect(), () => 1_000);
    expect(JSON.parse(storage.getItem(STORAGE_KEY)!)).toEqual(freshSnapshot(1_000));
  });
  it.each(['not json', '{"epoch":"x"}', '{"epoch":1,"log":"nope","clock":{}}', 'null'])
    ('starts fresh when storage holds %s', (bad) => {
      const storage = fakeStorage(); storage.setItem(STORAGE_KEY, bad);
      const s = loadSnapshot(storage, 7_000);
      expect(s).toEqual(freshSnapshot(7_000));
    });
  it('loadSnapshot survives getItem throwing', () => {
    const storage: StorageLike = { getItem: () => { throw new Error('denied'); }, setItem: () => {} };
    expect(loadSnapshot(storage, 7_000)).toEqual(freshSnapshot(7_000));
  });

  describe('fix round 1', () => {
    const channelPair = () => {
      const sent: unknown[] = [];
      const ch: ChannelLike = { onmessage: null, postMessage: d => { sent.push(d); } };
      return { ch, sent };
    };
    it('merge is commutative when clock revs tie', () => {
      const base = freshSnapshot(5);
      const a = { ...base, clock: { ...base.clock, rev: 1, rate: 60 } };
      const b = { ...base, clock: { ...base.clock, rev: 1, paused: true } };
      expect(mergeSnapshots(a, b)).toEqual(mergeSnapshots(b, a));
    });
    it('concurrent setRate and setPaused leave both windows with the same clock', () => {
      const storage = fakeStorage(); let real = 1_000;
      const pa = channelPair(), pb = channelPair();
      const a = createMissionStore(storage, pa.ch, () => real), b = createMissionStore(storage, pb.ch, () => real);
      pa.sent.length = 0; pb.sent.length = 0;
      real = 2_000; a.setRate(60); real = 2_500; b.setPaused(true);
      pa.ch.onmessage?.({ data: pb.sent[0] }); pb.ch.onmessage?.({ data: pa.sent[0] });
      expect(a.getSnapshot().clock).toEqual(b.getSnapshot().clock);
    });
    it.each([
      ['a null log entry', { epoch: 1, log: [null] }],
      ['a log entry without id', { epoch: 1, log: [{ tMs: 1, type: 'x', origin: 'field' }] }],
      ['a log entry with a bad origin', { epoch: 1, log: [{ id: 'a', tMs: 1, type: 'x', origin: 'moon' }] }],
    ])('loadSnapshot starts fresh on %s', (_n, partial) => {
      const storage = fakeStorage(); const good = freshSnapshot(1);
      storage.setItem(STORAGE_KEY, JSON.stringify({ ...good, ...partial }));
      expect(loadSnapshot(storage, 7_000)).toEqual(freshSnapshot(7_000));
    });
    it('ignores incoming snapshots with a bad log entry or a NaN epoch', () => {
      const ch = fakeBus().connect();
      const s = createMissionStore(fakeStorage(), ch, () => 1_000);
      const good = freshSnapshot(1_000); const before = s.getSnapshot(); let told = 0; s.subscribe(() => told++);
      for (const data of [{ ...good, log: [null] }, { ...good, log: [{ tMs: 1, type: 'x', origin: 'field' }] }, { ...good, epoch: NaN }]) {
        expect(() => ch.onmessage?.({ data })).not.toThrow();
      }
      expect(told).toBe(0); expect(s.getSnapshot()).toBe(before);
      expect(() => s.append(ev)).not.toThrow();
    });
    it('two windows opened together on separate empty storages converge on one epoch', () => {
      const bus = fakeBus(); const ca = bus.connect(), cb = bus.connect();
      const a = createMissionStore(fakeStorage(), ca, () => 1_000);
      const b = createMissionStore(fakeStorage(), cb, () => 1_005);
      expect(a.getSnapshot().epoch).toBe(1_005); expect(b.getSnapshot().epoch).toBe(1_005);
      const ea = a.append(ev); const eb = b.append({ type: 'ack', origin: 'field', targetId: 'x' });
      expect(b.getSnapshot().log).toContainEqual(ea); expect(a.getSnapshot().log).toContainEqual(eb);
    });
  });
});
