import Link from 'next/link';
import { formatClock } from '@/lib/nav/format';
import { SIGNAL_DELAY_MS } from '@/lib/mission/types';
import styles from './page.module.css';

const DELAY = formatClock(SIGNAL_DELAY_MS);

export default function Home() {
  return (
    <main className={styles.page}>
      <header className={styles.hero}>
        <p className={styles.kicker}>NASA SPACE APPS 2026 · TEAM SNICKERS ENTERPRISE</p>
        <h1 className={styles.title}>MARS MAP</h1>
        <p className={styles.lede}>
          A map for walking and driving on Mars. There is no GPS, and every radio message to Earth takes{' '}
          <b className={styles.caution}>{DELAY}</b> to arrive.
        </p>
      </header>

      <nav className={styles.choices} aria-label="Start here">
        <Link href="/mission/" className={`${styles.choice} ${styles.choiceMain}`} data-testid="choice-mission">
          <span className={styles.choiceTag}>RECOMMENDED</span>
          <span className={styles.choiceTitle}>Run a mission</span>
          <span className={styles.choiceText}>
            Plan a trip across Jezero Crater from Earth, send it, and watch the crew on Mars follow it. Both on one screen.
          </span>
          <span className={styles.choiceGo}>START →</span>
        </Link>
        <Link href="/map/" className={styles.choice} data-testid="choice-map">
          <span className={styles.choiceTag}>&nbsp;</span>
          <span className={styles.choiceTitle}>Explore the map</span>
          <span className={styles.choiceText}>
            Zoom from all of Mars into Jezero Crater. Turn on steep ground and sand to see where it is safe to go.
          </span>
          <span className={styles.choiceGo}>OPEN MAP →</span>
        </Link>
      </nav>

      <section className={styles.how} aria-labelledby="how">
        <h2 id="how" className={styles.sectionTitle}>How a mission works</h2>
        <ol className={styles.steps}>
          <li><b>Plan.</b> Pick one of three routes. We suggest the safest one.</li>
          <li><b>Send.</b> The route takes {DELAY} to reach Mars.</li>
          <li><b>Go.</b> The crew presses Start and walks. Speed up time up to 1000×.</li>
          <li><b>Done.</b> A message tells you when they arrive.</li>
        </ol>
      </section>

      <section className={styles.more} aria-labelledby="more">
        <h2 id="more" className={styles.sectionTitle}>More</h2>
        <ul className={styles.moreList}>
          <li><Link href="/locate/">Locate</Link> Find where a photo was taken by its skyline. <Link href="/locate/?result=saved">See a saved example</Link></li>
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
