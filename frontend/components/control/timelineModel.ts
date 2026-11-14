import type { ControlView, Uplink } from '@/lib/mission/control';
import { SIGNAL_DELAY_MS } from '@/lib/mission/types';

export type TimelineSignal = {
  id: string; dir: 'up' | 'down'; sentMs: number; arrivesMs: number;
  tone: 'telemetry' | 'nominal' | 'caution'; label?: string;
};
export type Timeline = {
  fromMs: number; toMs: number; nowMs: number; signals: TimelineSignal[];
};

export const TIMELINE_BACK_MS = 40 * 60_000;
export const TIMELINE_AHEAD_MS = 20 * 60_000;
export const TELEMETRY_EVERY_MS = 5 * 60_000;

function uplinkLabel(u: Uplink): string {
  const e = u.event;
  if (e.type === 'route-sent') return 'ROUTE';
  if (e.type === 'route-changed') return 'REROUTE';
  if (e.order === 'hold') return 'HOLD';
  if (e.order === 'proceed') return 'PROCEED';
  return 'MSG';
}

export function buildTimeline(view: ControlView): Timeline {
  const nowMs = view.tMs;
  const fromMs = nowMs - TIMELINE_BACK_MS;
  const toMs = nowMs + TIMELINE_AHEAD_MS;
  const signals: TimelineSignal[] = [];

  for (const u of view.uplinks) {
    signals.push({
      id: u.event.id, dir: 'up', sentMs: u.sentMs, arrivesMs: u.arrivesMs,
      tone: u.status === 'in-transit' ? 'caution' : 'nominal', label: uplinkLabel(u),
    });
  }
  for (const d of view.downlinks) {
    signals.push({
      id: d.id, dir: 'down', sentMs: d.sentMs, arrivesMs: d.receivedMs,
      tone: 'nominal', label: d.kind === 'ack' ? 'ACK' : d.kind === 'report' ? 'MSG' : d.kind === 'photo-fix' ? 'FIX' : 'START',
    });
  }

  // Routine telemetry, as Control knows it: only once the traverse start has been received, and only what has landed.
  const started = view.downlinks.find(d => d.kind === 'traverse-started');
  if (started) {
    for (let sentMs = started.sentMs + TELEMETRY_EVERY_MS; sentMs + SIGNAL_DELAY_MS <= nowMs; sentMs += TELEMETRY_EVERY_MS) {
      signals.push({ id: `telemetry:${sentMs}`, dir: 'down', sentMs, arrivesMs: sentMs + SIGNAL_DELAY_MS, tone: 'telemetry' });
    }
  }

  return {
    fromMs,
    toMs,
    nowMs,
    signals: signals.filter(s => s.arrivesMs >= fromMs && s.sentMs <= toMs),
  };
}
