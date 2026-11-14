import { describe, expect, it } from 'vitest';
import { buildTimeline } from '@/components/control/timelineModel';
import { controlViewAt } from '@/lib/mission/control';
import type { MissionEvent } from '@/lib/mission/types';
import { straightRoute } from '@/lib/testing/fixtures';

const R = straightRoute(2000);
const sent: MissionEvent = { id: 'r1', tMs: 0, type: 'route-sent', origin: 'control', traveller: 'astronaut', route: R, hazards: [] };
const start: MissionEvent = { id: 's1', tMs: 700_000, type: 'traverse-started', origin: 'field' };

describe('buildTimeline', () => {
  it('never shows a signal from the field before it has arrived', () => {
    const early = buildTimeline(controlViewAt([sent, start], 1_000_000));
    expect(early.signals.filter(s => s.dir === 'down')).toEqual([]); // start news lands at 1_380_000
    const later = buildTimeline(controlViewAt([sent, start], 2_000_000));
    expect(later.signals.filter(s => s.dir === 'down').every(s => s.arrivesMs <= 2_000_000)).toBe(true);
    expect(later.signals.some(s => s.tone === 'telemetry')).toBe(true);
  });

  it('labels a message from the field MSG once it lands', () => {
    const report: MissionEvent = { id: 'f1', tMs: 900_000, type: 'report', origin: 'field', text: 'Copy.' };
    const t = buildTimeline(controlViewAt([sent, report], 1_600_000));
    expect(t.signals.find(s => s.id === 'f1')).toMatchObject({ dir: 'down', label: 'MSG', arrivesMs: 1_580_000 });
  });

  it('draws an uplink in transit in caution and a delivered one in nominal', () => {
    const t = buildTimeline(controlViewAt([sent], 300_000));
    expect(t.signals[0]).toMatchObject({ dir: 'up', sentMs: 0, arrivesMs: 680_000, tone: 'caution', label: 'ROUTE' });
    expect(buildTimeline(controlViewAt([sent], 700_000)).signals[0].tone).toBe('nominal');
  });

  it('covers 40 minutes back and 20 ahead', () => {
    const t = buildTimeline(controlViewAt([sent], 1_200_000));
    expect(t.toMs - t.fromMs).toBe(60 * 60_000);
    expect(t.nowMs).toBe(1_200_000);
  });

  it('labels a photo fix FIX once it lands at Control', () => {
    const fix: MissionEvent = { id: 'p1', tMs: 900_000, type: 'photo-fix', origin: 'field' };
    expect(buildTimeline(controlViewAt([sent, start, fix], 1_500_000)).signals.some(s => s.id === 'p1')).toBe(false);
    expect(buildTimeline(controlViewAt([sent, start, fix], 1_580_000)).signals.find(s => s.id === 'p1')).toMatchObject({ dir: 'down', label: 'FIX' });
  });

  it('labels orders and messages', () => {
    const log: MissionEvent[] = [
      sent,
      { id: 'h', tMs: 10, type: 'message', origin: 'control', text: 'Hold position', order: 'hold' },
      { id: 'p', tMs: 20, type: 'message', origin: 'control', text: 'Proceed', order: 'proceed' },
      { id: 'm', tMs: 30, type: 'message', origin: 'control', text: 'Hi' },
      { id: 'c', tMs: 40, type: 'route-changed', origin: 'control', route: R, hazards: [], reason: 'replan' },
    ];
    expect(buildTimeline(controlViewAt(log, 100)).signals.map(s => s.label)).toEqual(['ROUTE', 'HOLD', 'PROCEED', 'MSG', 'REROUTE']);
  });

  it('drops signals that ended before the window', () => {
    const t = buildTimeline(controlViewAt([sent], 5 * 3_600_000));
    expect(t.signals).toEqual([]);
  });
});
