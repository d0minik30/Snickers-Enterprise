import { fieldStateAt } from '@/lib/mission/field';
import type { MissionEvent } from '@/lib/mission/types';

export type MissionSummary = { distanceM: number; tripMs: number; photoFixes: number; arrivedMs: number };

/** The finished trip: how far, how long from start to arrival, and how many photo fixes. Null until it has arrived. */
export function missionSummary(log: MissionEvent[], tMs: number): MissionSummary | null {
  const now = fieldStateAt(log, tMs);
  if (now.status !== 'arrived' || now.startedMs === null || !now.route) return null;
  // Find the arrival moment: the first time the field state reads "arrived".
  let lo = now.startedMs, hi = tMs;
  for (let i = 0; i < 40 && hi - lo > 500; i++) {
    const mid = (lo + hi) / 2;
    if (fieldStateAt(log, mid).status === 'arrived') hi = mid; else lo = mid;
  }
  const startedMs = now.startedMs;
  return {
    distanceM: now.route.lengthM,
    tripMs: hi - startedMs,
    photoFixes: log.filter(e => e.type === 'photo-fix' && e.tMs >= startedMs && e.tMs <= hi).length,
    arrivedMs: hi,
  };
}
