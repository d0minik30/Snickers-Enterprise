// Plain data (no 'use client'), so server pages such as the landing page can import it too.

/** The screens in the nav, main ones first. /control/ and /field/ (the two halves of Mission) still work by address. */
export const VIEWS = [
  { href: '/map/', label: 'MAP', hint: 'Where am I? Find your position from a photo' },
  { href: '/pointcloud/', label: 'POINT CLOUD', hint: "The engine's terrain as points in 3D" },
  { href: '/mission/', label: 'MISSION', hint: 'Plan a trip and watch it happen' },
  { href: '/locate/', label: 'LOCATE', hint: 'Find where a photo was taken' },
  { href: '/validate/', label: 'VALIDATE', hint: 'How well Locate does on real photos' },
] as const;
