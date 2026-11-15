'use client';

import { useEffect, useRef } from 'react';
import { formatClock, formatDistance } from '@/lib/nav/format';
import type { MissionSummary } from '@/components/mission/missionSummary';
import styles from './mission.module.css';

type Props = {
  summary: MissionSummary;
  /** Where the destination is, in plain words. */
  place: string;
  /** One extra line, e.g. who knows about it yet. */
  note?: string;
  /** Kept for callers; START OVER in the header starts a new mission. */
  onNew?: () => void;
  onClose: () => void;
};

const SHOW_MS = 8000; // real time the notice stays before it fades away

/** A quiet "you made it" notice at the bottom of the map that fades in, stays a few seconds and goes away. */
export function MissionComplete({ summary, place, note, onClose }: Props) {
  const close = useRef(onClose); // the caller's onClose changes every render; the timer must not restart
  useEffect(() => {
    close.current = onClose;
  });
  useEffect(() => {
    const timer = setTimeout(() => close.current(), SHOW_MS);
    return () => clearTimeout(timer);
  }, []);
  const d = formatDistance(summary.distanceM);
  return (
    <div className={styles.doneToast} role="status" data-testid="mission-complete" style={{ animationDuration: `${SHOW_MS}ms` }}>
      <span className={styles.doneKicker}>MISSION COMPLETE</span>
      <span className={styles.doneTitle}>Arrived at {place}</span>
      <span className={styles.doneStat}>{d.value} {d.unit} · {formatClock(summary.tripMs)} · {summary.photoFixes} photo fixes</span>
      {note && <span className={styles.doneNote}>{note}</span>}
    </div>
  );
}
