'use client';

import dynamic from 'next/dynamic';

// three.js needs the browser: load the 3D scene only there.
const TerrainHero = dynamic(() => import('./TerrainHero'), { ssr: false });

export function HeroBackground() {
  return <TerrainHero />;
}
