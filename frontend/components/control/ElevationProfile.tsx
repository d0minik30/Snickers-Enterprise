'use client';

import { routeLetter } from '@/components/control/controlModel';
import { cumulativeM } from '@/lib/nav/geo';
import type { Route } from '@/lib/planner/types';
import styles from './control.module.css';

// The SVG is drawn in a 1000 × 100 box and stretched to the chart area; the labels are HTML placed in percent.
const W = 1000;
const H = 100;
const HEADROOM = 0.12; // share of the elevation range left free above and below the line

type Props = { route: Route | undefined };

/** Bottom strip in Plan mode: elevation along the selected route, with its waypoints. */
export function ElevationProfile({ route }: Props) {
  if (!route || route.points.length < 2) {
    return (
      <div className={styles.strip}>
        <div className={styles.stripTitle}>Elevation</div>
      </div>
    );
  }

  const cum = cumulativeM(route.points);
  const total = route.lengthM;
  const lo = Math.min(...route.elevationM);
  const hi = Math.max(...route.elevationM);
  const pad = Math.max(1, hi - lo) * HEADROOM;
  const x = (d: number) => (d / total) * W;
  const y = (e: number) => H - ((e - (lo - pad)) / (hi - lo + 2 * pad)) * H;
  const line = route.elevationM.map((e, i) => `${i === 0 ? 'M' : 'L'}${x(cum[i]).toFixed(1)} ${y(e).toFixed(2)}`).join('');
  const area = `${line}L${W} ${H}L0 ${H}Z`;
  const pct = (d: number) => `${(d / total) * 100}%`;
  const ticks = distanceTicks(total);

  return (
    <div className={styles.strip}>
      <div className={styles.stripTitle}>Elevation · route {routeLetter(route.profile)}</div>
      <div className={styles.chart}>
        <svg className={styles.chartSvg} viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" aria-hidden="true">
          <path className={styles.chartGuide} d={`M0 ${y(hi).toFixed(2)}H${W}M0 ${y(lo).toFixed(2)}H${W}`} />
          {route.waypoints.slice(0, -1).map(w => (
            <path key={w.distM} className={styles.chartTick} d={`M${x(w.distM).toFixed(1)} 0V${H}`} />
          ))}
          <path className={styles.chartArea} d={area} />
          <path className={styles.chartLine} d={line} />
        </svg>
        {route.waypoints.slice(0, -1).map((w, i) => (
          <span key={w.distM} className={styles.chartWaypoint} style={{ left: pct(w.distM) }}>{i + 1}</span>
        ))}
        <span className={styles.chartElevation} style={{ top: `${y(hi)}%` }}>{elevationText(hi)}</span>
        <span className={styles.chartElevation} style={{ top: `${y(lo)}%` }}>{elevationText(lo)}</span>
        {ticks.map(t => (
          <span key={t} className={styles.chartDistance} style={{ left: pct(t) }}>{t === 0 ? '0' : (t / 1000).toFixed(1)}</span>
        ))}
        <span className={`${styles.chartDistance} ${styles.chartDistanceEnd}`}>{(total / 1000).toFixed(2)} km</span>
      </div>
    </div>
  );
}

/** '−2495 m', with a true minus sign. */
function elevationText(m: number): string {
  return `${String(Math.round(m)).replace('-', '−')} m`;
}

/** Whole-kilometre ticks (half-kilometre on short routes), leaving room for the end label. */
function distanceTicks(totalM: number): number[] {
  const step = totalM < 2000 ? 500 : 1000;
  const ticks: number[] = [];
  for (let d = 0; d < totalM * 0.9; d += step) ticks.push(d);
  return ticks;
}
