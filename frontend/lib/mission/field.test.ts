import { describe, expect, it } from 'vitest';
import { fieldStateAt } from '@/lib/mission/field';
import { PACE_MPS, type MissionEvent } from '@/lib/mission/types';
import { divertedRoute, straightRoute } from '@/lib/testing/fixtures';
import type { SatellitePass } from '@/lib/planner/types';

const R = straightRoute(2000);
const PACE = PACE_MPS.astronaut;
const NO = [] as SatellitePass[];
const sent: MissionEvent = { id: 'r1', tMs: 0, type: 'route-sent', origin: 'control', traveller: 'astronaut', route: R, hazards: [] };
const start: MissionEvent = { id: 's1', tMs: 700_000, type: 'traverse-started', origin: 'field' };

describe('fieldStateAt', () => {
  it('does not have the route until the signal arrives', () => {
    expect(fieldStateAt([sent], 679_999, NO).status).toBe('awaiting-route');
    expect(fieldStateAt([sent], 679_999, NO).route).toBeNull();
    expect(fieldStateAt([sent], 680_000, NO).status).toBe('ready');
  });
  it('has the empty default state, with no next pass, before the route arrives', () => {
    const passes = [{ satellite: 'MRO', tMs: 900_000, quality: 'overhead' as const }];
    expect(fieldStateAt([sent], 0, passes)).toMatchObject({
      status: 'awaiting-route', traveller: null, route: null, hazards: [], pos: null, distM: 0,
      headingDeg: 0, posErrorM: 1, lastFixMs: null, nextPassMs: null,
    });
    expect(fieldStateAt([sent], 700_000, passes).nextPassMs).toBe(900_000);
  });
  it('walks at the traveller pace after Start', () => {
    const s = fieldStateAt([sent, start], 1_300_000, NO);
    expect(s.status).toBe('moving'); expect(s.distM).toBeCloseTo(PACE * 600, 1); expect(s.headingDeg).toBeCloseTo(0, 0);
  });
  it('a hold order stops the traveller only when it arrives, and proceed restarts it', () => {
    const hold: MissionEvent = { id: 'h', tMs: 800_000, type: 'message', origin: 'control', text: 'Hold position', order: 'hold' };
    const go: MissionEvent = { id: 'g', tMs: 1_000_000, type: 'message', origin: 'control', text: 'Proceed', order: 'proceed' };
    const log = [sent, start, hold, go];
    expect(fieldStateAt(log, 1_400_000, NO).status).toBe('moving');
    expect(fieldStateAt(log, 1_600_000, NO)).toMatchObject({ status: 'holding', paceMps: 0 });
    expect(fieldStateAt(log, 1_600_000, NO).distM).toBeCloseTo(PACE * 780, 1);
    expect(fieldStateAt(log, 1_780_000, NO).distM).toBeCloseTo(PACE * 880, 1);
  });
  it('arrives and stays at the end', () => {
    const s = fieldStateAt([sent, start], 9_000_000, NO);
    expect(s.status).toBe('arrived'); expect(s.distM).toBeCloseTo(R.lengthM, 6); expect(s.paceMps).toBe(0);
  });
  it('position error grows since the last fix and resets at a pass', () => {
    const passes = [{ satellite: 'MRO', tMs: 900_000, quality: 'overhead' as const }];
    const before = fieldStateAt([sent, start], 899_000, passes);
    expect(before.lastFixMs).toBe(700_000); expect(before.posErrorM).toBeCloseTo(1 + 0.02 * PACE * 199, 2);
    const after = fieldStateAt([sent, start], 1_000_000, passes);
    expect(after.lastFixMs).toBe(900_000); expect(after.posErrorM).toBeCloseTo(1 + 0.02 * PACE * 100, 2);
    expect(before.nextPassMs).toBe(900_000); expect(after.nextPassMs).toBeNull();
  });
  it('a changed route keeps the distance already walked', () => {
    const change: MissionEvent = { id: 'c', tMs: 800_000, type: 'route-changed', origin: 'control', route: divertedRoute(R, 1500), hazards: [], reason: 'hazard' };
    const s = fieldStateAt([sent, start, change], 1_500_000, NO);
    expect(s.route!.lengthM).toBeCloseTo(1900, 0); expect(s.distM).toBeCloseTo(PACE * 800, 1);
    expect(s.notices.at(-1)).toMatchObject({ kind: 'route-changed', text: 'Hazard ahead. Route changed by Control.', acked: false });
  });
  it('acknowledging marks the notice', () => {
    const msg: MissionEvent = { id: 'm', tMs: 800_000, type: 'message', origin: 'control', text: 'Sample at WP 2' };
    const ack: MissionEvent = { id: 'a', tMs: 1_500_000, type: 'ack', origin: 'field', targetId: 'm' };
    expect(fieldStateAt([sent, start, msg, ack], 1_500_000, NO).notices[0].acked).toBe(true);
  });
  it('gives the same answer whatever order the log is in', () =>
    expect(fieldStateAt([start, sent], 1_300_000, NO)).toEqual(fieldStateAt([sent, start], 1_300_000, NO)));
  it('does not mutate the log', () => {
    const log = [start, sent];
    fieldStateAt(log, 1_300_000, NO);
    expect(log).toEqual([start, sent]);
  });
  it('lists orders that arrive in the wrong status but changes nothing', () => {
    const go: MissionEvent = { id: 'g', tMs: 0, type: 'message', origin: 'control', text: 'Proceed', order: 'proceed' };
    const s = fieldStateAt([sent, go], 700_000, NO);
    expect(s.status).toBe('ready'); expect(s.notices).toHaveLength(1);
  });
});

describe('messages to Control', () => {
  const report: MissionEvent = { id: 'f1', tMs: 900_000, type: 'report', origin: 'field', text: 'All nominal.' };
  it('are listed from the moment they are sent and marked delivered once they land', () => {
    expect(fieldStateAt([sent, report], 899_999, NO).reports).toEqual([]);
    expect(fieldStateAt([sent, report], 900_000, NO).reports[0])
      .toEqual({ id: 'f1', text: 'All nominal.', sentMs: 900_000, arrivesMs: 1_580_000, delivered: false });
    expect(fieldStateAt([sent, report], 1_580_000, NO).reports[0].delivered).toBe(true);
  });
  it('do not change the traverse', () => {
    const a = fieldStateAt([sent, start, report], 1_500_000, NO);
    const b = fieldStateAt([sent, start], 1_500_000, NO);
    expect({ ...a, reports: [] }).toEqual(b);
  });
});
