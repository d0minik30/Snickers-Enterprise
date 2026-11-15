import Link from 'next/link';
import { DEMO_PHOTOS, DEMO_TRUTH, demoAnswerFor } from '@/lib/locate/demo';
import { formatClock } from '@/lib/nav/format';
import { distanceM } from '@/lib/nav/geo';
import { SIGNAL_DELAY_MS } from '@/lib/mission/types';
import { HeroBackground } from '@/components/landing/HeroBackground';
import { SiteNav } from '@/components/shared/SiteNav';
import styles from './page.module.css';

const DELAY = formatClock(SIGNAL_DELAY_MS);

// Live NASA Mars Trek tiles of Jezero Crater (MRO CTX, 6 m), zoom 11: a 6 × 6 block around the landing site.
// Loaded straight from NASA like the rest of the site's imagery.
const CTX = 'https://trek.nasa.gov/tiles/Mars/EQ/JEZ_ctx_B_soc_008_orthoMosaic_6m_Eqc_latTs0_lon0/1.0.0//default/default028mm/11';

// The example photos and their saved answer can change (lib/locate/demo.ts): read them, don't hard-code them.
const EXAMPLE_PHOTO = DEMO_PHOTOS[0].url;
const demo = demoAnswerFor(DEMO_PHOTOS.map(p => ({ sha256: p.sha256, name: p.id })));
const DEMO_ERROR_M = demo ? Math.round(distanceM(demo.result.best, DEMO_TRUTH)) : null;

export default function Home() {
  return (
    <main className={styles.page}>
      {/* ----------------------------------------------------------- hero */}
      <section className={styles.hero}>
        <HeroBackground />
        <div className={styles.shade} aria-hidden="true" />

        <nav className={styles.nav} aria-label="Main">
          <Link href="/" className={styles.logo}>MARS<span>FINDER</span></Link>
          <SiteNav className={styles.siteNav} />
        </nav>

        <div className={styles.heroText}>
          <p className={styles.kicker}>NASA SPACE APPS 2026 · JEZERO CRATER</p>
          <h1 className={styles.title}>Lost on Mars?<br /><span>Take a photo.</span></h1>
          <p className={styles.lede}>
            There is no GPS on Mars. Marsfinder finds where you are by matching the skyline in your photos
            to the shape of the land around you.
          </p>
          <div className={styles.ctas}>
            <Link href="/map/" className={styles.ctaMain} data-testid="choice-map">FIND ME FROM A PHOTO →</Link>
            <Link href="/mission/" className={styles.ctaSecond} data-testid="choice-mission">RUN A MISSION</Link>
          </div>
          {DEMO_ERROR_M !== null && demo?.result.status === 'ok' && (
            <p className={styles.proof}>
              <b>{DEMO_ERROR_M} m</b> from NASA’s real rover position, using {DEMO_PHOTOS.length} Perseverance photos
            </p>
          )}
        </div>
      </section>

      {/* ----------------------------------------------------------- how it works */}
      <section className={styles.how} aria-labelledby="how">
        <h2 id="how" className={styles.sectionTitle}>How it works</h2>
        <ol className={styles.steps}>
          <li>
            <div className={styles.visual}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={EXAMPLE_PHOTO} alt="A Perseverance Navcam photo of the horizon in Jezero Crater" />
            </div>
            <span className={styles.stepNo}>01</span>
            <h3>Take photos</h3>
            <p>Shoot the horizon in a few directions. A phone or a rover camera both work.</p>
          </li>
          <li>
            <div className={`${styles.visual} ${styles.skyline}`} aria-hidden="true">
              <svg viewBox="0 0 300 160" preserveAspectRatio="none">
                <path className={styles.ridgeFar} d="M0 92 L30 84 L55 88 L80 70 L110 76 L140 58 L170 66 L200 54 L230 72 L260 64 L300 74 L300 160 L0 160Z" />
                <path className={styles.ridgeLine} d="M0 92 L30 84 L55 88 L80 70 L110 76 L140 58 L170 66 L200 54 L230 72 L260 64 L300 74" />
                <path className={styles.ridgeMatch} d="M0 96 L30 86 L55 90 L80 72 L110 79 L140 60 L170 69 L200 56 L230 74 L260 67 L300 77" />
              </svg>
            </div>
            <span className={styles.stepNo}>02</span>
            <h3>Match the skyline</h3>
            <p>We trace the line where land meets sky and compare it with thousands of spots on the Mars terrain.</p>
          </li>
          <li>
            <div className={`${styles.visual} ${styles.mini}`} aria-hidden="true">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={`${CTX}/814/2929.png`} alt="" />
              <span className={styles.miniPin} />
            </div>
            <span className={styles.stepNo}>03</span>
            <h3>Get a pin</h3>
            <p>Your position on the map, how sure we are, and which way each photo was facing.</p>
          </li>
        </ol>
        <Link href="/map/" className={styles.ctaMain}>TRY IT WITH EXAMPLE PHOTOS →</Link>
      </section>

      {/* ----------------------------------------------------------- mission */}
      <section className={styles.mission} aria-labelledby="mission">
        <div>
          <h2 id="mission" className={styles.sectionTitle}>Also: run a mission</h2>
          <p className={styles.missionText}>
            Plan a trip across Jezero Crater from Earth, send it, and watch the crew on Mars follow it.
            Every message takes {DELAY} to arrive, just like the real thing.
          </p>
          <Link href="/mission/" className={styles.ctaSecond}>START A MISSION →</Link>
        </div>
        <dl className={styles.stats}>
          <div><dt>Radio delay</dt><dd>{DELAY}</dd></div>
          <div><dt>Routes to choose</dt><dd>3</dd></div>
          <div><dt>Fastest time speed</dt><dd>1000×</dd></div>
        </dl>
      </section>

      {/* ----------------------------------------------------------- footer */}
      <footer className={styles.footer}>
        <span className={styles.logo}>MARS<span>FINDER</span></span>
        <span className={styles.footerLinks}>
          <Link href="/locate/">Locate (advanced)</Link>
          <Link href="/validate/">Test results</Link>
          <Link href="/control/">Control</Link>
          <Link href="/field/">Field</Link>
        </span>
        <span className={styles.credits}>Team Snickers Enterprise · Imagery: NASA / JPL-Caltech / USGS via NASA Mars Trek</span>
      </footer>
    </main>
  );
}
