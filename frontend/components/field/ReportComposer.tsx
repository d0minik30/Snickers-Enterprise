'use client';

import { useEffect, useRef, useState } from 'react';
import { QUICK_REPORTS, fieldLog, reportStatusShort } from '@/components/field/fieldModel';
import type { FieldState } from '@/lib/mission/field';
import { MAX_MESSAGE_LENGTH, SIGNAL_DELAY_MS } from '@/lib/mission/types';
import { formatClock } from '@/lib/nav/format';
import { useEmbedded } from '@/components/shared/embedded';
import styles from './field.module.css';

export type FieldPanel = 'none' | 'compose' | 'log';

/** Bar under the map: MESSAGE CONTROL opens the composer, LOG opens the history; the open one turns into its ✕.
    The LOG button also shows where the newest message to Control is. */
export function CommsBar({ state, panel, onPanel }: { state: FieldState; panel: FieldPanel; onPanel: (p: FieldPanel) => void }) {
  const status = reportStatusShort(state);
  const composing = panel === 'compose';
  const logging = panel === 'log';
  const embedded = useEmbedded(); // inside Mission, Earth's comms column already shows the log
  return (
    <div className={styles.commsBar}>
      <button
        type="button"
        data-testid="field-report-toggle"
        className={`${styles.reportBar} ${composing ? styles.reportBarOpen : ''}`}
        aria-expanded={composing}
        aria-controls="field-report-sheet"
        onClick={() => onPanel(composing ? 'none' : 'compose')}
      >
        <span className={styles.reportBarLabel}>
          <span className={styles.reportBarIcon} aria-hidden="true">{composing ? '✕' : '▲'}</span>
          {composing ? 'CLOSE' : 'MESSAGE EARTH'}
        </span>
        {composing && <span className={styles.reportMuted}>DELAY {formatClock(SIGNAL_DELAY_MS)}</span>}
      </button>
      {!embedded && <button
        type="button"
        data-testid="field-log-toggle"
        className={`${styles.logButton} ${logging ? styles.logButtonOpen : ''}`}
        aria-expanded={logging}
        aria-controls="field-log-sheet"
        aria-label={logging ? 'Close message log' : 'Message log'}
        onClick={() => onPanel(logging ? 'none' : 'log')}
      >
        <span>{logging ? '✕ LOG' : 'LOG'}</span>
        {status && (
          <span data-testid="field-report-status" className={status.tone === 'nominal' ? styles.logNominal : styles.logCaution}>
            {status.text}
          </span>
        )}
      </button>}
    </div>
  );
}

/** Tells the screen how much of the map a sheet covers, so the traveller stays above it. */
export function useCoverHeight(ref: React.RefObject<HTMLElement | null>, onHeight: (px: number) => void) {
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(() => onHeight(el.offsetHeight));
    ro.observe(el);
    return () => { ro.disconnect(); onHeight(0); };
  }, [ref, onHeight]);
}

/** Message history over the bottom of the map, newest first: from Control on the left, to Control on the right.
    An unacknowledged message from Control can be acknowledged here by tapping it. */
export function LogSheet({ state, onAck, onClose, onHeight }: {
  state: FieldState; onAck: (id: string) => void; onClose: () => void; onHeight: (px: number) => void;
}) {
  const sheetRef = useRef<HTMLElement>(null);
  useCoverHeight(sheetRef, onHeight);
  const entries = fieldLog(state);

  return (
    <section
      ref={sheetRef}
      id="field-log-sheet"
      data-testid="field-log-sheet"
      className={`${styles.reportSheet} ${styles.logSheet}`}
      aria-label="Message log"
      onKeyDown={e => { if (e.key === 'Escape') onClose(); }}
    >
      {entries.length === 0 && <p className={styles.logEmpty}>No messages yet.</p>}
      <ol className={styles.logList}>
        {entries.map(e => {
          const body = (
            <>
              <span className={styles.logHead}>
                <span>{e.dir === 'in' ? 'CTRL ▸' : '▲ TO CTRL'}</span>
                <span>−{formatClock(e.ageMs)}</span>
              </span>
              <span className={styles.logText}>{e.text}</span>
              <span className={e.tone === 'nominal' ? styles.logNominal : styles.logCaution}>{e.state}</span>
            </>
          );
          const cls = `${styles.logEntry} ${e.dir === 'in' ? styles.logIn : styles.logOut} ${e.tone === 'caution' ? styles.logPending : ''}`;
          return (
            <li key={e.id} data-testid="field-log-entry" data-dir={e.dir}>
              {e.ackable ? (
                <button type="button" className={cls} onClick={() => onAck(e.id)} aria-label={`Message from Control: ${e.text}. Tap to acknowledge.`}>
                  {body}
                </button>
              ) : (
                <div className={cls}>{body}</div>
              )}
            </li>
          );
        })}
      </ol>
    </section>
  );
}

