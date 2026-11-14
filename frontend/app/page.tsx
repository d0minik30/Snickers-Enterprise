import Link from 'next/link';
import { VIEWS } from '@/components/shared/views';
import { formatClock } from '@/lib/nav/format';
import { SIGNAL_DELAY_MS } from '@/lib/mission/types';
import { DESTINATION, START_PLACE } from '@/lib/planner';
import styles from './page.module.css';

const OPEN_HINT: Record<string, string> = {
  '/control/': 'Open in a wide window',
  '/field/': 'Open in a narrow window or on a phone',
  '/locate/': 'Needs the localization engine running',
  '/map/': 'Any window',
};

const DELAY = formatClock(SIGNAL_DELAY_MS);

export default function Home() {
  return (
    <main className={styles.page}>
      <header className={styles.hero}>
        <p className={styles.kicker}>NASA SPACE APPS 2026 · INTERPLANETARY SURVIVAL GUIDE · TEAM SNICKERS ENTERPRISE</p>
        <h1 className={styles.title}>MARS MAP</h1>
        <p className={styles.lede}>
          Google Maps for Mars. Plan a traverse across Jezero Crater from Earth, follow it on the surface, and find
          your position from photos of the skyline, all under the real {DELAY} one-way signal delay.
        </p>
        <dl className={styles.facts}>
          <div><dt>From</dt><dd>Perseverance landing site</dd></div>
          <div><dt>To</dt><dd>{DESTINATION.name}</dd></div>
          <div><dt>Signal delay</dt><dd className={styles.caution}>{DELAY} each way</dd></div>
          <div><dt>Terrain</dt><dd>MRO CTX DEM, 20 m</dd></div>
        </dl>
      </header>

      <nav className={styles.views} aria-label="Screens">
        {VIEWS.map((v, i) => (
          <Link key={v.href} href={v.href} className={styles.view}>
            <span className={styles.viewNumber}>{String(i + 1).padStart(2, '0')}</span>
            <span className={styles.viewLabel}>{v.label}</span>
            <span className={styles.viewHint}>{v.hint}</span>
            <span className={styles.viewOpen}>{OPEN_HINT[v.href]} →</span>
          </Link>
        ))}
      </nav>

      <div className={styles.columns}>
        <section className={styles.block} aria-labelledby="present">
          <h2 id="present" className={styles.blockTitle}>How to present</h2>
          <ol className={styles.steps}>
            <li><b>Open Control and Field side by side.</b> Control on a laptop, Field in a narrow window or a phone.</li>
            <li><b>Plan.</b> Control shows three routes to the {DESTINATION.name}. Point at why route A is recommended and at the height profile.</li>
            <li><b>Send.</b> The route takes {DELAY} to reach Mars (about 23 s at 30× speed). Press <b>Start traverse</b> in Field when it lands.</li>
            <li><b>Watch the delay.</b> In Control Live, the field data is always {DELAY} old: point at <i>last received</i> and <i>estimated now</i>, and at the signal timeline.</li>
            <li><b>Act.</b> Flag a hazard on the map, send Hold and Proceed, or a message. Field keeps the old plan until the signal arrives.</li>
            <li><b>Fix the position.</b> Press <b>Photo fix</b> in Field: there is no GPS on Mars, so the crew photographs the skyline and the engine matches it to the terrain. The Locate screen shows that step for real photos.</li>
          </ol>
          <p className={styles.small}>Speed, pause and reset are at the top right of Control. Reset clears both windows.</p>
        </section>

        <section className={styles.block} aria-labelledby="data">
          <h2 id="data" className={styles.blockTitle}>Real data</h2>
          <ul className={styles.list}>
            <li><b>Terrain:</b> elevation, slope and sand on a 40 m grid from the MRO CTX Jezero DEM and USGS SIM 3464.</li>
            <li><b>Hazards:</b> steep slopes over 25° and deep pits found in that terrain.</li>
            <li><b>Places:</b> the Perseverance landing site and the {DESTINATION.name}.</li>
            <li><b>Clocks:</b> real UTC, and real local solar time at Jezero with Perseverance’s sol number.</li>
            <li><b>Imagery:</b> live NASA Mars Trek tiles (Viking, CTX, HiRISE).</li>
          </ul>
          <p className={styles.small}>
            Simulated: the traveller walking the route, and three model numbers (pace, drift between fixes, fix accuracy).
          </p>
        </section>
      </div>

      <footer className={styles.footer}>
        Imagery and terrain: NASA / JPL-Caltech / USGS, via NASA Mars Trek. Geology: USGS SIM 3464 (Sun &amp; Stack, 2020).
      </footer>
    </main>
  );
}
