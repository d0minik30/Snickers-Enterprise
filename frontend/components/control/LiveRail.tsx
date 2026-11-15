'use client';

import { liveProgress, projectedArrivalPercent, routeSentEvent, type OxygenCheck, type RerouteBlocker, type RerouteOption } from '@/components/control/controlModel';
import { RESERVE_PERCENT, formatEndPercent, lifeSupportAt, lifeTone } from '@/lib/mission/lifeSupport';
import { simpleCells } from '@/components/field/fieldModel';
import { Readout } from '@/components/shared/Readout';
import type { ControlView } from '@/lib/mission/control';
import type { FieldStatus } from '@/lib/mission/field';
import { SIGNAL_DELAY_MS, type MissionEvent } from '@/lib/mission/types';
import { formatClock, formatDistance } from '@/lib/nav/format';
import { useEmbedded } from '@/components/shared/embedded';
import styles from './control.module.css';

type Props = {
  view: ControlView;
  log: MissionEvent[];
  flagging: boolean;
  notice: RerouteBlocker | null;
  onFlag: () => void;
  onReplan: () => void;
  /** A reroute held back because it would end under the reserve: Control picks one of its options. */
  check: OxygenCheck | null;
  onChoose: (kind: RerouteOption['kind']) => void;
  onCancelCheck: () => void;
};

const OPTION_LABEL: Record<RerouteOption['kind'], string> = { around: 'GO AROUND', back: 'TURN BACK', anyway: 'SEND ANYWAY' };
const TONE_CLASS = { plain: styles.statusPlain, caution: styles.statusCaution, danger: styles.lifeDanger } as const;

const STATUS_TEXT: Record<FieldStatus, string> = {
  'awaiting-route': 'WAITING FOR ROUTE',
  ready: 'GOT THE ROUTE · NOT STARTED',
  moving: 'WALKING',
  holding: 'HOLDING',
  arrived: 'ARRIVED ✓',
};

const STATUS_TONE: Record<FieldStatus, string> = {
  'awaiting-route': styles.statusMuted,
  ready: styles.statusPlain,
  moving: styles.statusNominal,
  holding: styles.statusCaution,
  arrived: styles.statusNominal,
};

/**
 * The one rail in Live mode, read top to bottom: what Earth knows (never as if it were current)
 * and what Earth can do about the route.
 */
