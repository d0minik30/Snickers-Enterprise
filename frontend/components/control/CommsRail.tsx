'use client';

import { useState } from 'react';
import { earthClock, marsClock, uplinkText } from '@/components/control/controlModel';
import type { ControlView, Downlink, Uplink } from '@/lib/mission/control';
import { MAX_MESSAGE_LENGTH, SIGNAL_DELAY_MS, type MissionEvent } from '@/lib/mission/types';
import { formatClock } from '@/lib/nav/format';
import styles from './control.module.css';

type Props = {
  view: ControlView;
  log: MissionEvent[];
  onOrder: (order: 'hold' | 'proceed') => void;
  onMessage: (text: string) => void;
};

type Entry = { key: string; atMs: number; uplink?: Uplink; downlink?: Downlink };

/** Right rail in Live mode: every signal in and out, newest first, with its delivery state; orders and messages. */
export function CommsRail({ view, log, onOrder, onMessage }: Props) {
  const [draft, setDraft] = useState('');
  const entries: Entry[] = [
    ...view.uplinks.map(u => ({ key: `u:${u.event.id}`, atMs: u.sentMs, uplink: u })),
    ...view.downlinks.map(d => ({ key: `d:${d.id}`, atMs: d.receivedMs, downlink: d })),
  ].sort((a, b) => b.atMs - a.atMs);

  /** What an ack answers: the ack event names its target; the target is one of our uplinks. */
  const ackedText = (ackId: string) => {
    const ack = log.find(e => e.id === ackId);
    const u = ack?.type === 'ack' ? view.uplinks.find(x => x.event.id === ack.targetId) : undefined;
    return u ? uplinkText(u) : '';
  };

  const send = () => {
    const text = draft.trim();
    if (!text) return;
    onMessage(text.slice(0, MAX_MESSAGE_LENGTH));
    setDraft('');
  };

  return (
    <aside className={`${styles.rail} ${styles.rightRail} ${styles.comms}`} aria-label="Comms">
      <h2 className={`${styles.heading} ${styles.commsHeading}`}>
        <span>Comms</span>
        <span>{entries.length}</span>
      </h2>

      <ol className={styles.log}>
        {entries.length === 0 && <li className={styles.logEmpty}>No signals yet.</li>}
        {entries.map(e => e.uplink
          ? <UplinkEntry key={e.key} u={e.uplink} nowMs={view.tMs} />
          : <DownlinkEntry key={e.key} d={e.downlink!} targetText={e.downlink!.kind === 'ack' ? ackedText(e.downlink!.id) : ''} />)}
      </ol>

      <section className={styles.compose}>
        <div className={styles.orders}>
          <button type="button" data-testid="order-hold" className={styles.orderButton} onClick={() => onOrder('hold')}>HOLD</button>
          <button type="button" data-testid="order-proceed" className={styles.orderButton} onClick={() => onOrder('proceed')}>PROCEED</button>
        </div>
        <form
          className={styles.msgForm}
          onSubmit={e => { e.preventDefault(); send(); }}
        >
          <label className={styles.srOnly} htmlFor="msg-input">Message to field</label>
          <input
            id="msg-input"
            data-testid="msg-input"
            className={styles.msgInput}
            value={draft}
            maxLength={MAX_MESSAGE_LENGTH}
            placeholder="Message to field"
            autoComplete="off"
            onChange={e => setDraft(e.target.value)}
          />
          <button type="submit" data-testid="msg-send" className={styles.msgSend} disabled={draft.trim() === ''}>SEND</button>
        </form>
        <p className={styles.sendNote}>
          Will arrive at <span className={styles.sendDelay}>{earthClock(view.tMs + SIGNAL_DELAY_MS)}</span> UTC
        </p>
      </section>
    </aside>
  );
}

function UplinkEntry({ u, nowMs }: { u: Uplink; nowMs: number }) {
  return (
    <li data-testid="uplink" data-status={u.status} data-id={u.event.id} className={`${styles.entry} ${styles.entryOut} ${styles[`entry-${u.status}`]}`}>
      <div className={styles.entryHead}>
        <span>▲ TO FIELD</span>
        <span>{earthClock(u.sentMs)}</span>
      </div>
      <p className={styles.entryText}>{uplinkText(u)}</p>
      {u.status === 'in-transit' ? (
        <>
          <div className={styles.entryTrack}><span style={{ width: `${u.progress * 100}%` }} /></div>
          <p className={styles.entryState}>
            ARRIVES IN {formatClock(Math.max(0, u.arrivesMs - nowMs))}
            {u.event.type === 'route-changed' && ' · FIELD STILL ON OLD ROUTE'}
          </p>
        </>
      ) : (
        <p className={styles.entryState}>
          {u.status === 'acknowledged' ? 'ACKNOWLEDGED' : `DELIVERED ${earthClock(u.arrivesMs)}`}
        </p>
      )}
    </li>
  );
}

function downlinkText(d: Downlink, targetText: string): string {
  if (d.kind === 'report') return d.text ?? '';
  if (d.kind === 'ack') return `Acknowledged${targetText ? `: ${targetText}` : ''}`;
  if (d.kind === 'photo-fix') return 'Position fix from skyline photos.';
  return 'Traverse started.';
}

function DownlinkEntry({ d, targetText }: { d: Downlink; targetText: string }) {
  return (
    <li data-testid="downlink" data-kind={d.kind} className={`${styles.entry} ${styles.entryIn} ${d.kind === 'report' ? styles['entry-report'] : ''}`}>
      <div className={styles.entryHead}>
        <span>{d.kind === 'report' ? '▼ MESSAGE FROM FIELD' : '▼ FROM FIELD'}</span>
        <span>{earthClock(d.receivedMs)}</span>
      </div>
      <p className={styles.entryText}>{downlinkText(d, targetText)}</p>
      <p className={styles.entryState}>SENT FROM MARS {marsClock(d.sentMs).time}</p>
    </li>
  );
}
