'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useRef } from 'react';
import { VIEWS } from '@/components/shared/views';
import styles from './siteNav.module.css';


/** One row of links to the other screens; the current one is marked. Sits inside a screen's own top bar. */
export function SiteNav({ className }: { className?: string }) {
  const path = usePathname() ?? '/';
  const here = (href: string) => path === href || path === href.replace(/\/$/, '');
  const ref = useRef<HTMLElement>(null);
  // On a narrow screen the links scroll sideways: bring the current one into view.
  useEffect(() => {
    ref.current?.querySelector('[aria-current="page"]')?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }, [path]);
  return (
    <nav ref={ref} aria-label="Screens" className={`${styles.nav} ${className ?? ''}`}>
      {VIEWS.map(v => (
        <Link key={v.href} href={v.href} className={styles.link} aria-current={here(v.href) ? 'page' : undefined} title={v.hint}>
          {v.label}
        </Link>
      ))}
    </nav>
  );
}
