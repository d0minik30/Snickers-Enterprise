import type { BarCell, Cell } from '@/components/field/fieldModel';
import { Bar } from '@/components/shared/Bar';
import { Readout } from '@/components/shared/Readout';
import styles from './field.module.css';

type Props = { cells: Cell[]; bars?: BarCell[]; fixCue: boolean };

const POS_ERROR_CELL = 3; // the accuracy cell shows the "fix acquired" cue
const STEEP_DEG = 12; // slope or tilt above this shows amber, as on Control's route cards

/** Bottom band: the readout cells, then the level bars if any. */
export function ReadoutBand({ cells, bars, fixCue }: Props) {
  return (
    <section className={styles.readouts} aria-label="Readouts">
      <div className={styles.cells}>
        {cells.map((c, i) => (
          <div key={c.label} className={styles.cell}>
            <Readout label={c.label} value={c.value} unit={c.unit} tone={c.tone} />
            {i === POS_ERROR_CELL && fixCue && (
              <span data-testid="field-fix-cue" className={styles.fixCue}>FIX ACQUIRED</span>
            )}
          </div>
        ))}
      </div>
      {bars && bars.length > 0 && <div className={styles.bars}>
        {bars.map(b => (
          <div key={b.label} className={styles.cell}>
            <Bar
              label={b.label}
              value={b.value}
              unit={b.unit}
              fraction={b.fraction}
              tone={b.unit === '°' && Number(b.value) > STEEP_DEG ? 'caution' : 'plain'}
            />
          </div>
        ))}
      </div>}
    </section>
  );
}
