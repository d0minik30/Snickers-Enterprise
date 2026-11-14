import type { Maneuver } from '@/lib/nav/instructions';
import type { ReactNode } from 'react';

/** Right-hand shapes; the left ones are mirrored. Drawn on a 48 x 48 grid. */
const SHAPES: Record<'continue' | 'bear' | 'turn' | 'arrive', ReactNode> = {
  continue: (
    <>
      <path d="M24 44 V8" />
      <path d="M13 19 L24 8 L35 19" />
    </>
  ),
  bear: (
    <>
      <path d="M17 44 V28 L35 10" />
      <path d="M21 10 H35 V24" />
    </>
  ),
  turn: (
    <>
      <path d="M14 44 V22 H40" />
      <path d="M30 12 L40 22 L30 32" />
    </>
  ),
  arrive: (
    <>
      <path d="M24 44 V26" />
      <rect x="13" y="5" width="22" height="21" />
    </>
  ),
};

/** One inline SVG per manoeuvre: square caps, 4 px stroke, drawn in currentColor. */
export function TurnArrow({ maneuver, size = 48 }: { maneuver: Maneuver; size?: number }) {
  const [shape, side] = maneuver.split('-') as [keyof typeof SHAPES, 'left' | 'right' | undefined];
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 48 48"
      fill="none"
      stroke="currentColor"
      strokeWidth={4}
      strokeLinecap="square"
      strokeLinejoin="miter"
      aria-hidden="true"
    >
      <g transform={side === 'left' ? 'translate(48 0) scale(-1 1)' : undefined}>{SHAPES[shape]}</g>
    </svg>
  );
}
