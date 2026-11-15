import type { FieldState } from '@/lib/mission/field';
import { PACE_MPS, SIGNAL_DELAY_MS } from '@/lib/mission/types';
import { formatClock, formatDistance } from '@/lib/nav/format';
import Link from 'next/link';
import styles from './field.module.css';

type Props = { state: FieldState; onStart: () => void };

/** Slim banner above the map while holding or done. */
export function StatusBanner({ status }: { status: FieldState['status'] }) {
  if (status === 'holding') return <div className={`${styles.banner} ${styles.bannerHold}`} role="status">HOLDING · ORDER FROM CONTROL</div>;
  if (status === 'arrived') return <div className={`${styles.banner} ${styles.bannerDone}`} role="status">TRAVERSE COMPLETE</div>;
  return null;
}

/** What sits over the map before the traverse: waiting for a route, then the route with a Start button. */
export function StatusPanel({ state, onStart }: Props) {
  switch (state.status) {
    case 'awaiting-route':
      return (
        <div className={styles.panel} role="status">
          <p className={styles.panelKicker}>FIELD · ON THE SURFACE</p>
          <p className={styles.panelTitle}>AWAITING ROUTE FROM CONTROL</p>
          <p className={styles.panelNote}>A route from Earth takes {formatClock(SIGNAL_DELAY_MS)} to arrive.</p>
          <ol className={styles.panelSteps}>
            <li>Open <b>Control</b> in a wide window.</li>
            <li>Pick a route and press <b>Send route to field</b>.</li>
            <li>It lands here after the delay. Then press <b>Start traverse</b>.</li>
          </ol>
          <Link href="/control/" className={styles.panelLink} target="_blank" rel="noreferrer">OPEN CONTROL IN A NEW WINDOW →</Link>
        </div>
      );
    case 'ready': {
      const route = state.route!;
      const length = formatDistance(route.lengthM);
      const time = formatClock((route.lengthM / PACE_MPS[state.traveller ?? 'astronaut']) * 1000);
      return (
        <div className={`${styles.panel} ${styles.panelDocked}`} role="status">
          <p className={styles.panelTitle}>ROUTE RECEIVED</p>
          <div className={styles.panelStats}>
            <span><span className={styles.panelLabel}>LENGTH</span> {length.value} {length.unit}</span>
            <span><span className={styles.panelLabel}>TIME</span> {time}</span>
            <span><span className={styles.panelLabel}>WAYPOINTS</span> {route.waypoints.length}</span>
          </div>
          <button type="button" data-testid="field-start" className={styles.startButton} onClick={onStart}>
            START TRAVERSE
          </button>
        </div>
      );
    }
    default:
      return null;
  }
}
