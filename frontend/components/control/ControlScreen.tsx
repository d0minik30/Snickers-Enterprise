'use client';

import dynamic from 'next/dynamic';
import { useMemo, useState, useSyncExternalStore } from 'react';
import { ElevationProfile } from '@/components/control/ElevationProfile';
import { PlanDetailRail } from '@/components/control/PlanDetailRail';
import { PlanRail } from '@/components/control/PlanRail';
import { TopBar, type ControlMode } from '@/components/control/TopBar';
import { earthClock, planFitPoints, planOverlays, routeLetter, routeSentEvent, type RouteSentEvent } from '@/components/control/controlModel';
import { usePlanDraft, type PlanDraft } from '@/components/control/usePlanDraft';
import type { MapCamera } from '@/components/map/overlays';
import { getMissionStore, useMissionSnapshot, useMissionTime } from '@/lib/mission/useMission';
import { SIGNAL_DELAY_MS } from '@/lib/mission/types';
import { formatClock } from '@/lib/nav/format';
import { PRESET_HAZARDS } from '@/lib/planner';
import styles from './control.module.css';

const MarsMap = dynamic(() => import('@/components/map/MarsMap'), { ssr: false });

const subscribeNever = () => () => {};

/** False in the static HTML and while hydrating, true afterwards. The mission log only exists in the browser. */
function useHydrated(): boolean {
  return useSyncExternalStore(subscribeNever, () => true, () => false);
}

export default function ControlScreen() {
  const hydrated = useHydrated();
  const snapshot = useMissionSnapshot();
  const draft = usePlanDraft();
  const [chosenMode, setChosenMode] = useState<ControlMode | null>(null);
  const sent = routeSentEvent(snapshot.log);
  const mode: ControlMode = chosenMode ?? (sent ? 'live' : 'plan');

  // A reset, from this window or another, brings Control back to a fresh plan.
  const [epoch, setEpoch] = useState(snapshot.epoch);
  if (epoch !== snapshot.epoch) {
    setEpoch(snapshot.epoch);
    setChosenMode(null);
    draft.reset();
  }

  const send = () => {
    const route = draft.routes.find(r => r.profile === draft.selected);
    if (!route || sent) return;
    getMissionStore().append({ type: 'route-sent', origin: 'control', traveller: draft.traveller, route, hazards: PRESET_HAZARDS });
    setChosenMode('live');
  };

  return (
    <main className={styles.screen}>
      <TopBar mode={hydrated ? mode : null} onMode={setChosenMode} />
      {hydrated && (mode === 'plan'
        ? <PlanMode draft={draft} inProgress={sent !== undefined} onSend={send} />
        : <LivePlaceholder sent={sent} />)}
    </main>
  );
}

function PlanMode({ draft, inProgress, onSend }: { draft: PlanDraft; inProgress: boolean; onSend: () => void }) {
  const { routes, selected, start, end } = draft;
  const route = routes.find(r => r.profile === selected);
  const overlays = useMemo(() => planOverlays(routes, selected, PRESET_HAZARDS, start, end), [routes, selected, start, end]);
  const camera = useMemo<MapCamera>(() => ({ mode: 'fit', points: planFitPoints(route, start, end) }), [route, start, end]);

  return (
    <>
      <PlanRail draft={draft} inProgress={inProgress} onSend={onSend} />
      <div className={styles.mapArea}>
        <MarsMap overlays={overlays} camera={camera} onMapClick={draft.placeAt} armed={draft.arming !== null} />
        {draft.arming && (
          <div className={styles.mapHint} role="status">
            CLICK THE MAP TO SET THE {draft.arming === 'start' ? 'START' : 'END'} · ESC TO CANCEL
          </div>
        )}
      </div>
      <ElevationProfile route={route} />
      <PlanDetailRail routes={routes} selected={route} traveller={draft.traveller} />
    </>
  );
}

/** Stands in for Live mode until it is built: shows the sent route crossing the delay. */
function LivePlaceholder({ sent }: { sent: RouteSentEvent | undefined }) {
  const t = useMissionTime();
  if (!sent) {
    return (
      <section className={styles.live} aria-label="Live">
        <p className={styles.liveTitle}>NO ROUTE SENT</p>
        <p className={styles.liveNote}>Plan a route and send it to the field.</p>
      </section>
    );
  }
  const arrivesMs = sent.tMs + SIGNAL_DELAY_MS;
  const inTransit = t < arrivesMs;
  const letter = routeLetter(sent.route.profile);
  return (
    <section className={styles.live} aria-label="Live" data-testid="live-placeholder">
      <p className={styles.liveTitle}>{inTransit ? `ROUTE ${letter} IN TRANSIT TO FIELD` : `ROUTE ${letter} DELIVERED TO FIELD`}</p>
      {inTransit
        ? <p className={styles.liveCountdown}>ARRIVES IN {formatClock(arrivesMs - t)}</p>
        : <p className={`${styles.liveCountdown} ${styles.liveDelivered}`}>ARRIVED {earthClock(arrivesMs)} UTC</p>}
      <p className={styles.liveNote}>Sent {earthClock(sent.tMs)} UTC · one-way delay {formatClock(SIGNAL_DELAY_MS)}</p>
    </section>
  );
}
