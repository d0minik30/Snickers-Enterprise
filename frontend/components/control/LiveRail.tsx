'use client';

import { earthClock, liveProgress, marsClock, routeSentEvent } from '@/components/control/controlModel';
import { fieldBars, fieldCells } from '@/components/field/fieldModel';
import { Bar } from '@/components/shared/Bar';
import { Readout } from '@/components/shared/Readout';
import type { ControlView } from '@/lib/mission/control';
import type { FieldStatus } from '@/lib/mission/field';
import { SIGNAL_DELAY_MS, type MissionEvent } from '@/lib/mission/types';
import { formatClock, formatDistance, formatLat, formatLon } from '@/lib/nav/format';
import styles from './control.module.css';

type Props = {
  view: ControlView;
  log: MissionEvent[];
  flagging: boolean;
  tooLate: boolean;
  onFlag: () => void;
  onReplan: () => void;
};

const STATUS_TEXT: Record<FieldStatus, string> = {
  'awaiting-route': 'AWAITING ROUTE',
  ready: 'ROUTE RECEIVED · NOT STARTED',
  moving: 'MOVING',
  holding: 'HOLDING',
  arrived: 'ARRIVED',
};

const STATUS_TONE: Record<FieldStatus, string> = {
  'awaiting-route': styles.statusMuted,
  ready: styles.statusPlain,
  moving: styles.statusNominal,
  holding: styles.statusCaution,
  arrived: styles.statusNominal,
};

/** Left rail in Live mode: the field as Control last heard it, never as if it were current. */
export function LiveRail({ view, log, flagging, tooLate, onFlag, onReplan }: Props) {
  const { received } = view;
  const sent = routeSentEvent(log);
  const hasRoute = view.activeRoute !== null || view.pendingRoute !== null;
  const hasData = received.status !== 'awaiting-route';
  const progress = liveProgress(view);
  const ahead = view.estimatedNow ? view.estimatedNow.distM - received.distM : 0;

  return (
    <aside className={`${styles.rail} ${styles.leftRail}`} aria-label="Live">
      <div data-testid="data-age" className={styles.dataAge}>
        FIELD DATA IS {formatClock(view.dataAgeMs)} OLD
      </div>

      <section className={styles.section}>
        <div className={styles.travellerHead}>
          <span className={styles.travellerName}>{view.traveller === 'rover' ? 'RV-1 · ROVER' : 'EV-1 · ASTRONAUT'}</span>
          {hasData && <span className={`${styles.travellerStatus} ${STATUS_TONE[received.status]}`}>{STATUS_TEXT[received.status]}</span>}
        </div>
        {!hasData && (
          <p className={styles.noData}>
            NO FIELD DATA YET
            {sent && <> · FIRST SIGNAL IN {formatClock(Math.max(0, sent.tMs + 2 * SIGNAL_DELAY_MS - view.tMs))}</>}
          </p>
        )}
      </section>

      {hasData && (
        <>
          <section className={`${styles.section} ${styles.liveCells}`}>
            {fieldCells(received).map(c => <Readout key={c.label} label={c.label} value={c.value} unit={c.unit} tone={c.tone} />)}
            {fieldBars(received).map(b => <Bar key={b.label} label={b.label} value={b.value} unit={b.unit} fraction={b.fraction} />)}
          </section>

          {progress && (
            <section className={styles.section}>
              <div className={styles.heading}>
                <span>Progress</span>
                <span>{progress.leg}</span>
              </div>
              <div className={styles.progressTrack}><span style={{ width: `${progress.fraction * 100}%` }} /></div>
              <p className={styles.progressText}>{progress.text}</p>
            </section>
          )}

          {received.pos && (
            <section className={styles.section}>
              <h2 className={styles.heading}>Last received position</h2>
              <p className={styles.coords}>{formatLat(received.pos.lat)} &nbsp;{formatLon(received.pos.lon)}</p>
              <p className={styles.note}>
                Received {earthClock(view.tMs)} UTC · sent from Mars {marsClock(received.tMs).time}
              </p>
              {received.status === 'moving' && ahead > 1 && (
                <p className={styles.note}>
                  Estimated now: about <span className={styles.noteValue}>{distanceText(ahead)}</span> further along the route.
                </p>
              )}
            </section>
          )}
        </>
      )}

      <section className={styles.actions}>
        {tooLate && (
          <p data-testid="too-late" className={styles.tooLate} role="alert">TOO LATE TO REROUTE · TRAVELLER WILL HAVE ARRIVED</p>
        )}
        <button
          type="button"
          data-testid="flag-hazard"
          className={styles.actionButton}
          aria-pressed={flagging}
          disabled={!hasRoute}
          onClick={onFlag}
        >
          {flagging ? 'CLICK THE MAP · ESC TO CANCEL' : 'FLAG HAZARD ON MAP'}
        </button>
        <button type="button" data-testid="replan" className={styles.actionButton} disabled={!hasRoute} onClick={onReplan}>
          REPLAN FROM CURRENT POSITION
        </button>
        <p className={styles.sendNote}>New routes reach the field in <span className={styles.sendDelay}>{formatClock(SIGNAL_DELAY_MS)}</span></p>
      </section>
    </aside>
  );
}

function distanceText(m: number): string {
  const d = formatDistance(m);
  return `${d.value} ${d.unit}`;
}