export function LiveRail({ view, log, flagging, notice, onFlag, onReplan, check, onChoose, onCancelCheck }: Props) {
  const { received } = view;
  const embedded = useEmbedded(); // inside Mission, Mars shows the numbers and the step line says the state
  const sent = routeSentEvent(log);
  const hasRoute = view.activeRoute !== null || view.pendingRoute !== null;
  const hasData = received.status !== 'awaiting-route';
  const progress = liveProgress(view);
  const ahead = view.estimatedNow ? view.estimatedNow.distM - received.distM : 0;
  const life = lifeSupportAt(received);
  const atArrival = projectedArrivalPercent(view);

  return (
    <aside className={`${styles.rail} ${styles.leftRail}`} aria-label="Live">
      <section className={styles.section} aria-label="What we know">
        <h2 className={styles.heading}><span>What we know</span></h2>
        <div data-testid="data-age" className={styles.dataAge}>
          WHAT YOU SEE HERE IS {formatClock(view.dataAgeMs)} OLD
        </div>

        {!embedded && (
          <div className={`${styles.travellerHead} ${styles.blockGap}`}>
            <span className={styles.travellerName}>{view.traveller === 'rover' ? 'RV-1 · ROVER' : 'EV-1 · ASTRONAUT'}</span>
            {hasData && <span className={`${styles.travellerStatus} ${STATUS_TONE[received.status]}`}>{STATUS_TEXT[received.status]}</span>}
          </div>
        )}

        {!hasData && (
          <p className={`${styles.noData} ${styles.blockGap}`}>
            NOTHING HEARD FROM MARS YET
            {sent && <> · FIRST NEWS IN {formatClock(Math.max(0, sent.tMs + 2 * SIGNAL_DELAY_MS - view.tMs))}</>}
          </p>
        )}

        {hasData && !embedded && (
          <div className={`${styles.liveCells} ${styles.blockGap}`}>
            {simpleCells(received).map(c => <Readout key={c.label} label={c.label} value={c.value} unit={c.unit} tone={c.tone} />)}
          </div>
        )}

        {hasData && progress && (
          <div className={styles.blockGap}>
            <div className={styles.heading}>
              <span>Progress</span>
              <span>{progress.leg}</span>
            </div>
            <div className={styles.progressTrack}><span style={{ width: `${progress.fraction * 100}%` }} /></div>
            <p className={styles.progressText}>{progress.text}</p>
          </div>
        )}

        {hasData && life && atArrival !== null && received.status !== 'arrived' && (
          <p className={`${styles.lifeLine} ${styles.blockGap}`} data-testid="live-life">
            {life.kind === 'oxygen' ? 'OXYGEN' : 'BATTERY'} {Math.round(life.percent)} % ·{' '}
            <span className={TONE_CLASS[lifeTone(atArrival)]}>≈ {formatEndPercent(atArrival)} AT ARRIVAL</span>
          </p>
        )}

        {hasData && !embedded && received.status === 'moving' && ahead > 1 && (
          <p className={`${styles.note} ${styles.blockGap}`}>
            By now they are probably about <span className={styles.noteValue}>{distanceText(ahead)}</span> further along.
          </p>
        )}
      </section>

      <section className={styles.actions} aria-label="Act">
        <h2 className={styles.heading}><span>Act</span></h2>
        {notice === 'too-late' && (
          <p data-testid="too-late" className={styles.tooLate} role="alert">TOO LATE TO CHANGE THE ROUTE · THEY WILL HAVE ARRIVED</p>
        )}
        {notice === 'too-close' && (
          <p data-testid="too-close" className={styles.tooLate} role="alert">
            TOO CLOSE · THEY REACH IT BEFORE A NEW ROUTE COULD ARRIVE · FLAG FURTHER AHEAD OR SEND HOLD
          </p>
        )}
        {check && <OxygenCheckCard check={check} battery={view.traveller === 'rover'} onChoose={onChoose} onCancel={onCancelCheck} />}
        <button
          type="button"
          data-testid="flag-hazard"
          className={styles.actionButton}
          aria-pressed={flagging}
          disabled={!hasRoute}
          onClick={onFlag}
        >
          {flagging ? 'CLICK THE MAP · ESC TO CANCEL' : 'MARK A DANGER ON THE MAP'}
        </button>
        <button type="button" data-testid="replan" className={styles.actionButton} disabled={!hasRoute} onClick={onReplan}>
          PLAN A NEW ROUTE FROM HERE
        </button>
        {!embedded && <p className={styles.sendNote}>New routes reach Mars in <span className={styles.sendDelay}>{formatClock(SIGNAL_DELAY_MS)}</span></p>}
      </section>
    </aside>
  );
}

/** The reroute would end under the reserve: the options, the app's pick marked. Nothing is sent until a click. */
function OxygenCheckCard({ check, battery, onChoose, onCancel }: {
  check: OxygenCheck; battery: boolean; onChoose: (kind: RerouteOption['kind']) => void; onCancel: () => void;
}) {
  const asked = check.options.find(o => o.kind === 'anyway') ?? check.options.find(o => o.kind === 'around');
  return (
    <div className={styles.oxygenCheck} data-testid="oxygen-check" role="alert">
      <p className={styles.oxygenTitle}>{battery ? 'BATTERY CHECK' : 'OXYGEN CHECK'}</p>
      <p className={styles.oxygenWhy}>
        {check.noneKeeps
          ? `No option keeps the ${RESERVE_PERCENT} % reserve. Highlighted: the one that leaves the most.`
          : `This route ends at ≈ ${asked ? formatEndPercent(asked.endPercent) : '—'} · reserve is ${RESERVE_PERCENT} %. Highlighted: recommended.`}
      </p>
      {check.options.map(o => (
        <button
          key={o.kind}
          type="button"
          data-testid={`oxygen-${o.kind}`}
          className={`${styles.actionButton} ${o.kind === check.pick ? styles.oxygenPick : ''}`}
          aria-label={`${OPTION_LABEL[o.kind]}, about ${formatEndPercent(o.endPercent)} at the end${o.kind === check.pick ? ', recommended' : ''}`}
          onClick={() => onChoose(o.kind)}
        >
          {OPTION_LABEL[o.kind]} · ≈ {formatEndPercent(o.endPercent)}
        </button>
      ))}
      <button type="button" className={styles.oxygenCancel} onClick={onCancel}>CANCEL</button>
    </div>
  );
}

function distanceText(m: number): string {
  const d = formatDistance(m);
  return `${d.value} ${d.unit}`;
}
