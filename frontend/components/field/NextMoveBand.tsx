import type { NextMoveView } from '@/components/field/fieldModel';
import { formatEndPercent, lifeTone, type LifeSupport } from '@/lib/mission/lifeSupport';
import { TurnArrow } from '@/components/shared/TurnArrow';
import { useEmbedded } from '@/components/shared/embedded';
import styles from './field.module.css';

const LOW_PERCENT = 25; // amber below this
const CRITICAL_PERCENT = 10; // red below this
const ARRIVAL_TONE = { plain: '', caution: styles.lifeLow, danger: styles.lifeCritical } as const;

/** Suit oxygen with the breathing rate behind it, or the rover's battery with its net draw. */
function LifeCell({ life, arrival }: { life: LifeSupport; arrival: number | null }) {
  const tone = life.percent < CRITICAL_PERCENT ? styles.lifeCritical : life.percent < LOW_PERCENT ? styles.lifeLow : styles.lifeOk;
  return (
    <div className={`${styles.sideCell} ${styles.lifeCell}`} data-testid="field-life-support" data-kind={life.kind}>
      <span className={styles.sideLabel}>{life.kind === 'oxygen' ? 'OXYGEN' : 'BATTERY'}</span>
      <span className={`${styles.sideValue} ${tone}`}>{life.percent.toFixed(1)}<span className={styles.lifeUnit}>%</span></span>
      <div className={styles.lifeTrack}><span className={tone} style={{ width: `${life.percent}%` }} /></div>
      <span className={styles.lifeNote}>
        {life.kind === 'oxygen' ? `${life.breathsPerMin} BREATHS/MIN` : `${life.netW > 0 ? '−' : '+'}${Math.abs(life.netW)} W`}
      </span>
      {arrival !== null && (
        <span className={`${styles.lifeNote} ${ARRIVAL_TONE[lifeTone(arrival)]}`} data-testid="field-life-arrival">
          ≈ {formatEndPercent(arrival)} AT END
        </span>
      )}
    </div>
  );
}

/** Top band: the next move on the left; oxygen or battery (and, on its own page, the heading) on the right. */
export function NextMoveBand({ view, life, arrival = null }: { view: NextMoveView | null; life: LifeSupport | null; arrival?: number | null }) {
  const embedded = useEmbedded();
  return (
    <section className={styles.nextMove} aria-label="Next move">
      <div className={styles.move} data-testid="field-next-move" aria-live="polite">
        {view && (
          <>
            <div className={styles.moveTop}>
              <span className={styles.arrow}><TurnArrow maneuver={view.maneuver} size={44} /></span>
              <span className={styles.moveDistance}>
                {view.distance.value}
                <span className={styles.moveUnit}>{view.distance.unit}</span>
              </span>
            </div>
            <div className={styles.moveText}>
              {view.text}
              <span className={styles.moveWaypoint}> · {view.waypoint}</span>
            </div>
          </>
        )}
      </div>
      <div className={styles.moveSide}>
        {life && <LifeCell life={life} arrival={arrival} />}
        {!embedded && (
          <div className={styles.sideCell}>
            <span className={styles.sideLabel}>HDG</span>
            <span className={styles.sideValue}>{view ? view.heading : '---°'}</span>
          </div>
        )}
      </div>
    </section>
  );
}
