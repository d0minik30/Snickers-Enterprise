'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { VIEWS } from '@/components/shared/views';
import styles from './screenMenu.module.css';

type Props = {
  /** What the button shows: a screen's brand, or a compact icon. */
  children: ReactNode;
  /** Classes for the button, so each screen styles it as part of its own bar. */
  className?: string;
  /** Where the list opens, relative to the button. */
  align?: 'left' | 'right';
  label?: string;
};

/**
 * A button that opens the list of every screen. For screens with no room for a row of links: Control's top bar
 * and the Field HUD. Closes on Escape, on a click outside, and when a link is followed.
 */
export function ScreenMenu({ children, className, align = 'left', label = 'All screens' }: Props) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const listId = useId();
  const path = usePathname() ?? '/';
  const here = (href: string) => path === href || path === href.replace(/\/$/, '');

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    const onDown = (e: PointerEvent) => { if (!root.current?.contains(e.target as Node)) setOpen(false); };
    window.addEventListener('keydown', onKey);
    window.addEventListener('pointerdown', onDown);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('pointerdown', onDown);
    };
  }, [open]);

  return (
    <div ref={root} className={styles.root}>
      <button
        type="button"
        data-testid="screen-menu"
        className={className}
        aria-haspopup="true"
        aria-expanded={open}
        aria-controls={listId}
        aria-label={label}
        onClick={() => setOpen(o => !o)}
      >
        {children}
      </button>
      {open && (
        <nav id={listId} aria-label="Screens" className={`${styles.list} ${align === 'right' ? styles.right : ''}`}>
          <Link href="/" className={styles.item} onClick={() => setOpen(false)}>
            <span className={styles.itemLabel}>HOME</span>
            <span className={styles.itemHint}>What this is and how to present it</span>
          </Link>
          {VIEWS.map(v => (
            <Link key={v.href} href={v.href} className={styles.item} aria-current={here(v.href) ? 'page' : undefined} onClick={() => setOpen(false)}>
              <span className={styles.itemLabel}>{v.label}</span>
              <span className={styles.itemHint}>{v.hint}</span>
            </Link>
          ))}
        </nav>
      )}
    </div>
  );
}
