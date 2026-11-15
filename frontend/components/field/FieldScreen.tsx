'use client';

import dynamic from 'next/dynamic';
import { useMemo, useState, useSyncExternalStore } from 'react';
import { fieldBars, fieldCamera, fieldCells, fieldCue, fieldOverlays, latestUnacked, nextMoveView } from '@/components/field/fieldModel';
import { MessageStrip } from '@/components/field/MessageStrip';
import { NextMoveBand } from '@/components/field/NextMoveBand';
import { ReadoutBand } from '@/components/field/ReadoutBand';
import { CommsBar, LogSheet, ReportSheet, type FieldPanel } from '@/components/field/ReportComposer';
import { StatusBanner, StatusPanel } from '@/components/field/StatusPanel';
import { fieldStateAt } from '@/lib/mission/field';
import { getMissionStore, useMissionSnapshot, useMissionTime } from '@/lib/mission/useMission';
import { ScreenMenu } from '@/components/shared/ScreenMenu';
import styles from './field.module.css';

const MarsMap = dynamic(() => import('@/components/map/MarsMap'), { ssr: false });

const subscribeNever = () => () => {};

/** False in the static HTML and while hydrating, true afterwards. The mission log only exists in the browser. */
function useHydrated(): boolean {
  return useSyncExternalStore(subscribeNever, () => true, () => false);
}

export default function FieldScreen() {
  const hydrated = useHydrated();
  const snapshot = useMissionSnapshot();
  const t = useMissionTime();
  const state = useMemo(() => fieldStateAt(snapshot.log, t), [snapshot.log, t]);

  const overlays = useMemo(() => fieldOverlays(state), [state]);
  const [panel, setPanel] = useState<FieldPanel>('none');
  const [sheetHeight, setSheetHeight] = useState(0);
  // While a sheet covers the bottom of the map, keep the traveller in the part still showing.
  const camera = useMemo(() => fieldCamera(state, panel === 'none' ? 0 : sheetHeight), [state, panel, sheetHeight]);
  const cue = fieldCue(state);
  const notice = latestUnacked(state);
  const status = hydrated ? state.status : 'awaiting-route';

  const start = () => getMissionStore().append({ type: 'traverse-started', origin: 'field' });
  const photoFix = () => getMissionStore().append({ type: 'photo-fix', origin: 'field' });
  const ack = (targetId: string) => getMissionStore().append({ type: 'ack', origin: 'field', targetId });
  const report = (text: string) => getMissionStore().append({ type: 'report', origin: 'field', text });

  return (
    <main className={styles.screen} data-testid="field-status" data-status={status}>
      <NextMoveBand view={hydrated ? nextMoveView(state) : null} />
      {hydrated && <MessageStrip notice={notice} nowMs={t} onAck={ack} />}
      {hydrated && <StatusBanner status={state.status} />}
      <div className={styles.mapArea}>
        {hydrated && <MarsMap overlays={overlays} camera={camera} />}
        {hydrated && (state.status === 'moving' || state.status === 'holding') && (
          <button type="button" data-testid="field-photo-fix" className={styles.fixButton} onClick={photoFix}>
            PHOTO FIX
            <span className={styles.fixButtonNote}>skyline → position</span>
          </button>
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
        {hydrated && <StatusPanel state={state} onStart={start} />}
        {/* After the panel in the tree, so it stays on top of the waiting screen too. */}
        <ScreenMenu className={styles.menuButton} label="Menu: all screens">
          <svg width="20" height="16" viewBox="0 0 20 16" aria-hidden="true">
            <path d="M0 1H20M0 8H20M0 15H20" stroke="currentColor" strokeWidth="2" />
          </svg>
        </ScreenMenu>
        {hydrated && panel === 'compose' && <ReportSheet onSend={report} onClose={() => setPanel('none')} onHeight={setSheetHeight} />}
        {hydrated && panel === 'log' && <LogSheet state={state} onAck={ack} onClose={() => setPanel('none')} onHeight={setSheetHeight} />}
      </div>
      {hydrated && <CommsBar state={state} panel={panel} onPanel={setPanel} />}
      <ReadoutBand cells={fieldCells(state)} bars={fieldBars(state)} fixCue={hydrated && cue.fix} />
    </main>
  );
}
