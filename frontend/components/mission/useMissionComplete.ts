'use client';

import { useMemo, useState } from 'react';
import { missionSummary, type MissionSummary } from '@/components/mission/missionSummary';
import type { MissionEvent } from '@/lib/mission/types';

/**
 * The finished-mission summary, worked out at `tMs` (Field time, or Field time 11:20 ago for Control),
 * and whether the message is still to be shown. Closing it lasts until the next mission.
 */
export function useMissionComplete(log: MissionEvent[], tMs: number, epoch: number) {
  const done = useMemo(() => missionSummary(log, tMs) !== null, [log, tMs]);
  // Only work out the full summary once, when the trip is done (it searches the log).
  const summary = useMemo<MissionSummary | null>(() => (done ? missionSummary(log, tMs) : null), [done, log]); // eslint-disable-line react-hooks/exhaustive-deps
  const [closedEpoch, setClosedEpoch] = useState<number | null>(null);
  return {
    summary,
    show: summary !== null && closedEpoch !== epoch,
    close: () => setClosedEpoch(epoch),
  };
}
