'use client';

import { useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import ControlScreen from '@/components/control/ControlScreen';
import { routeSentEvent } from '@/components/control/controlModel';
import FieldScreen from '@/components/field/FieldScreen';
import { MissionComplete } from '@/components/mission/MissionComplete';
import { useMissionComplete } from '@/components/mission/useMissionComplete';
import { EmbeddedContext } from '@/components/shared/embedded';
import { fieldStateAt } from '@/lib/mission/field';
import { getMissionStore, useMissionSnapshot, useMissionTime } from '@/lib/mission/useMission';
import { RATES, SIGNAL_DELAY_MS } from '@/lib/mission/types';
import { formatClock } from '@/lib/nav/format';
import { DESTINATION } from '@/lib/planner';
import Link from 'next/link';
import styles from './mission.module.css';

const subscribeNever = () => () => {};
const useHydrated = () => useSyncExternalStore(subscribeNever, () => true, () => false);
const DELAY = formatClock(SIGNAL_DELAY_MS);

/** Planner (Earth) and viewer (Mars) side by side in one window, with a plain "what to do now" line on top. */
export default function MissionScreen() {
  const hydrated = useHydrated();
  const snapshot = useMissionSnapshot();
  const t = useMissionTime();
  const field = useMemo(() => fieldStateAt(snapshot.log, t), [snapshot.log, t]);
  const sent = routeSentEvent(snapshot.log);
  const done = useMissionComplete(snapshot.log, t, snapshot.epoch);

  let step: { n: string; text: React.ReactNode };
  if (!sent) step = { n: '1', text: <>Pick a route on the left, then press <b>SEND ROUTE</b>.</> };
  else if (field.status === 'awaiting-route') {
    step = { n: '2', text: <>The route is flying to Mars. Radio takes {DELAY} each way. Arrives in <b className={styles.caution}>{formatClock(sent.tMs + SIGNAL_DELAY_MS - t)}</b>.</> };
  } else if (field.status === 'ready') step = { n: '3', text: <>The route reached Mars. Press <b>START</b> on the right.</> };
  else if (field.status === 'holding') step = { n: '4', text: <>The crew is <b className={styles.caution}>holding</b>. Send <b>PROCEED</b> from the left to go on.</> };
  else if (field.status === 'moving') step = { n: '4', text: <>The crew is walking. Earth (left) sees it {DELAY} late. Speed up time if it is slow →</> };
  else step = { n: '✓', text: <>Mission complete.</> };

  return (
    <EmbeddedContext.Provider value={true}>
      <div className={styles.screen}>
        <header className={styles.guide}>
          <Link href="/" className={styles.home} aria-label="Home">MARSFINDER</Link>
          {hydrated && (
            <p className={styles.step} data-testid="mission-step">
              <span className={styles.stepNumber}>{step.n}</span>
              <span>{step.text}</span>
            </p>
          )}
          <SpeedControls />
        </header>
        <div className={styles.panes}>
          <section className={styles.earthPane} aria-label="Mission Control on Earth">
            <p className={styles.paneLabel}>EARTH · MISSION CONTROL</p>
            <div className={styles.paneBody}><ControlScreen /></div>
          </section>
          <section className={styles.marsPane} aria-label="The crew on Mars">
            <p className={styles.paneLabel}>MARS · THE CREW</p>
            <div className={styles.paneBody}><FieldScreen /></div>
          </section>
        </div>
        {hydrated && done.show && done.summary && (
          <MissionComplete
            summary={done.summary}
            place={DESTINATION.name}
            note={`Mission Control on Earth gets the news ${DELAY} later.`}
            onNew={() => { done.close(); getMissionStore().reset(); }}
            onClose={done.close}
          />
        )}
      </div>
    </EmbeddedContext.Provider>
  );
}

const RESET_CONFIRM_MS = 4000;

/** Speed, pause and start over. */
export function SpeedControls() {
  const { clock } = useMissionSnapshot();
  const hydrated = useHydrated();
  const [confirming, setConfirming] = useState(false);
  useEffect(() => {
    if (!confirming) return;
    const timer = setTimeout(() => setConfirming(false), RESET_CONFIRM_MS);
    return () => clearTimeout(timer);
  }, [confirming]);

  return (
    <div className={styles.speed} role="group" aria-label="Time controls">
      <span className={styles.speedLabel}>SPEED</span>
      {RATES.map(rate => (
        <button
          key={rate}
          type="button"
          data-rate={rate}
          aria-pressed={hydrated && clock.rate === rate && !clock.paused}
          className={styles.rate}
          onClick={() => { const s = getMissionStore(); s.setRate(rate); if (clock.paused) s.setPaused(false); }}
        >
          {rate}×
        </button>
      ))}
      <button type="button" aria-pressed={hydrated && clock.paused} className={styles.rate} onClick={() => getMissionStore().setPaused(!clock.paused)}>
        {hydrated && clock.paused ? '▶ PLAY' : '❚❚ PAUSE'}
      </button>
      <button
        type="button"
        className={styles.reset}
        onClick={() => { if (!confirming) return setConfirming(true); setConfirming(false); getMissionStore().reset(); }}
        onBlur={() => setConfirming(false)}
      >
        {confirming ? 'SURE? CLICK AGAIN' : 'START OVER'}
      </button>
    </div>
  );
}
