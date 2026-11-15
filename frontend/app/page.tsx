import Link from 'next/link';
import styles from './page.module.css';

export default function Home() {
  return (
    <main className={styles.page}>
      <header className={styles.hero}>
        <p className={styles.kicker}>NASA SPACE APPS 2026 · TEAM SNICKERS ENTERPRISE</p>
        <h1 className={styles.title}>MARS MAP</h1>
        <p className={styles.lede}>
          There is no GPS on Mars. This map finds where you are from a photo of the horizon.
        </p>
      </header>

      <nav className={styles.choices} aria-label="Start here">
        <Link href="/map/" className={`${styles.choice} ${styles.choiceMain}`} data-testid="choice-map">
          <span className={styles.choiceTag}>START HERE</span>
          <span className={styles.choiceTitle}>Where am I?</span>
          <span className={styles.choiceText}>
            Upload a photo of the Martian horizon. We match the skyline to the 3D terrain and put a pin on the map
            where it was taken.
          </span>
          <span className={styles.choiceGo}>OPEN THE MAP →</span>
        </Link>
        <Link href="/mission/" className={styles.choice} data-testid="choice-mission">
          <span className={styles.choiceTag}>&nbsp;</span>
          <span className={styles.choiceTitle}>Run a mission</span>
          <span className={styles.choiceText}>
            Plan a trip across Jezero Crater from Earth and watch the crew on Mars follow it, with the real radio delay.
          </span>
          <span className={styles.choiceGo}>START →</span>
        </Link>
      </nav>

      <section className={styles.how} aria-labelledby="how">
        <h2 id="how" className={styles.sectionTitle}>How “Where am I?” works</h2>
        <ol className={styles.steps}>
          <li><b>Take photos</b> of the horizon, a few in different directions.</li>
          <li><b>Upload them</b> on the map.</li>
          <li><b>We trace the skyline</b> and compare it with the terrain around Jezero.</li>
          <li><b>A pin shows where you are</b>, and how sure we are.</li>
        </ol>
      </section>

      <section className={styles.more} aria-labelledby="more">
        <h2 id="more" className={styles.sectionTitle}>More</h2>
        <ul className={styles.moreList}>
          <li><Link href="/locate/">Locate (advanced)</Link> The same photo search with every detail: fix the traced skyline by hand, camera settings.</li>
          <li><Link href="/validate/">Validate</Link> How well Locate does on real rover photos.</li>
          <li><Link href="/control/">Control</Link> and <Link href="/field/">Field</Link> The two halves of a mission, to open in separate windows or on a phone.</li>
        </ul>
      </section>

      <footer className={styles.footer}>
        Imagery and terrain: NASA / JPL-Caltech / USGS, via NASA Mars Trek. Geology: USGS SIM 3464 (Sun &amp; Stack, 2020).
      </footer>
    </main>
  );
}
