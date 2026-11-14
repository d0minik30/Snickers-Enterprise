import { describe, expect, it } from 'vitest';
import { canReroute, controlViewAt, predictBranchDistM } from '@/lib/mission/control';
import { PACE_MPS, type MissionEvent } from '@/lib/mission/types';
import { ORIGIN, divertedRoute, straightRoute } from '@/lib/testing/fixtures';

const R = straightRoute(2000);
const PACE = PACE_MPS.astronaut;
const sent: MissionEvent = { id: 'r1', tMs: 0, type: 'route-sent', origin: 'control', traveller: 'astronaut', route: R, hazards: [] };
const start: MissionEvent = { id: 's1', tMs: 700_000, type: 'traverse-started', origin: 'field' };

describe('controlViewAt', () => {
  it('sees the field as it was one delay ago and estimates now', () => {
    const v = controlViewAt([sent, start], 1_380_000);
    expect(v.dataAgeMs).toBe(680_000);
    expect(v.received).toMatchObject({ status: 'moving', distM: 0 });
    expect(v.estimatedNow!.distM).toBeCloseTo(PACE * 680, 1);
  });
  it('does not know the traverse has started until the news arrives', () => {
    expect(controlViewAt([sent, start], 1_379_999).received.status).toBe('ready');
    expect(controlViewAt([sent, start], 1_379_999).downlinks).toEqual([]);
    expect(controlViewAt([sent, start], 1_380_000).downlinks[0]).toMatchObject({ kind: 'traverse-started', sentMs: 700_000, receivedMs: 1_380_000 });
  });
  it('tracks an uplink from in transit to delivered to acknowledged', () => {
    const msg: MissionEvent = { id: 'm', tMs: 800_000, type: 'message', origin: 'control', text: 'Sample at WP 2' };
    const ack: MissionEvent = { id: 'a', tMs: 1_500_000, type: 'ack', origin: 'field', targetId: 'm' };
    const log = [sent, start, msg, ack];
    const up = (t: number) => controlViewAt(log, t).uplinks.find(u => u.event.id === 'm')!;
    expect(up(1_140_000)).toMatchObject({ status: 'in-transit', arrivesMs: 1_480_000 });
    expect(up(1_140_000).progress).toBeCloseTo(0.5, 2);
    expect(up(1_480_000).status).toBe('delivered');
    expect(up(2_179_999).status).toBe('delivered');
    expect(up(2_180_000).status).toBe('acknowledged');
  });
  it('shows a changed route as pending until it lands', () => {
    const r2 = divertedRoute(R, 1500);
    const change: MissionEvent = { id: 'c', tMs: 1_400_000, type: 'route-changed', origin: 'control', route: r2, reason: 'hazard',
      hazards: [{ id: 'hz', center: ORIGIN, radiusM: 60, label: 'Flagged', source: 'control' }] };
    const mid = controlViewAt([sent, start, change], 1_500_000);
    expect(mid.traveller).toBe('astronaut');
    expect(mid.activeRoute!.id).toBe(R.id); expect(mid.pendingRoute!.id).toBe(r2.id); expect(r2.id).not.toBe(R.id);
    expect(mid.hazards.find(h => h.id === 'hz')!.atField).toBe(false);
    const done = controlViewAt([sent, start, change], 2_080_000);
    expect(done.activeRoute!.id).toBe(r2.id); expect(done.pendingRoute).toBeNull();
    expect(done.hazards.find(h => h.id === 'hz')!.atField).toBe(true);
  });
  it('predicts the furthest the traveller can be when a new signal lands', () => {
    const v = controlViewAt([sent, start], 1_380_000);
    expect(predictBranchDistM(v)).toBeCloseTo(PACE * 1360, 1); expect(canReroute(v)).toBe(true);
  });
  it('refuses to reroute when the traveller is about to arrive', () => {
    const v = controlViewAt([sent, start], 700_000 + 680_000 + 1_000_000);
    expect(predictBranchDistM(v)).toBeCloseTo(R.lengthM, 6); expect(canReroute(v)).toBe(false);
  });
  it('predicts nothing before a route is sent', () => {
    const v = controlViewAt([], 1_000_000);
    expect(predictBranchDistM(v)).toBe(0); expect(canReroute(v)).toBe(false);
    expect(v.estimatedNow).toBeNull();
  });
});

describe('messages from Field', () => {
  const report: MissionEvent = { id: 'f1', tMs: 900_000, type: 'report', origin: 'field', text: 'Hazard spotted.' };
  it('reach Control only after the signal delay, carrying their text', () => {
    expect(controlViewAt([sent, report], 1_579_999).downlinks).toEqual([]);
    expect(controlViewAt([sent, report], 1_580_000).downlinks[0])
      .toEqual({ id: 'f1', kind: 'report', sentMs: 900_000, receivedMs: 1_580_000, text: 'Hazard spotted.' });
  });
  it('do not change what Control believes about the traverse', () => {
    const a = controlViewAt([sent, start, report], 2_000_000);
    const b = controlViewAt([sent, start], 2_000_000);
    expect({ ...a.received, reports: [] }).toEqual(b.received);
    expect(a.estimatedNow).toEqual(b.estimatedNow);
  });
});
