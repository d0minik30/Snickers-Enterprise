import type { NextMoveView } from '@/components/field/fieldModel';
import { TurnArrow } from '@/components/shared/TurnArrow';
import styles from './field.module.css';

/** Top band: the next move on the left, heading and waypoint count on the right. */
export function NextMoveBand({ view }: { view: NextMoveView | null }) {
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
        <div className={styles.sideCell}>
          <span className={styles.sideLabel}>HDG</span>
          <span className={styles.sideValue}>{view ? view.heading : '---°'}</span>
        </div>
        <div className={styles.sideCell}>
          <span className={styles.sideLabel}>WAYPOINT</span>
          <span className={styles.sideValue}>
            {view ? `${view.waypointNumber} / ${view.waypointTotal}` : '- / -'}
          </span>
        </div>
      </div>
    </section>
  );
}
