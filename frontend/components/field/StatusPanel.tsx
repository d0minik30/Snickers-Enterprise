import type { FieldState } from '@/lib/mission/field';
import { PACE_MPS, SIGNAL_DELAY_MS } from '@/lib/mission/types';
import { formatClock, formatDistance } from '@/lib/nav/format';
import Link from 'next/link';
import { useRef } from 'react';
import { useCoverHeight } from '@/components/field/ReportComposer';
import styles from './field.module.css';

type Props = { state: FieldState; onStart: () => void; onHeight?: (px: number) => void };

/** Slim banner above the map while holding or done. */
export function StatusBanner({ status }: { status: FieldState['status'] }) {
  if (status === 'holding') return <div className={`${styles.banner} ${styles.bannerHold}`} role="status">HOLDING · ORDER FROM CONTROL</div>;
  if (status === 'arrived') return <div className={`${styles.banner} ${styles.bannerDone}`} role="status">TRAVERSE COMPLETE</div>;
  return null;
}

/** What sits over the map before the traverse: waiting for a route, then the route with a Start button. */
export function StatusPanel({ state, onStart, onHeight }: Props) {
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
    case 'ready':
      return <ReadyPanel state={state} onStart={onStart} onHeight={onHeight} />;
    default:
      return null;
  }
}

/** The route has landed: its numbers and the Start button, docked at the bottom of the map. */
function ReadyPanel({ state, onStart, onHeight }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  useCoverHeight(ref, onHeight ?? NO_HEIGHT);
  const route = state.route!;
  const length = formatDistance(route.lengthM);
  const time = formatClock((route.lengthM / PACE_MPS[state.traveller ?? 'astronaut']) * 1000);
  return (
    <div ref={ref} className={`${styles.panel} ${styles.panelDocked}`} role="status">
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

const NO_HEIGHT = () => {};
