// Simulated consumables, worked out in the browser from the field state alone (nothing is stored):
// the astronaut's suit oxygen from breaths per minute, the rover's battery from its power draw.
// The numbers are rough, public-ballpark figures for a demo, not a flight model.

import type { FieldState } from '@/lib/mission/field';
import { PACE_MPS } from '@/lib/mission/types';

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

export type LifeSupport =
  | { kind: 'oxygen'; percent: number; breathsPerMin: number }
  | { kind: 'battery'; percent: number; netW: number };

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

/** Oxygen or battery left, or null before anyone is chosen to go. */
export function lifeSupportAt(state: FieldState): LifeSupport | null {
  if (!state.traveller) return null;
  const { movingMs, restingMs } = split(state);
  if (state.traveller === 'astronaut') {
    const usedL = (movingMs / MS_PER_MIN) * BREATH.walking.perMin * BREATH.walking.o2L
      + (restingMs / MS_PER_MIN) * BREATH.resting.perMin * BREATH.resting.o2L;
    return { kind: 'oxygen', percent: clampPercent(100 * (1 - usedL / O2_TANK_L)), breathsPerMin: breathing(state) };
  }
  const usedWh = (movingMs / MS_PER_H) * (ROVER_W.driving - ROVER_W.generator)
    + (restingMs / MS_PER_H) * (ROVER_W.idle - ROVER_W.generator);
  const netW = (state.status === 'moving' ? ROVER_W.driving : ROVER_W.idle) - ROVER_W.generator;
  return { kind: 'battery', percent: clampPercent(100 * (1 - usedWh / BATTERY_WH)), netW };
}
