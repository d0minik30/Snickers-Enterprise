import { missionTimeAt, newClock, withPaused, withRate, type ClockState } from '@/lib/mission/clock';
import type { MissionEvent } from '@/lib/mission/types';

export const STORAGE_KEY = 'marsmap.mission.v1';
export const CHANNEL_NAME = 'marsmap.mission';

export type MissionSnapshot = { epoch: number; log: MissionEvent[]; clock: ClockState };
export type StorageLike = Pick<Storage, 'getItem' | 'setItem'>;
export type ChannelLike = { postMessage(data: unknown): void; onmessage: ((e: { data: unknown }) => void) | null };
type NewEvent = MissionEvent extends infer E ? E extends MissionEvent ? Omit<E, 'id' | 'tMs'> : never : never;

export function freshSnapshot(realNowMs: number): MissionSnapshot {
  return { epoch: realNowMs, log: [], clock: newClock(realNowMs) };
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null;
}

const isFiniteNumber = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

function isClock(v: unknown): v is ClockState {
  return isRecord(v)
    && isFiniteNumber(v.anchorRealMs) && isFiniteNumber(v.anchorMissionMs)
    && isFiniteNumber(v.rate) && typeof v.paused === 'boolean' && isFiniteNumber(v.rev);
}

function isEvent(v: unknown): v is MissionEvent {
  return isRecord(v) && typeof v.id === 'string' && isFiniteNumber(v.tMs)
    && typeof v.type === 'string' && (v.origin === 'field' || v.origin === 'control');
}

function isSnapshot(v: unknown): v is MissionSnapshot {
  return isRecord(v) && isFiniteNumber(v.epoch) && Array.isArray(v.log) && v.log.every(isEvent) && isClock(v.clock);
}

// Higher rev wins; on a tie the fixed-order key decides, so both windows pick the same clock.
function newerClock(a: ClockState, b: ClockState): ClockState {
  if (a.rev !== b.rev) return a.rev > b.rev ? a : b;
  const key = (c: ClockState) => JSON.stringify([c.anchorRealMs, c.anchorMissionMs, c.rate, c.paused]);
  return key(b) > key(a) ? b : a;
}

export function loadSnapshot(storage: StorageLike, realNowMs: number): MissionSnapshot {
  try {
    const parsed: unknown = JSON.parse(storage.getItem(STORAGE_KEY) ?? 'null');
    if (isSnapshot(parsed)) return parsed;
  } catch {
    // missing, unreadable or malformed storage: fall through to a fresh mission
  }
  return freshSnapshot(realNowMs);
}

export function mergeSnapshots(a: MissionSnapshot, b: MissionSnapshot): MissionSnapshot {
  if (a.epoch !== b.epoch) return a.epoch > b.epoch ? a : b;
  const byId = new Map<string, MissionEvent>();
  for (const e of [...a.log, ...b.log]) byId.set(e.id, e);
  const log = [...byId.values()].sort((x, y) => x.tMs - y.tMs || (x.id < y.id ? -1 : x.id > y.id ? 1 : 0));
  return { epoch: a.epoch, log, clock: newerClock(a.clock, b.clock) };
}

export type MissionStore = {
  getSnapshot(): MissionSnapshot;
  subscribe(cb: () => void): () => void;
  now(): number; // current mission time
  append(e: NewEvent): MissionEvent; // stamps id (crypto.randomUUID) and tMs = now()
  setRate(rate: number): void;
  setPaused(paused: boolean): void;
  reset(): void;
};

export function createMissionStore(storage: StorageLike, channel: ChannelLike, realNow: () => number = Date.now): MissionStore {
  let snapshot = loadSnapshot(storage, realNow());
  const listeners = new Set<() => void>();

  const persist = () => {
    try { storage.setItem(STORAGE_KEY, JSON.stringify(snapshot)); } catch { /* keep working in memory */ }
  };
  const notify = () => listeners.forEach(cb => cb());
  const commit = (next: MissionSnapshot) => {
    snapshot = next;
    persist();
    channel.postMessage(snapshot);
    notify();
  };

  persist(); // a window opened later must adopt this epoch
  channel.postMessage(snapshot); // windows opened together converge on the higher epoch

  channel.onmessage = ({ data }) => {
    if (!isSnapshot(data)) return;
    const merged = mergeSnapshots(snapshot, data);
    if (merged === snapshot) return;
    snapshot = merged;
    persist();
    notify();
  };

  const now = () => missionTimeAt(snapshot.clock, realNow());

  return {
    getSnapshot: () => snapshot,
    subscribe(cb) {
      listeners.add(cb);
      return () => { listeners.delete(cb); };
    },
    now,
    append(e) {
      const stamped = { ...e, id: crypto.randomUUID(), tMs: Math.round(now()) } as MissionEvent;
      commit(mergeSnapshots(snapshot, { ...snapshot, log: [stamped] }));
      return stamped;
    },
    setRate: rate => commit({ ...snapshot, clock: withRate(snapshot.clock, rate, realNow()) }),
    setPaused: paused => commit({ ...snapshot, clock: withPaused(snapshot.clock, paused, realNow()) }),
    reset() {
      commit(freshSnapshot(Math.max(realNow(), snapshot.epoch + 1)));
    },
  };
}
