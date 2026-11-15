'use client';

import dynamic from 'next/dynamic';
import Link from 'next/link';
import { SiteNav } from '@/components/shared/SiteNav';
import { useState } from 'react';
import type L from 'leaflet';
import { FindMe } from './FindMe';
import type { MapStatus, OverlayState } from './JezeroMap';
import { SLOPE_CLASSES } from './mapData';
import css from './jezero.module.css';

// Leaflet touches `window` on import, so the map only ever loads in the browser.
const JezeroMap = dynamic(() => import('./JezeroMap'), {
  ssr: false,
  loading: () => <div className={css.loading}>LOADING MAP…</div>,
});

function fmt(deg: number, pos: string, neg: string): string {
  return `${Math.abs(deg).toFixed(5)}° ${deg >= 0 ? pos : neg}`;
}

export default function JezeroScreen() {
  const [overlays, setOverlays] = useState<OverlayState>({ slope: false, sand: false });
  const [status, setStatus] = useState<MapStatus>({ zoom: 12, cursor: null });
  const [map, setMap] = useState<L.Map | null>(null);
  const [findOpen, setFindOpen] = useState(false);
  const toggle = (key: keyof OverlayState) => setOverlays(o => ({ ...o, [key]: !o[key] }));

  return (
    <div className={css.screen}>
      <header className={css.topBar}>
        <Link href="/" className={css.home}>MARSFINDER</Link>
        <span className={css.place}>JEZERO CRATER, MARS</span>
        <SiteNav />
        <span className={css.spacer} />
        <span className={css.readout}>
          <span className={css.readoutLabel}>ZOOM</span> {status.zoom}
        </span>
        <span className={css.readout}>
          <span className={css.readoutLabel}>CURSOR</span>{' '}
          {status.cursor ? `${fmt(status.cursor.lat, 'N', 'S')}  ${fmt(status.cursor.lng, 'E', 'W')}` : '—'}
        </span>
      </header>

      <main className={css.mapArea}>
        <JezeroMap overlays={overlays} onStatus={setStatus} onMap={setMap} />
        <FindMe map={map} open={findOpen} onOpen={setFindOpen} />

        <section className={css.panel} aria-label="Map overlays">
          <h2 className={css.panelTitle}>SHOW ON MAP</h2>

          <button type="button" className={css.toggle} aria-pressed={overlays.slope} onClick={() => toggle('slope')}>
            <span className={css.box} aria-hidden />
            STEEP GROUND
          </button>
          {overlays.slope && (
            <ul className={css.legend} aria-label="Slope legend">
              {SLOPE_CLASSES.map(c => (
                <li key={c.label}>
                  <span className={`${css.swatch} ${c.color === 'transparent' ? css.clearSwatch : ''}`} style={{ background: c.color }} aria-hidden />
                  {c.label}
                </li>
              ))}
            </ul>
          )}

          <button type="button" className={css.toggle} aria-pressed={overlays.sand} onClick={() => toggle('sand')}>
            <span className={css.box} aria-hidden />
            SAND
          </button>
          {overlays.sand && (
            <ul className={css.legend} aria-label="Sand legend">
              <li>
                <span className={`${css.swatch} ${css.sandSwatch}`} aria-hidden />
                Sand dunes
              </li>
            </ul>
          )}

        </section>
      </main>
    </div>
  );
}
