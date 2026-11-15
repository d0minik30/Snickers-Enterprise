'use client';

import { distanceText, recommendationText, routeLetter, waypointLegs } from '@/components/control/controlModel';
import type { TravellerKind } from '@/lib/mission/types';
import type { Route } from '@/lib/planner/types';
import styles from './control.module.css';

type Props = { routes: Route[]; selected: Route | undefined; traveller: TravellerKind };

/** Right rail in Plan mode: why route A is suggested and the selected route's parts. */
export function PlanDetailRail({ routes, selected, traveller }: Props) {
  if (!selected) {
    return (
      <aside className={`${styles.rail} ${styles.rightRail}`} aria-label="Route details">
        <section className={styles.section}>
          <h2 className={styles.heading}>Waypoints</h2>
          <p className={styles.note}>No route planned.</p>
        </section>
      </aside>
    );
  }

  const letter = routeLetter(selected.profile);
  const legs = waypointLegs(selected);

  return (
    <aside className={`${styles.rail} ${styles.rightRail}`} aria-label="Route details">
      <section className={`${styles.section} ${styles.why}`}>
        <h2 className={styles.heading}>Why we suggest route A</h2>
        <p className={styles.whyText}>{recommendationText(routes, traveller)}</p>
      </section>

      <section className={styles.section}>
        <h2 className={styles.heading}>
          <span>Route {letter}, step by step</span>
          <span>{legs.length} parts</span>
        </h2>
        <table className={styles.table}>
          <thead className={styles.srOnly}>
            <tr><th>Number</th><th>Name</th><th>Leg</th><th>Max slope</th></tr>
          </thead>
          <tbody>
            {legs.map(leg => (
              <tr key={leg.number}>
                <td className={styles.wpNumber}>{leg.isEnd ? '■' : leg.number}</td>
                <td className={styles.wpName}>{leg.name}</td>
                <td className={styles.num}>{distanceText(leg.lengthM)}</td>
                <td className={styles.num}>{Math.round(leg.maxSlopeDeg)}°</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

    </aside>
  );
}
