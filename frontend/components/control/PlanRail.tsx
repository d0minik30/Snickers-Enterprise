'use client';

import { riskTone, routeLetter, slopeTone, summarizeRoute } from '@/components/control/controlModel';
import type { PlanDraft } from '@/components/control/usePlanDraft';
import { Readout } from '@/components/shared/Readout';
import { useEmbedded } from '@/components/shared/embedded';
import { SIGNAL_DELAY_MS, type TravellerKind } from '@/lib/mission/types';
import { formatClock, formatLat, formatLon } from '@/lib/nav/format';
import { MIN_ROUTE_M } from '@/lib/planner';
import type { LatLon, Route } from '@/lib/planner/types';
import shared from '@/components/shared/shared.module.css';
import styles from './control.module.css';

type Props = { draft: PlanDraft; inProgress: boolean; onSend: () => void };

const TRAVELLERS: { kind: TravellerKind; label: string }[] = [
  { kind: 'astronaut', label: 'ASTRONAUT' },
  { kind: 'rover', label: 'ROVER' },
];

/** Left rail in Plan mode: who travels, between which points, by which route, and the send button. */
export function PlanRail({ draft, inProgress, onSend }: Props) {
  const embedded = useEmbedded();
  return (
    <aside className={`${styles.rail} ${styles.leftRail}`} aria-label="Plan">
      <section className={styles.section}>
        <h2 className={styles.heading}>Who goes</h2>
        <div className={styles.segmented} role="group" aria-label="Traveller">
          {TRAVELLERS.map(({ kind, label }) => (
            <button
              key={kind}
              type="button"
              data-testid={`plan-traveller-${kind}`}
              aria-pressed={draft.traveller === kind}
              onClick={() => draft.setTraveller(kind)}
            >
              {label}
            </button>
          ))}
        </div>
      </section>

      <section className={`${styles.section} ${styles.ends}`}>
        <EndCell which="start" pos={draft.start} draft={draft} />
        <EndCell which="end" pos={draft.end} draft={draft} />
      </section>

      <h2 className={`${styles.heading} ${styles.listHeading}`}>Pick a route</h2>
      {draft.tooClose ? (
        <div className={styles.tooClose}>
          <p className={styles.tooCloseTitle}>START AND END ARE TOO CLOSE</p>
          <p className={styles.note}>Set them at least {MIN_ROUTE_M} m apart to plan a route.</p>
        </div>
      ) : (
        <div className={styles.cards}>
          {draft.routes.map(route => (
            <RouteCard
              key={route.profile}
              route={route}
              traveller={draft.traveller}
              selected={route.profile === draft.selected}
              onSelect={() => draft.select(route.profile)}
            />
          ))}
        </div>
      )}

      <section className={styles.sendSection}>
        {inProgress ? (
          <p className={styles.inProgress}>MISSION UNDER WAY · START OVER TO PLAN A NEW ONE</p>
        ) : (
          <>
            <button type="button" data-testid="send-route" className={styles.sendButton} disabled={draft.tooClose} onClick={onSend}>
              SEND ROUTE {routeLetter(draft.selected)} TO MARS ▲
            </button>
            <p className={styles.sendNote}>
              Reaches Mars in <span className={styles.sendDelay}>{formatClock(SIGNAL_DELAY_MS)}</span>
            </p>
          </>
        )}
        {!embedded && (
          <a href="/field/" target="_blank" rel="noreferrer" className={styles.openField} data-testid="open-field">
            OPEN THE CREW VIEW IN A NEW WINDOW ↗
          </a>
        )}
      </section>
    </aside>
  );
}

/** A Readout-style cell with its arm button in the label row, so the coordinates get the full width. */
function EndCell({ which, pos, draft }: { which: 'start' | 'end'; pos: LatLon; draft: PlanDraft }) {
  const armed = draft.arming === which;
  return (
    <div className={styles.endCell} data-armed={armed}>
      <div className={styles.endHead}>
        <span className={shared.label}>{which === 'start' ? 'Start' : 'End'}</span>
        <button
          type="button"
          data-testid={`plan-arm-${which}`}
          aria-pressed={armed}
          aria-label={armed ? `Cancel setting the ${which}` : `Set the ${which} on the map`}
          className={styles.armButton}
          onClick={() => draft.arm(which)}
        >
          {armed ? 'CANCEL' : 'SET ON MAP'}
        </button>
      </div>
      <span className={`${shared.value} ${styles.endValue}`}>{formatLat(pos.lat)}{' '}{formatLon(pos.lon)}</span>
    </div>
  );
}

type CardProps = { route: Route; traveller: TravellerKind; selected: boolean; onSelect: () => void };

function RouteCard({ route, traveller, selected, onSelect }: CardProps) {
  const s = summarizeRoute(route, traveller);
  return (
    <button
      type="button"
      data-testid={`route-card-${s.profile}`}
      aria-pressed={selected}
      className={styles.card}
      onClick={onSelect}
    >
      <span className={styles.cardLetter}>{s.letter}</span>
      <span className={styles.cardBody}>
        <span className={styles.cardHead}>
          <span className={styles.cardTitle}>{s.title}</span>
          <span className={`${styles.cardRisk} ${shared[riskTone(s.risk)]}`}>{s.riskLabel}</span>
        </span>
        <span className={styles.cardStats}>
          <Readout label="Length" value={s.length} />
          <Readout label="Time" value={s.time} />
          <Readout label="Max slope" value={s.maxSlope} tone={slopeTone(route.maxSlopeDeg)} />
        </span>
      </span>
    </button>
  );
}
