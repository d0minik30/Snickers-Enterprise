import Link from 'next/link';
import { SiteNav } from '@/components/shared/SiteNav';
import styles from './siteHeader.module.css';

/** The bar on top of every page, like the Map page's: home, where we are, and links to every screen. */
export function SiteHeader({ place = 'JEZERO CRATER, MARS', children }: { place?: string; children?: React.ReactNode }) {
  return (
    <header className={styles.bar}>
      <Link href="/" className={styles.home}>MARSFINDER</Link>
      {place && <span className={styles.place}>{place}</span>}
      <SiteNav />
      <span className={styles.spacer} />
      {children}
    </header>
  );
}
