'use client';

import { ScreenMenu } from '@/components/shared/ScreenMenu';
import { useEffect, useState } from 'react';
import { useEmbedded } from '@/components/shared/embedded';
import { getMissionStore, useMissionSnapshot } from '@/lib/mission/useMission';
import { RATES } from '@/lib/mission/types';
import { distanceM } from '@/lib/nav/geo';
import { DEFAULT_END, DESTINATION } from '@/lib/planner';
import { routeSentEvent } from '@/components/control/controlModel';
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
  const embedded = useEmbedded();
  const destination = useTraverseName();
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
      {!embedded && (
        <ScreenMenu className={styles.brand} label="Marsfinder: all screens">
          MARSFINDER <span className={styles.brandView}>/ CONTROL</span>
          <span className={styles.brandCaret} aria-hidden="true">▾</span>
        </ScreenMenu>
      )}
      <div role="tablist" aria-label="Mode" className={styles.tabs}>
        {tab('plan', 'PLAN')}
        {tab('live', 'WATCH')}
      </div>
      {!embedded && (
        <div className={styles.traverse}>
          <span className={styles.traversePlace}>LANDING SITE&nbsp;→&nbsp;</span>{destination}
        </div>
      )}
      {!embedded && <DemoControls />}
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
      <span>SPEED</span>
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
