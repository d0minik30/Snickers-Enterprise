'use client';

import Link from 'next/link';
import { formatClock, formatDistance } from '@/lib/nav/format';
import type { MissionSummary } from '@/components/mission/missionSummary';
import styles from './mission.module.css';

type Props = {
  summary: MissionSummary;
  /** Where the destination is, in plain words. */
  place: string;
  /** One extra line under the title, e.g. who knows about it yet. */
  note?: string;
  onNew: () => void;
  onClose: () => void;
};

/** The "you made it" message shown once a mission is finished. */
export function MissionComplete({ summary, place, note, onNew, onClose }: Props) {
  const d = formatDistance(summary.distanceM);
  return (
    <div className={styles.doneBackdrop} role="dialog" aria-modal="true" aria-labelledby="mission-done-title" data-testid="mission-complete">
      <div className={styles.done}>
        <p className={styles.doneKicker}>MISSION COMPLETE</p>
        <h2 id="mission-done-title" className={styles.doneTitle}>Arrived at {place}</h2>
        {note && <p className={styles.doneNote}>{note}</p>}
        <dl className={styles.doneStats}>
          <div><dt>Distance</dt><dd>{d.value} {d.unit}</dd></div>
          <div><dt>Trip time</dt><dd>{formatClock(summary.tripMs)}</dd></div>
          <div><dt>Photo fixes</dt><dd>{summary.photoFixes}</dd></div>
        </dl>
        <div className={styles.doneActions}>
          <button type="button" className={styles.donePrimary} onClick={onNew} data-testid="mission-new">START A NEW MISSION</button>
          <button type="button" className={styles.doneSecondary} onClick={onClose}>KEEP LOOKING</button>
          <Link href="/" className={styles.doneSecondary}>HOME</Link>
        </div>
      </div>
    </div>
  );
}
