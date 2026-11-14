'use client';

import { useEffect, useRef, useState } from 'react';
import { QUICK_REPORTS, reportStatus } from '@/components/field/fieldModel';
import type { FieldState } from '@/lib/mission/field';
import { MAX_MESSAGE_LENGTH, SIGNAL_DELAY_MS } from '@/lib/mission/types';
import { formatClock } from '@/lib/nav/format';
import styles from './field.module.css';

/** Bar under the map: opens the composer and shows where the newest message to Control is (or the delay, before any). */
export function ReportBar({ state, open, onToggle }: { state: FieldState; open: boolean; onToggle: () => void }) {
  const status = reportStatus(state);
  return (
    <button
      type="button"
      data-testid="field-report-toggle"
      className={`${styles.reportBar} ${open ? styles.reportBarOpen : ''}`}
      aria-expanded={open}
      aria-controls="field-report-sheet"
      onClick={onToggle}
    >
      <span>
        <span className={styles.reportBarIcon} aria-hidden="true">{open ? '✕' : '▲'}</span>
        {open ? 'CLOSE' : 'MESSAGE CONTROL'}
      </span>
      {status ? (
        <span data-testid="field-report-status" className={status.tone === 'nominal' ? styles.reportNominal : styles.reportCaution}>
          {status.text}
        </span>
      ) : open && <span className={styles.reportMuted}>DELAY {formatClock(SIGNAL_DELAY_MS)}</span>}
    </button>
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

  // Tell the screen how much of the map the sheet covers, so the traveller stays above it.
  useEffect(() => {
    const el = sheetRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => onHeight(el.offsetHeight));
    ro.observe(el);
    return () => { ro.disconnect(); onHeight(0); };
  }, [onHeight]);

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
