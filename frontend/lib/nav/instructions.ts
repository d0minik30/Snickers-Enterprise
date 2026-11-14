import type { Route } from '@/lib/planner/types';
import { pointAlong } from '@/lib/nav/geo';

export type Maneuver = 'continue' | 'bear-left' | 'bear-right' | 'turn-left' | 'turn-right' | 'arrive';
export type NextMove = { maneuver: Maneuver; distanceM: number; waypointIndex: number; waypointName: string };

export const MANEUVER_TEXT: Record<Maneuver, string> = {
  continue: 'Continue',
  'bear-left': 'Bear left',
  'bear-right': 'Bear right',
  'turn-left': 'Turn left',
  'turn-right': 'Turn right',
  arrive: 'Arrive',
};

const WINDOW_M = 40;
const STEP_M = 10;
const MIN_TURN_DEG = 15;
const MAX_BEAR_DEG = 60;

/** Negative delta is left, positive is right. */
export function classifyTurn(deltaDeg: number): Maneuver {
  const abs = Math.abs(deltaDeg);
  if (abs < MIN_TURN_DEG) return 'continue';
  const side = deltaDeg < 0 ? 'left' : 'right';
  return abs <= MAX_BEAR_DEG ? `bear-${side}` : `turn-${side}`;
}

/** Signed smallest angle from bearing a to bearing b, -180..180. */
function signedDelta(a: number, b: number): number {
  return ((((b - a) % 360) + 540) % 360) - 180;
}

export function nextMove(route: Route, distAlongM: number): NextMove {
  const d = distAlongM;
  const found = route.waypoints.findIndex((w) => w.distM > d);
  const waypointIndex = found === -1 ? route.waypoints.length - 1 : found;
  const wp = route.waypoints[waypointIndex];
  const target = { waypointIndex, waypointName: wp.name };

  // Heading change across a window, so a bend smoothed over many small angles still registers.
  const deltaAt = (s: number) =>
    signedDelta(pointAlong(route.points, s).bearingDeg, pointAlong(route.points, s + WINDOW_M).bearingDeg);

  for (let s = d; s + WINDOW_M <= wp.distM; s += STEP_M) {
    if (Math.abs(deltaAt(s)) < MIN_TURN_DEG) continue;
    let sharpest = 0;
    for (let t = s; t <= s + WINDOW_M; t += STEP_M) {
      const delta = deltaAt(t);
      if (Math.abs(delta) > Math.abs(sharpest)) sharpest = delta;
    }
    return { maneuver: classifyTurn(sharpest), distanceM: s + WINDOW_M / 2 - d, ...target };
  }

  const isLast = waypointIndex === route.waypoints.length - 1;
  return { maneuver: isLast ? 'arrive' : 'continue', distanceM: wp.distM - d, ...target };
}
