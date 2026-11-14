'use client';

import { earthClock } from '@/components/control/controlModel';
import type { Timeline, TimelineSignal } from '@/components/control/timelineModel';
import styles from './control.module.css';

const EARTH_Y = 30; // % of the plot height; the space above holds two rows of labels
const MARS_Y = 76;
const LABEL_ROW_PX = 11;
const LABEL_CLEARANCE = 0.06; // labels closer than this share of the window go on separate rows
const TICK_LABEL_Y = 97;
const TICK_EVERY_MS = 10 * 60_000;

/**
 * Two lanes, Earth above and Mars below; each signal is a sloped line from where it was sent to where it lands.
 * Everything is placed in percentages, so the SVG stretches with the strip without distorting text.
 */
export function SignalTimeline({ timeline }: { timeline: Timeline }) {
  const { fromMs, toMs, nowMs } = timeline;
  const x = (t: number) => `${((t - fromMs) / (toMs - fromMs)) * 100}%`;
  const rows = labelRows(timeline);
  const ticks: number[] = [];
  for (let t = Math.ceil(fromMs / TICK_EVERY_MS) * TICK_EVERY_MS; t <= toMs; t += TICK_EVERY_MS) ticks.push(t);

  return (
    <section className={styles.strip} aria-label="Signal timeline">
      <h2 className={styles.stripTitle}>Signal timeline</h2>
      <div className={styles.laneLabels} aria-hidden="true">
        <span style={{ top: `${EARTH_Y}%` }}>EARTH</span>
        <span style={{ top: `${MARS_Y}%` }}>MARS</span>
      </div>
      <div className={styles.timeline}>
        <svg data-testid="signal-timeline" className={styles.timelineSvg} role="img" aria-label="Signals between Earth and Mars over the last 40 minutes and the next 20">
          <rect x={x(nowMs)} y="0" width={x(fromMs + (toMs - nowMs))} height="100%" className={styles.tlFuture} />
          {ticks.map(t => (
            <g key={t}>
              <line x1={x(t)} x2={x(t)} y1={`${EARTH_Y}%`} y2={`${MARS_Y}%`} className={styles.tlTick} />
              <text x={x(t)} y={`${TICK_LABEL_Y}%`} className={styles.tlTickLabel}>{earthClock(t).slice(0, 5)}</text>
            </g>
          ))}
          <line x1="0" x2="100%" y1={`${EARTH_Y}%`} y2={`${EARTH_Y}%`} className={styles.tlLane} />
          <line x1="0" x2="100%" y1={`${MARS_Y}%`} y2={`${MARS_Y}%`} className={styles.tlLane} />


          {/* A nested svg clips signals that started before the window to the plot area. */}
          <svg x="0" y="0" width="100%" height="100%" overflow="hidden">
            {timeline.signals.map(s => <Signal key={s.id} s={s} x={x} nowMs={nowMs} row={rows.get(s.id) ?? 0} />)}
          </svg>

          {/* The NOW tag sits at the foot, over the time axis, so it never hides a signal label. */}
          <line x1={x(nowMs)} x2={x(nowMs)} y1="0" y2="100%" className={styles.tlNow} />
          <svg x={x(nowMs)} y="100%" overflow="visible">
            <rect x="-17" y="-14" width="34" height="15" className={styles.tlNowTag} />
            <text x="0" y="-3" className={styles.tlNowText}>NOW</text>
          </svg>
        </svg>
      </div>
    </section>
  );
}

/** Where a signal's label is anchored on the Earth lane: where it leaves (up) or lands (down). */
const labelAt = (s: TimelineSignal) => (s.dir === 'up' ? s.sentMs : s.arrivesMs);

/** Row 0 or 1 for each labelled signal, alternating whenever one would print over the one before it. */
function labelRows({ signals, fromMs, toMs }: Timeline): Map<string, number> {
  const rows = new Map<string, number>();
  const minGapMs = (toMs - fromMs) * LABEL_CLEARANCE;
  let last: { atMs: number; row: number } | null = null;
  for (const s of signals.filter(x => x.label).sort((a, b) => labelAt(a) - labelAt(b))) {
    const row: number = last && labelAt(s) - last.atMs < minGapMs ? 1 - last.row : 0;
    rows.set(s.id, row);
    last = { atMs: labelAt(s), row };
  }
  return rows;
}

function Signal({ s, x, nowMs, row }: { s: TimelineSignal; x: (t: number) => string; nowMs: number; row: number }) {
  const fromY = s.dir === 'up' ? EARTH_Y : MARS_Y;
  const toY = s.dir === 'up' ? MARS_Y : EARTH_Y;
  const cls = { telemetry: styles.tlTelemetry, nominal: styles.tlNominal, caution: styles.tlCaution }[s.tone];
  const label = s.label && (
    <text
      x={x(labelAt(s))}
      y={`${EARTH_Y}%`}
      dy={-4 - row * LABEL_ROW_PX}
      // Uplink labels run right from where they leave Earth, downlink labels end where they land,
      // so a reply and the next order sent just after it do not print on top of each other.
      textAnchor={s.dir === 'up' ? 'start' : 'end'}
      className={`${styles.tlLabel} ${cls}`}
    >
      {s.label}
    </text>
  );

  if (s.arrivesMs > nowMs && s.sentMs <= nowMs) {
    // In transit: solid to where it is now, a dot there, dashed for the rest of the way.
    const f = (nowMs - s.sentMs) / (s.arrivesMs - s.sentMs);
    const nowY = fromY + (toY - fromY) * f;
    return (
      <g data-signal={s.dir}>
        <line x1={x(s.sentMs)} y1={`${fromY}%`} x2={x(nowMs)} y2={`${nowY}%`} className={cls} />
        <line x1={x(nowMs)} y1={`${nowY}%`} x2={x(s.arrivesMs)} y2={`${toY}%`} className={`${cls} ${styles.tlDashed}`} />
        <circle cx={x(nowMs)} cy={`${nowY}%`} r="3.5" className={styles.tlDot} />
        {label}
      </g>
    );
  }
  return (
    <g data-signal={s.dir}>
      <line x1={x(s.sentMs)} y1={`${fromY}%`} x2={x(s.arrivesMs)} y2={`${toY}%`} className={cls} />
      {label}
    </g>
  );
}
