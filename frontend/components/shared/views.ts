// Plain data (no 'use client'), so server pages such as the landing page can import it too.

/** Every screen of the app, in demo order. */
export const VIEWS = [
  { href: '/control/', label: 'CONTROL', hint: 'Plan and watch the traverse from Earth' },
  { href: '/field/', label: 'FIELD', hint: 'The crew’s HUD on the surface' },
  { href: '/locate/', label: 'LOCATE', hint: 'Find a position from skyline photos' },
  { href: '/map/', label: 'MAP', hint: 'Explore Jezero: slope and sand' },
  { href: '/validate/', label: 'VALIDATE', hint: 'Real Perseverance photos, known positions' },
] as const;
