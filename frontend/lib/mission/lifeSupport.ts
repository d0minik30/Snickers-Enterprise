// Simulated consumables, worked out in the browser from the field state alone (nothing is stored):
// the astronaut's suit oxygen from breaths per minute, the rover's battery from its power draw.
// The numbers are rough, public-ballpark figures for a demo, not a flight model.

import type { FieldState } from '@/lib/mission/field';
import { PACE_MPS, type TravellerKind } from '@/lib/mission/types';
import type { Route } from '@/lib/planner/types';

/** Suit oxygen, litres at surface pressure: about what an EVA backpack carries for an 8-hour day. */
export const O2_TANK_L = 380;
/** Breaths per minute and litres of oxygen used per breath, walking and at rest. */
export const BREATH = {
  walking: { perMin: 24, o2L: 0.06 },
  resting: { perMin: 14, o2L: 0.025 },
} as const;

/** Rover battery (two lithium-ion packs) and power, watts. The radioisotope generator recharges it all the time. */
export const BATTERY_WH = 2400;
export const ROVER_W = { driving: 400, idle: 150, generator: 110 } as const;

/** What should be left on arrival: a route or reroute that ends below this is flagged to Control. */
export const RESERVE_PERCENT = 20;

/** `refilled`: arrived, and the tank was refilled (battery charged) there: back to 100 %. */
export type LifeSupport =
  | { kind: 'oxygen'; percent: number; breathsPerMin: number; refilled?: true }
  | { kind: 'battery'; percent: number; netW: number; refilled?: true };

const MS_PER_MIN = 60_000;
const MS_PER_H = 3_600_000;

/** How long of the time since the start was spent moving, and how long standing still. */
function split(state: FieldState): { movingMs: number; restingMs: number } {
  if (state.startedMs === null || !state.traveller) return { movingMs: 0, restingMs: 0 };
  const elapsed = Math.max(0, state.tMs - state.startedMs);
  // Everyone moves at a steady pace, so the distance covered says how long they were on the move.
  const movingMs = Math.min(elapsed, (state.distM / PACE_MPS[state.traveller]) * 1000);
  return { movingMs, restingMs: elapsed - movingMs };
}

/** A breathing rate that wanders a little around its average, the same for the same moment. */
function breathing(state: FieldState): number {
  const base = state.status === 'moving' ? BREATH.walking.perMin : BREATH.resting.perMin;
  return Math.round(base + 1.5 * Math.sin(state.tMs / 9000) + Math.sin(state.tMs / 3100));
}

const clampPercent = (x: number) => Math.max(0, Math.min(100, x));

/**
 * Share of the tank (astronaut) or battery (rover), in percent, used by moving `movedM` at the
 * traveller's pace and standing still for `restMs`.
 */
export function costPercent(traveller: TravellerKind, movedM: number, restMs: number): number {
  const movingMs = (Math.max(0, movedM) / PACE_MPS[traveller]) * 1000;
  const rest = Math.max(0, restMs);
  if (traveller === 'astronaut') {
    const usedL = (movingMs / MS_PER_MIN) * BREATH.walking.perMin * BREATH.walking.o2L
      + (rest / MS_PER_MIN) * BREATH.resting.perMin * BREATH.resting.o2L;
    return (100 * usedL) / O2_TANK_L;
  }
  const usedWh = (movingMs / MS_PER_H) * (ROVER_W.driving - ROVER_W.generator)
    + (rest / MS_PER_H) * (ROVER_W.idle - ROVER_W.generator);
  return (100 * usedWh) / BATTERY_WH;
}

/** What a route leaves from a full tank or battery, in percent. Negative: it can't be finished. */
export function routeEndPercent(route: Pick<Route, 'lengthM'>, traveller: TravellerKind): number {
  return 100 - costPercent(traveller, route.lengthM, 0);
}

/** Oxygen or battery left, or null before anyone is chosen to go. */
export function lifeSupportAt(state: FieldState): LifeSupport | null {
  if (!state.traveller) return null;
  const { movingMs, restingMs } = split(state);
  const movedM = (movingMs / 1000) * PACE_MPS[state.traveller];
  // The end of the route has a refill (the destination, or the base after a turn back): full again.
  const refilled = state.status === 'arrived';
  const percent = refilled ? 100 : clampPercent(100 - costPercent(state.traveller, movedM, restingMs));
  const extra = refilled ? { refilled: true as const } : {};
  if (state.traveller === 'astronaut') return { kind: 'oxygen', percent, breathsPerMin: breathing(state), ...extra };
  const netW = (state.status === 'moving' ? ROVER_W.driving : ROVER_W.idle) - ROVER_W.generator;
  return { kind: 'battery', percent, netW, ...extra };
}

/** Expected at the end of the current route, if the rest is walked (driven) without stopping. Unclamped. */
export function arrivalPercent(state: FieldState): number | null {
  const life = lifeSupportAt(state);
  if (!life || !state.route || !state.traveller) return null;
  return life.percent - costPercent(state.traveller, state.route.lengthM - state.distM, 0);
}

/**
 * '≈ 34 %' (or '34 %' with `approx: false`), or "WON'T REACH" when a route would run out: never a
 * negative percentage, and no ≈ in front of words.
 */
export function formatEndPercent(percent: number, { approx = true }: { approx?: boolean } = {}): string {
  if (percent < 0) return "WON'T REACH";
  return `${approx ? '≈ ' : ''}${Math.round(percent)} %`;
}

/** Red below empty, amber below the reserve. */
export function lifeTone(percent: number): 'plain' | 'caution' | 'danger' {
  return percent < 0 ? 'danger' : percent < RESERVE_PERCENT ? 'caution' : 'plain';
}
