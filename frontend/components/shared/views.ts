// Plain data (no 'use client'), so server pages such as the landing page can import it too.

/** Every screen of the app, main ones first. Control and Field are the two halves of Mission, for two windows. */
export const VIEWS = [
  { href: '/map/', label: 'MAP', hint: 'Where am I? Find your position from a photo' },
  { href: '/pointcloud/', label: 'POINT CLOUD', hint: "The engine's terrain as points in 3D" },
  { href: '/mission/', label: 'MISSION', hint: 'Plan a trip and watch it happen' },
  { href: '/locate/', label: 'LOCATE', hint: 'Find where a photo was taken' },
  { href: '/validate/', label: 'VALIDATE', hint: 'How well Locate does on real photos' },
  { href: '/control/', label: 'CONTROL', hint: 'Earth side only, for a second window' },
  { href: '/field/', label: 'FIELD', hint: 'Crew side only, for a phone' },
] as const;
