'use client';

import { FIX_TARGET_M, distanceText, fixPlan, marsClock, recommendationText, routeLetter, waypointLegs } from '@/components/control/controlModel';
import { Readout } from '@/components/shared/Readout';
import { useMissionTime } from '@/lib/mission/useMission';
import { SIGNAL_DELAY_MS, type TravellerKind } from '@/lib/mission/types';
import type { Route } from '@/lib/planner/types';
import styles from './control.module.css';

type Props = { routes: Route[]; selected: Route | undefined; traveller: TravellerKind };

const marsHHMM = (missionMs: number) => marsClock(missionMs).time.slice(0, 5);

/** Right rail in Plan mode: the selected route's legs, the photo fixes it needs and why route A is recommended. */
export function PlanDetailRail({ routes, selected, traveller }: Props) {
  // The traverse can start once the route has reached the field.
  const startMs = useMissionTime(1) + SIGNAL_DELAY_MS;

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
  const fixes = fixPlan(selected);

  return (
    <aside className={`${styles.rail} ${styles.rightRail}`} aria-label="Route details">
      <section className={styles.section}>
        <h2 className={styles.heading}>
          <span>Waypoints · route {letter}</span>
          <span>{legs.length} legs</span>
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

      <section className={styles.section}>
        <h2 className={styles.heading}>
          <span>Position fixes</span>
          <span>within ±{FIX_TARGET_M} m</span>
        </h2>
        <div className={styles.pair}>
          <Readout label="Photo fix every" value={distanceText(fixes.everyM).split(' ')[0]} unit={distanceText(fixes.everyM).split(' ')[1]} />
          <Readout label="Fixes on route" value={String(fixes.fixes)} />
        </div>
        <p className={styles.note}>
          No GPS on Mars. The crew dead-reckons and photographs the skyline; the localization engine matches it to
          the terrain. With no fixes, error would reach <span className={styles.noteValue}>±{Math.round(fixes.noFixErrorM)} m</span> by the end.
        </p>
        <p className={styles.note}>
          If the traverse starts when the route arrives: {marsHHMM(startMs)} at Jezero (local mean solar time).
        </p>
      </section>

      <section className={`${styles.section} ${styles.why}`}>
        <h2 className={styles.heading}>Why route A</h2>
        <p className={styles.whyText}>{recommendationText(routes, traveller)}</p>
      </section>
    </aside>
  );
}
