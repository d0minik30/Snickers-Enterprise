import type { FieldNotice } from '@/lib/mission/field';
import { formatClock } from '@/lib/nav/format';
import styles from './field.module.css';

type Props = { notice: FieldNotice | null; nowMs: number; onAck: (id: string) => void };

/** Amber strip with the newest unacknowledged notice from Control. Tapping it acknowledges it. */
export function MessageStrip({ notice, nowMs, onAck }: Props) {
  if (!notice) return null;
  return (
    <button
      type="button"
      data-testid="field-message"
      className={styles.message}
      onClick={() => onAck(notice.id)}
      aria-label={`Message from Control: ${notice.text}. Tap to acknowledge.`}
    >
      <span className={styles.messageText}>
        <span className={styles.messageFrom}>CTRL ▸</span> {notice.text}
      </span>
      <span className={styles.messageAge}>−{formatClock(Math.max(0, nowMs - notice.sentMs))}</span>
    </button>
  );
}
