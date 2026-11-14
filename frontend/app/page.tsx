import Link from 'next/link';
import styles from './page.module.css';

export default function Home() {
  return (
    <main className={styles.page}>
      <header className={styles.header}>
        <h1 className={styles.title}>MARS MAP</h1>
        <p className={styles.lede}>
          Navigation for a Mars traverse across an 11-minute one-way signal delay: a field HUD for the
          crew and a control view for the planners.
        </p>
      </header>

      <nav className={styles.cells} aria-label="Views">
        <Link href="/field/" className={styles.cell}>
          <span className={styles.cellLabel}>FIELD</span>
          <span className={styles.cellHint}>Open in a narrow window</span>
        </Link>
        <Link href="/control/" className={styles.cell}>
          <span className={styles.cellLabel}>CONTROL</span>
          <span className={styles.cellHint}>Open in a wide window</span>
        </Link>
        <Link href="/map/" className={styles.cell}>
          <span className={styles.cellLabel}>JEZERO</span>
          <span className={styles.cellHint}>Explore the map: slope and sand</span>
        </Link>
      </nav>

      <section className={styles.note} aria-labelledby="present">
        <h2 id="present" className={styles.noteTitle}>HOW TO PRESENT</h2>
        <ol className={styles.steps}>
          <li>Open both views, side by side.</li>
          <li>Plan a route and send it in Control.</li>
          <li>Press Start in Field.</li>
        </ol>
      </section>
    </main>
  );
}
