import type { FieldState } from '@/lib/mission/field';
import { PACE_MPS, SIGNAL_DELAY_MS } from '@/lib/mission/types';
import { formatClock, formatDistance } from '@/lib/nav/format';
import Link from 'next/link';
import { useEffect, useRef } from 'react';
import { useEmbedded } from '@/components/shared/embedded';
import styles from './field.module.css';

type Props = { state: FieldState; onStart: () => void; onHeight?: (px: number) => void };

/** Slim banner above the map while holding or done. */
export function StatusBanner({ status }: { status: FieldState['status'] }) {
  if (status === 'holding') return <div className={`${styles.banner} ${styles.bannerHold}`} role="status">HOLDING · EARTH SAID WAIT</div>;
  if (status === 'arrived') return <div className={`${styles.banner} ${styles.bannerDone}`} role="status">ARRIVED ✓</div>;
  return null;
}

/** What sits over the map before the traverse: waiting for a route, then the route with a Start button. */
export function StatusPanel({ state, onStart, onHeight }: Props) {
  switch (state.status) {
    case 'awaiting-route':
      return <WaitingPanel />;
    case 'ready':
      return <ReadyPanel state={state} onStart={onStart} onHeight={onHeight} />;
    default:
      return null;
  }
}

/** Before any route has reached Mars. */
function WaitingPanel() {
  const embedded = useEmbedded();
  if (embedded) {
    return (
      <div className={styles.panel} role="status">
        <p className={styles.panelTitle}>WAITING FOR A ROUTE FROM EARTH</p>
        <p className={styles.panelNote}>Pick a route on the left and send it. Radio takes {formatClock(SIGNAL_DELAY_MS)} to reach Mars.</p>
      </div>
    );
  }
  return (
    <div className={styles.panel} role="status">
      <p className={styles.panelTitle}>WAITING FOR A ROUTE FROM EARTH</p>
      <p className={styles.panelNote}>A route from Earth takes {formatClock(SIGNAL_DELAY_MS)} to arrive.</p>
      <ol className={styles.panelSteps}>
        <li>Open <b>Control</b> in a wide window.</li>
        <li>Pick a route and press <b>Send route to Mars</b>.</li>
        <li>It lands here after the delay. Then press <b>Start</b>.</li>
      </ol>
      <Link href="/mission/" className={styles.panelLink}>EASIER: SEE BOTH ON ONE SCREEN →</Link>
    </div>
  );
}

/** The route has landed: its numbers and the Start button, docked at the bottom of the map. */
function ReadyPanel({ state, onStart, onHeight }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const embedded = useEmbedded(); // inside Mission the step line says the route arrived
  useCoverHeight(ref, onHeight ?? NO_HEIGHT);
  const route = state.route!;
  const length = formatDistance(route.lengthM);
  const time = formatClock((route.lengthM / PACE_MPS[state.traveller ?? 'astronaut']) * 1000);
  return (
    <div ref={ref} className={`${styles.panel} ${styles.panelDocked}`} role="status">
      {!embedded && (
        <>
          <p className={styles.panelTitle}>THE ROUTE HAS ARRIVED</p>
          <div className={styles.panelStats}>
            <span><span className={styles.panelLabel}>LENGTH</span> {length.value} {length.unit}</span>
            <span><span className={styles.panelLabel}>TIME</span> {time}</span>
          </div>
        </>
      )}
      <button type="button" data-testid="field-start" className={styles.startButton} onClick={onStart}>
        START
      </button>
    </div>
  );
}

const NO_HEIGHT = () => {};

/** Tells the screen how much of the map the docked panel covers, so the traveller stays above it. */
function useCoverHeight(ref: React.RefObject<HTMLElement | null>, onHeight: (px: number) => void) {
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(() => onHeight(el.offsetHeight));
    ro.observe(el);
    return () => { ro.disconnect(); onHeight(0); };
  }, [ref, onHeight]);
}