/** Compact sheet over the bottom of the map: a row of one-tap reports, then a short free-text message. */
export function ReportSheet({ onSend, onClose, onHeight }: {
  onSend: (text: string) => void; onClose: () => void; onHeight: (px: number) => void;
}) {
  const [draft, setDraft] = useState('');
  const sheetRef = useRef<HTMLElement>(null);
  const rowRef = useRef<HTMLDivElement>(null);
  const [edges, setEdges] = useState({ left: false, right: false }); // more replies hidden on that side
  useCoverHeight(sheetRef, onHeight);

  // Track which ends of the reply row are cut off: drives the arrows and the fades.
  useEffect(() => {
    const row = rowRef.current;
    if (!row) return;
    const update = () => {
      const left = row.scrollLeft > 1;
      const right = row.scrollLeft + row.clientWidth < row.scrollWidth - 1;
      setEdges(e => (e.left === left && e.right === right ? e : { left, right }));
    };
    // A mouse wheel scrolls vertically; turn it into sideways movement along the row.
    const onWheel = (e: WheelEvent) => {
      if (row.scrollWidth <= row.clientWidth || Math.abs(e.deltaX) > Math.abs(e.deltaY)) return;
      e.preventDefault();
      row.scrollBy({ left: e.deltaY });
    };
    update();
    const ro = new ResizeObserver(update);
    ro.observe(row);
    row.addEventListener('scroll', update, { passive: true });
    row.addEventListener('wheel', onWheel, { passive: false });
    return () => {
      ro.disconnect();
      row.removeEventListener('scroll', update);
      row.removeEventListener('wheel', onWheel);
    };
  }, []);

  const page = (dir: 1 | -1) => {
    const row = rowRef.current;
    if (row) row.scrollBy({ left: dir * row.clientWidth * 0.7, behavior: 'smooth' });
  };

  const send = (text: string) => {
    const t = text.trim().slice(0, MAX_MESSAGE_LENGTH);
    if (!t) return;
    onSend(t);
    setDraft('');
    onClose();
  };

  return (
    <section
      ref={sheetRef}
      id="field-report-sheet"
      data-testid="field-report-sheet"
      className={styles.reportSheet}
      aria-label="Message to Control"
      onKeyDown={e => { if (e.key === 'Escape') onClose(); }}
    >
      <div className={styles.reportQuickWrap}>
        <button
          type="button"
          className={styles.reportArrow}
          aria-label="Earlier quick replies"
          disabled={!edges.left}
          onClick={() => page(-1)}
        >‹</button>
        <div
          ref={rowRef}
          className={styles.reportQuick}
          data-fade-left={edges.left || undefined}
          data-fade-right={edges.right || undefined}
        >
          {QUICK_REPORTS.map(text => (
            <button key={text} type="button" data-testid="field-report-quick" className={styles.reportQuickButton} onClick={() => send(text)}>
              {text.replace(/\.$/, '').toUpperCase()}
            </button>
          ))}
        </div>
        <button
          type="button"
          data-testid="field-report-more"
          className={styles.reportArrow}
          aria-label="More quick replies"
          disabled={!edges.right}
          onClick={() => page(1)}
        >›</button>
      </div>
      <form className={styles.reportForm} onSubmit={e => { e.preventDefault(); send(draft); }}>
        <label className={styles.srOnly} htmlFor="field-report-input">Message to Control</label>
        <input
          id="field-report-input"
          data-testid="field-report-input"
          className={styles.reportInput}
          value={draft}
          maxLength={MAX_MESSAGE_LENGTH}
          placeholder="Message to Control"
          autoComplete="off"
          onChange={e => setDraft(e.target.value)}
        />
        <button type="submit" data-testid="field-report-send" className={styles.reportSend} disabled={draft.trim() === ''}>
          SEND
        </button>
      </form>
    </section>
  );
}
