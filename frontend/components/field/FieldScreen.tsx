'use client';

import dynamic from 'next/dynamic';
import Link from 'next/link';
import { useMemo, useState, useSyncExternalStore } from 'react';
import { fieldCamera, simpleCells, fieldCue, fieldOverlays, nextMoveView } from '@/components/field/fieldModel';
import { NextMoveBand } from '@/components/field/NextMoveBand';
import { ReadoutBand } from '@/components/field/ReadoutBand';
import { StatusBanner, StatusPanel } from '@/components/field/StatusPanel';
import { fieldStateAt } from '@/lib/mission/field';
import { arrivalPercent, lifeSupportAt } from '@/lib/mission/lifeSupport';
import { getMissionStore, useMissionSnapshot, useMissionTime } from '@/lib/mission/useMission';
import { SiteHeader } from '@/components/shared/SiteHeader';
import { useEmbedded } from '@/components/shared/embedded';
import { MissionComplete } from '@/components/mission/MissionComplete';
import { useMissionComplete } from '@/components/mission/useMissionComplete';
import { DESTINATION, PHOTO_FIX_ERROR_M } from '@/lib/planner';
import styles from './field.module.css';

const MarsMap = dynamic(() => import('@/components/map/MarsMap'), { ssr: false });

const subscribeNever = () => () => {};

/** False in the static HTML and while hydrating, true afterwards. The mission log only exists in the browser. */
function useHydrated(): boolean {
  return useSyncExternalStore(subscribeNever, () => true, () => false);
}

export default function FieldScreen() {
  const hydrated = useHydrated();
  const embedded = useEmbedded();
  const snapshot = useMissionSnapshot();
  const t = useMissionTime();
  const done = useMissionComplete(snapshot.log, t, snapshot.epoch);
  const state = useMemo(() => fieldStateAt(snapshot.log, t), [snapshot.log, t]);

  const overlays = useMemo(() => fieldOverlays(state), [state]);
  const [readyHeight, setReadyHeight] = useState(0);
  // The docked Start panel covers the bottom of the map: keep the traveller visible above it.
  const cover = state.status === 'ready' ? readyHeight : 0;
  const camera = useMemo(() => fieldCamera(state, cover), [state, cover]);
  const cue = fieldCue(state);
  const status = hydrated ? state.status : 'awaiting-route';

  const start = () => getMissionStore().append({ type: 'traverse-started', origin: 'field' });
  const photoFix = () => getMissionStore().append({ type: 'photo-fix', origin: 'field' });

  return (
    <main className={styles.screen} data-testid="field-status" data-status={status}>
      {!embedded && <SiteHeader place="" />}
      {status !== 'awaiting-route' && <NextMoveBand view={hydrated ? nextMoveView(state) : null} life={hydrated ? lifeSupportAt(state) : null}
        arrival={hydrated && state.status !== 'arrived' ? arrivalPercent(state) : null} />}
      {hydrated && <StatusBanner status={state.status} />}
      <div className={styles.mapArea}>
        {hydrated && <MarsMap overlays={overlays} camera={camera} />}
        {hydrated && (state.status === 'moving' || state.status === 'holding') && (
          <div className={styles.fixGroup}>
            <button type="button" data-testid="field-photo-fix" className={styles.fixButton} onClick={photoFix}>
              PHOTO FIX
              {/* A demo shortcut, not an engine answer: it resets the drift ring to a fixed size. Say so on every screen. */}
              <span className={styles.fixButtonNote}>
                {embedded ? `simulated · ±${PHOTO_FIX_ERROR_M} m` : `find my position · simulated, ±${PHOTO_FIX_ERROR_M} m from real engine runs`}
              </span>
            </button>
            <Link href="/locate/" prefetch={false} className={styles.realFix} data-testid="field-real-fix">TAKE A REAL FIX →</Link>
          </div>
        )}
        {hydrated && state.pos && (
          <div className={styles.north} aria-label={`North is ${Math.round(state.headingDeg)} degrees to the left`}>
            <span className={styles.northNeedle} style={{ transform: `rotate(${-state.headingDeg}deg)` }}>
              <svg width="18" height="22" viewBox="0 0 18 22" aria-hidden="true">
                <path d="M9 1 L17 21 L9 16 L1 21 Z" fill="currentColor" />
              </svg>
            </span>
            <span className={styles.northLabel}>N</span>
          </div>
        )}
        {cue.routeChangeId && <div key={cue.routeChangeId} className={styles.routePulse} aria-hidden="true" />}
        {hydrated && <StatusPanel state={state} onStart={start} onHeight={setReadyHeight} />}
      </div>
      {hydrated && !embedded && done.show && done.summary && (
        <MissionComplete
          summary={done.summary}
          place={DESTINATION.name}
          note="Mission Control on Earth hears about it 11:20 later."
          onNew={() => { done.close(); getMissionStore().reset(); }}
          onClose={done.close}
        />
      )}
      {status !== 'awaiting-route' && <ReadoutBand cells={embedded ? simpleCells(state).filter(c => c.label !== 'Speed') : simpleCells(state)} fixCue={hydrated && cue.fix} />}
    </main>
  );
}
