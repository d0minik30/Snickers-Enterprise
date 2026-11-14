import styles from './shared.module.css';

export type Tone = 'plain' | 'nominal' | 'caution' | 'danger' | 'route';

type Props = { label: string; value: string; unit?: string; tone?: Tone };

/**
 * A labelled cell: small grey uppercase label above a larger value. Size it with `--readout-value-size`.
 * Built from spans so it can also sit inside a button.
 */
export function Readout({ label, value, unit, tone = 'plain' }: Props) {
  return (
    <span className={styles.readout}>
      <span className={styles.label}>{label}</span>
      <span className={`${styles.value} ${styles[tone]}`}>
        {value}
        {unit && <span className={`${styles.unit} ${unit === '°' ? styles.degree : ''}`}>{unit}</span>}
      </span>
    </span>
  );
}
