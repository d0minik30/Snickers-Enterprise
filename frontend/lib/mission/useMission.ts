'use client';

import { useEffect, useState, useSyncExternalStore } from 'react';
import { setClockEpoch } from '@/components/control/controlModel';
import { CHANNEL_NAME, createMissionStore, freshSnapshot, type ChannelLike, type MissionSnapshot, type MissionStore } from '@/lib/mission/store';

declare global {
  interface Window { __marsMission?: MissionStore }
}

export function getMissionStore(): MissionStore {
  if (!window.__marsMission) {
    const bc = new BroadcastChannel(CHANNEL_NAME);
    let handler: ChannelLike['onmessage'] = null;
    const channel: ChannelLike = {
      postMessage: data => bc.postMessage(data),
      get onmessage() { return handler; },
      set onmessage(h) { handler = h; bc.onmessage = h && (e => h({ data: e.data })); },
    };
    const store = createMissionStore(window.localStorage, channel);
    // Clocks show real UTC and Mars time from the moment this mission was started (the snapshot epoch).
    setClockEpoch(store.getSnapshot().epoch);
    store.subscribe(() => setClockEpoch(store.getSnapshot().epoch));
    window.__marsMission = store;
  }
  return window.__marsMission;
}

const SERVER_SNAPSHOT: MissionSnapshot = freshSnapshot(0);

export function useMissionSnapshot(): MissionSnapshot {
  return useSyncExternalStore(
    cb => getMissionStore().subscribe(cb),
    () => getMissionStore().getSnapshot(),
    () => SERVER_SNAPSHOT,
  );
}

export function useMissionTime(fps = 10): number {
  const snapshot = useMissionSnapshot();
  const paused = snapshot.clock.paused;
  const [time, setTime] = useState(0);

  useEffect(() => {
    const store = getMissionStore();
    setTime(store.now());
    if (paused) return; // the snapshot subscription wakes us when it unpauses
    const timer = setInterval(() => setTime(store.now()), 1000 / fps);
    return () => clearInterval(timer);
  }, [fps, paused, snapshot.epoch, snapshot.clock.rev]);

  return time;
}
