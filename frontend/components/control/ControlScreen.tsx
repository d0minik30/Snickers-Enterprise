'use client';

import dynamic from 'next/dynamic';
import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { ElevationProfile } from '@/components/control/ElevationProfile';
import { LiveRail } from '@/components/control/LiveRail';
import { PlanRail } from '@/components/control/PlanRail';
import { SignalTimeline } from '@/components/control/SignalTimeline';
import { TopBar } from '@/components/control/TopBar';
import {
  buildReroute, liveOverlays, newestRoute, planFitPoints, planOverlays, rerouteBlocker, routeSentEvent, type RerouteBlocker,
} from '@/components/control/controlModel';
import { buildTimeline } from '@/components/control/timelineModel';
import { usePlanDraft, type PlanDraft } from '@/components/control/usePlanDraft';
import type { MapCamera } from '@/components/map/overlays';
import { controlViewAt } from '@/lib/mission/control';
import { getMissionStore, useMissionSnapshot, useMissionTime } from '@/lib/mission/useMission';
import type { MissionEvent } from '@/lib/mission/types';
import { DEFAULT_END, DEFAULT_START, DESTINATION, FLAG_RADIUS_M, PRESET_HAZARDS } from '@/lib/planner';
import { MissionComplete } from '@/components/mission/MissionComplete';
import { useMissionComplete } from '@/components/mission/useMissionComplete';
import { useEmbedded } from '@/components/shared/embedded';
import { SIGNAL_DELAY_MS } from '@/lib/mission/types';
import type { LatLon } from '@/lib/planner/types';
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
  const sent = routeSentEvent(snapshot.log);
  // No tabs: Control plans until a route is sent, then watches until the mission is reset.
  const mode: 'plan' | 'live' = sent ? 'live' : 'plan';

  // A reset, from this window or another, brings Control back to a fresh plan.
  const [epoch, setEpoch] = useState(snapshot.epoch);
  if (epoch !== snapshot.epoch) {
    setEpoch(snapshot.epoch);
    draft.reset();
  }

  const send = () => {
    const route = draft.routes.find(r => r.profile === draft.selected);
    if (!route || sent) return;
    getMissionStore().append({ type: 'route-sent', origin: 'control', traveller: draft.traveller, route, hazards: PRESET_HAZARDS });
  };

  const embedded = useEmbedded();
  return (
    <main
      data-testid="control-screen"
      data-mode={hydrated ? mode : undefined}
      className={`${styles.screen} ${styles.noRight} ${embedded ? styles.noTop : ''}`}
    >
      {!embedded && <TopBar />}
      {hydrated && (mode === 'plan'
        ? <PlanMode draft={draft} inProgress={false} onSend={send} />
        : <LiveMode log={snapshot.log} />)}
      {hydrated && <EarthHearsDone />}
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
    </>
  );
}

const TOO_LATE_SHOW_MS = 6000; // real time the "too late" notice stays up

/** Live mode: one rail (what we know, act), the map and the signal timeline. */
function LiveMode({ log }: { log: MissionEvent[] }) {
  const t = useMissionTime();
  const view = useMemo(() => controlViewAt(log, t), [log, t]);
  const timeline = useMemo(() => buildTimeline(view), [view]);
  const embedded = useEmbedded();
  const overlays = useMemo(() => liveOverlays(view, { quiet: embedded }), [view, embedded]);
  const [flagging, setFlagging] = useState(false);
  const [notice, setNotice] = useState<RerouteBlocker | null>(null);
  const newest = newestRoute(view);
  // The map fits the newest route; panning or zooming by hand detaches it until RECENTER (see MarsMap).
  const camera = useMemo<MapCamera>(() => {
    if (!newest) return { mode: 'fit', points: [DEFAULT_START, DEFAULT_END] };
    return { mode: 'fit', points: planFitPoints(newest, newest.points[0], newest.points[newest.points.length - 1]) };
  }, [newest]);

  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(null), TOO_LATE_SHOW_MS);
    return () => clearTimeout(timer);
  }, [notice]);

  useEffect(() => {
    if (!flagging) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setFlagging(false); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [flagging]);

  /** Works out and sends a new route; reads the view at this moment, not the last render. */
  const reroute = useCallback((center: LatLon | null) => {
    const store = getMissionStore();
    const current = controlViewAt(store.getSnapshot().log, store.now());
    const hazard = center && { id: `flag-${crypto.randomUUID().slice(0, 8)}`, center, radiusM: FLAG_RADIUS_M, label: 'Flagged', source: 'control' as const };
    const blocked = rerouteBlocker(current, hazard);
    const result = blocked ? null : buildReroute(current, hazard);
    if (!result) return setNotice(blocked ?? 'too-late');
    setNotice(null);
    store.append({ type: 'route-changed', origin: 'control', reason: center ? 'hazard' : 'replan', route: result.route, hazards: result.hazards });
  }, []);

  const onMapClick = (p: LatLon) => {
    if (!flagging) return;
    setFlagging(false);
    reroute(p);
  };

  return (
    <>
      <LiveRail
        view={view}
        log={log}
        flagging={flagging}
        notice={notice}
        onFlag={() => setFlagging(f => !f)}
        onReplan={() => reroute(null)}
      />
      <div className={styles.mapArea}>
        <MarsMap overlays={overlays} camera={camera} onMapClick={onMapClick} armed={flagging} />
        {flagging && <div className={styles.mapHint} role="status">CLICK THE MAP TO FLAG A HAZARD · ESC TO CANCEL</div>}
      </div>
      <SignalTimeline timeline={timeline} />
    </>
  );
}

/** On its own page, Control shows "mission complete" once the news reaches Earth (11:20 after arrival). */
function EarthHearsDone() {
  const embedded = useEmbedded();
  const snapshot = useMissionSnapshot();
  const t = useMissionTime(2);
  const done = useMissionComplete(snapshot.log, t - SIGNAL_DELAY_MS, snapshot.epoch);
  if (embedded || !done.show || !done.summary) return null;
  return (
    <MissionComplete
      summary={done.summary}
      place={DESTINATION.name}
      note="The news just reached Earth. The crew arrived 11:20 ago."
      onNew={() => { done.close(); getMissionStore().reset(); }}
      onClose={done.close}
    />
  );
}
