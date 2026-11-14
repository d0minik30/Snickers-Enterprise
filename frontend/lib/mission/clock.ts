import { DEFAULT_RATE } from '@/lib/mission/types';

export type ClockState = { anchorRealMs: number; anchorMissionMs: number; rate: number; paused: boolean; rev: number };

export function newClock(realNowMs: number): ClockState {
  return { anchorRealMs: realNowMs, anchorMissionMs: 0, rate: DEFAULT_RATE, paused: false, rev: 0 };
}

export function missionTimeAt(clock: ClockState, realNowMs: number): number {
  if (clock.paused) return clock.anchorMissionMs;
  return clock.anchorMissionMs + (realNowMs - clock.anchorRealMs) * clock.rate;
}

function reanchored(clock: ClockState, change: Partial<ClockState>, realNowMs: number): ClockState {
  return {
    ...clock,
    ...change,
    anchorRealMs: realNowMs,
    anchorMissionMs: missionTimeAt(clock, realNowMs),
    rev: clock.rev + 1,
  };
}

export function withRate(clock: ClockState, rate: number, realNowMs: number): ClockState {
  return reanchored(clock, { rate }, realNowMs);
}

export function withPaused(clock: ClockState, paused: boolean, realNowMs: number): ClockState {
  return reanchored(clock, { paused }, realNowMs);
}
