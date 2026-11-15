'use client';

import { recommendationText, riskTone, routeLetter, slopeTone, summarizeRoute } from '@/components/control/controlModel';
import type { PlanDraft } from '@/components/control/usePlanDraft';
import { Readout } from '@/components/shared/Readout';
import { useEmbedded } from '@/components/shared/embedded';
import { formatEndPercent, lifeTone, routeEndPercent } from '@/lib/mission/lifeSupport';
import { SIGNAL_DELAY_MS, type TravellerKind } from '@/lib/mission/types';
import { formatClock } from '@/lib/nav/format';
import { MIN_ROUTE_M } from '@/lib/planner';
import type { Route } from '@/lib/planner/types';
import shared from '@/components/shared/shared.module.css';
import styles from './control.module.css';

type Props = { draft: PlanDraft; inProgress: boolean; onSend: () => void };

const TRAVELLERS: { kind: TravellerKind; label: string }[] = [
  { kind: 'astronaut', label: 'ASTRONAUT' },
  { kind: 'rover', label: 'ROVER' },
];

/** Left rail in Plan mode, everything in one column: who goes, the routes and why A, moving start or end, send. */
export function PlanRail({ draft, inProgress, onSend }: Props) {
  const embedded = useEmbedded();
  const chosen = draft.routes.find(r => r.profile === draft.selected);
  const runsOut = chosen !== undefined && routeEndPercent(chosen, draft.traveller) < 0;
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

      <h2 className={`${styles.heading} ${styles.listHeading}`}>Pick a route</h2>
      {draft.tooClose ? (
        <div className={styles.tooClose}>
          <p className={styles.tooCloseTitle}>START AND END ARE TOO CLOSE</p>
          <p className={styles.note}>Set them at least {MIN_ROUTE_M} m apart to plan a route.</p>
        </div>
      ) : (
        <>
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
          {draft.routes.length > 0 && (
            <p className={styles.whyNote}><b>Why A?</b> {recommendationText(draft.routes, draft.traveller)}</p>
          )}
        </>
      )}

      <section className={`${styles.section} ${styles.ends}`}>
        <h2 className={styles.heading}>Change the trip</h2>
        <div className={styles.endButtons}>
          <EndButton which="start" draft={draft} />
          <EndButton which="end" draft={draft} />
        </div>
      </section>

      <section className={styles.sendSection}>
        {inProgress ? (
          <p className={styles.inProgress}>MISSION UNDER WAY · START OVER TO PLAN A NEW ONE</p>
        ) : (
          <>
            <button type="button" data-testid="send-route" className={styles.sendButton} disabled={draft.tooClose || runsOut} onClick={onSend}>
              SEND ROUTE {routeLetter(draft.selected)} TO MARS ▲
            </button>
            {runsOut && (
              <p className={styles.runsOut} data-testid="send-runs-out">
                NOT ENOUGH {draft.traveller === 'rover' ? 'BATTERY' : 'OXYGEN'} TO REACH THE END
              </p>
            )}
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

/** Arms a map click that moves the start or the end. */
function EndButton({ which, draft }: { which: 'start' | 'end'; draft: PlanDraft }) {
  const armed = draft.arming === which;
  return (
    <div className={styles.endCell} data-armed={armed}>
      <button
        type="button"
        data-testid={`plan-arm-${which}`}
        aria-pressed={armed}
        aria-label={armed ? `Cancel moving the ${which}` : `Move the ${which} on the map`}
        className={styles.armButton}
        onClick={() => draft.arm(which)}
      >
        {armed ? 'CANCEL' : which === 'start' ? 'MOVE START' : 'MOVE END'}
      </button>
    </div>
  );
}

type CardProps = { route: Route; traveller: TravellerKind; selected: boolean; onSelect: () => void };

function RouteCard({ route, traveller, selected, onSelect }: CardProps) {
  const s = summarizeRoute(route, traveller);
  const end = routeEndPercent(route, traveller);
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
          <Readout label={traveller === 'rover' ? 'Battery at end' : 'O₂ at end'} value={formatEndPercent(end)} tone={lifeTone(end)} />
        </span>
      </span>
    </button>
  );
}
