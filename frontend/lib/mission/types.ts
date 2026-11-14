import type { Hazard, Route } from '@/lib/planner/types';

export type TravellerKind = 'astronaut' | 'rover';
export const SIGNAL_DELAY_MS = 680_000;
export const PACE_MPS: Record<TravellerKind, number> = { astronaut: 3.9 / 3.6, rover: 1.2 }; // 3.9 km/h on foot, 4.3 km/h driving
export const RATES = [1, 10, 30, 60] as const;
export const DEFAULT_RATE = 30;
export const MAX_MESSAGE_LENGTH = 140;

type Base = { id: string; tMs: number }; // tMs = mission time the event was SENT
export type MissionEvent =
  | (Base & { type: 'route-sent'; origin: 'control'; traveller: TravellerKind; route: Route; hazards: Hazard[] })
  | (Base & { type: 'route-changed'; origin: 'control'; route: Route; hazards: Hazard[]; reason: 'hazard' | 'replan' })
  | (Base & { type: 'message'; origin: 'control'; text: string; order?: 'hold' | 'proceed' })
  | (Base & { type: 'ack'; origin: 'field'; targetId: string })
  | (Base & { type: 'traverse-started'; origin: 'field' })
  | (Base & { type: 'report'; origin: 'field'; text: string }) // free-text message from Field to Control
  | (Base & { type: 'photo-fix'; origin: 'field' }); // skyline photos matched by the localization engine: position known again
