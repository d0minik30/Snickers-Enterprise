import type { Tone } from './Readout';
import styles from './shared.module.css';

type Props = { label: string; value: string; unit: string; fraction: number; tone?: Tone };

/** A labelled value with a level bar under it; `fraction` is clamped to 0..1. */
export function Bar({ label, value, unit, fraction, tone = 'plain' }: Props) {
  const level = Math.min(1, Math.max(0, fraction));
  return (
    <span className={styles.readout}>
      <span className={styles.label}>{label}</span>
      <span className={`${styles.value} ${styles[tone]}`}>
        {value}
        <span className={`${styles.unit} ${unit === '°' ? styles.degree : ''}`}>{unit}</span>
      </span>
      <span className={styles.track} role="meter" aria-label={label} aria-valuemin={0} aria-valuemax={1} aria-valuenow={level}>
        <span className={`${styles.fill} ${styles[tone]}`} style={{ width: `${level * 100}%` }} />
      </span>
    </span>
  );
}
