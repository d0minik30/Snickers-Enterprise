'use client';

import { distanceText, marsClock, passesDuring, recommendationText, routeLetter, waypointLegs } from '@/components/control/controlModel';
import { Readout } from '@/components/shared/Readout';
import { useMissionTime } from '@/lib/mission/useMission';
import { SIGNAL_DELAY_MS, type TravellerKind } from '@/lib/mission/types';
import type { Route } from '@/lib/planner/types';
import styles from './control.module.css';

type Props = { routes: Route[]; selected: Route | undefined; traveller: TravellerKind };

const QUALITY_TEXT = { overhead: 'overhead', low: 'low angle' } as const;
const marsHHMM = (missionMs: number) => marsClock(missionMs).time.slice(0, 5);

/** Right rail in Plan mode: the selected route's legs, its satellite coverage and why route A is recommended. */
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
  const coverage = passesDuring(selected, traveller, startMs);

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
          <span>Satellite passes</span>
          <span>Mars time</span>
        </h2>
        {coverage.passes.length > 0 ? (
          <table className={styles.table}>
            <thead className={styles.srOnly}>
              <tr><th>Satellite</th><th>Time</th><th>Elevation</th></tr>
            </thead>
            <tbody>
              {coverage.passes.map(p => (
                <tr key={p.tMs}>
                  <td className={styles.passName}>{p.satellite}</td>
                  <td className={styles.num}>{marsHHMM(p.tMs)}</td>
                  <td className={`${styles.num} ${p.quality === 'overhead' ? styles.passGood : styles.passLow}`}>{QUALITY_TEXT[p.quality]}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <p className={styles.note}>No pass during this traverse.</p>
        )}
        <div className={styles.pair}>
          <Readout label="Longest gap" value={String(Math.round(coverage.longestGapMs / 60_000))} unit="min" />
          <Readout label="Worst drift" value={`±${Math.round(coverage.worstDriftM)}`} unit="m" />
        </div>
        <p className={styles.note}>
          If the traverse starts when the route arrives, at {marsHHMM(startMs)} Mars time.
        </p>
      </section>

      <section className={`${styles.section} ${styles.why}`}>
        <h2 className={styles.heading}>Why route A</h2>
        <p className={styles.whyText}>{recommendationText(routes, traveller)}</p>
      </section>
    </aside>
  );
}
