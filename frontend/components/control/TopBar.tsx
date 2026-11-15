'use client';

import { ScreenMenu } from '@/components/shared/ScreenMenu';
import { useEffect, useState } from 'react';
import { earthClock, marsClock } from '@/components/control/controlModel';
import { getMissionStore, useMissionSnapshot, useMissionTime } from '@/lib/mission/useMission';
import { RATES, SIGNAL_DELAY_MS } from '@/lib/mission/types';
import { distanceM } from '@/lib/nav/geo';
import { DEFAULT_END, DESTINATION } from '@/lib/planner';
import { routeSentEvent } from '@/components/control/controlModel';
import { formatClock } from '@/lib/nav/format';
import styles from './control.module.css';

export type ControlMode = 'plan' | 'live';

const RESET_CONFIRM_MS = 4000; // the confirm step lapses back to RESET after this long

type Props = { mode: ControlMode | null; onMode: (mode: ControlMode) => void };

/** Where the traverse goes: the real destination's name, unless the planner moved the end elsewhere. */
function useTraverseName(): string {
  const { log } = useMissionSnapshot();
  const sent = routeSentEvent(log);
  const end = sent?.route.points[sent.route.points.length - 1];
  return !end || distanceM(end, DEFAULT_END) < 50 ? DESTINATION.name.toUpperCase() : 'CHOSEN POINT';
}

export function TopBar({ mode, onMode }: Props) {
  const t = useMissionTime();
  const destination = useTraverseName();
  const mars = marsClock(t);
  const tab = (m: ControlMode, label: string) => (
    <button
      type="button"
      role="tab"
      data-testid={`tab-${m}`}
      aria-selected={mode === m}
      className={styles.tab}
      onClick={() => onMode(m)}
    >
      {label}
    </button>
  );

  return (
    <header className={styles.topBar}>
      <ScreenMenu className={styles.brand} label="Mars Map: all screens">
        MARS MAP <span className={styles.brandView}>/ CONTROL</span>
        <span className={styles.brandCaret} aria-hidden="true">▾</span>
      </ScreenMenu>
      <div role="tablist" aria-label="Mode" className={styles.tabs}>
        {tab('plan', 'PLAN')}
        {tab('live', 'LIVE')}
      </div>
      <div className={styles.traverse}>
        <span className={styles.traversePlace}>BASE&nbsp;→&nbsp;</span>{destination}
      </div>
      <div className={styles.clock}>
        <span className={styles.clockLabel}>EARTH UTC</span>
        <span className={styles.clockValue}>{earthClock(t)}</span>
      </div>
      <div className={styles.clock}>
        <span className={styles.clockLabel}>MARS · SOL {mars.sol}</span>
        <span className={styles.clockValue}>{mars.time}</span>
      </div>
      <div data-testid="signal-delay" className={`${styles.clock} ${styles.delay}`}>
        <span className={styles.clockLabel}>SIGNAL DELAY</span>
        <span className={styles.clockValue}>{formatClock(SIGNAL_DELAY_MS)}</span>
      </div>
      <DemoControls />
    </header>
  );
}

/** Speed, pause and reset: for presenting the demo, so kept quiet and apart. */
function DemoControls() {
  const { clock } = useMissionSnapshot();
  const [confirming, setConfirming] = useState(false);

  useEffect(() => {
    if (!confirming) return;
    const timer = setTimeout(() => setConfirming(false), RESET_CONFIRM_MS);
    return () => clearTimeout(timer);
  }, [confirming]);

  const reset = () => {
    if (!confirming) return setConfirming(true);
    setConfirming(false);
    getMissionStore().reset();
  };

  return (
    <div className={styles.demo} aria-label="Demo controls" role="group">
      <span>DEMO</span>
      <div data-testid="demo-rate" role="group" aria-label="Clock rate" className={styles.rates}>
        {RATES.map(rate => (
          <button
            key={rate}
            type="button"
            data-rate={rate}
            aria-pressed={clock.rate === rate}
            className={styles.rate}
            onClick={() => getMissionStore().setRate(rate)}
          >
            {rate}×
          </button>
        ))}
      </div>
      <button
        type="button"
        data-testid="demo-pause"
        aria-pressed={clock.paused}
        className={styles.demoButton}
        onClick={() => getMissionStore().setPaused(!clock.paused)}
      >
        {clock.paused ? 'RESUME' : 'PAUSE'}
      </button>
      <button
        type="button"
        data-testid="demo-reset"
        data-confirming={confirming}
        className={styles.demoButton}
        onClick={reset}
        onBlur={() => setConfirming(false)}
      >
        {confirming ? 'CONFIRM RESET' : 'RESET'}
      </button>
    </div>
  );
}
