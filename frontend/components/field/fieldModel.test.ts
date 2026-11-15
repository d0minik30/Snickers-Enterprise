import { describe, expect, it } from 'vitest';
import { fieldBars, fieldCamera, fieldCells, fieldCue, fieldOverlays, nextMoveView, reportStatusShort, fieldLog } from '@/components/field/fieldModel';
import { fieldStateAt } from '@/lib/mission/field';
import type { MissionEvent } from '@/lib/mission/types';
import { straightRoute } from '@/lib/testing/fixtures';

const R = straightRoute(2000);
const sent: MissionEvent = { id: 'r1', tMs: 0, type: 'route-sent', origin: 'control', traveller: 'astronaut', route: R, hazards: [] };
const start: MissionEvent = { id: 's1', tMs: 700_000, type: 'traverse-started', origin: 'field' };
const moving = fieldStateAt([sent, start], 1_300_000);

describe('fieldOverlays', () => {
  it('draws the route ahead from the traveller, the walked path behind, and the marker', () => {
    const o = fieldOverlays(moving);
    const ahead = o.find(x => x.kind === 'route' && x.variant === 'active');
    const walked = o.find(x => x.kind === 'route' && x.variant === 'walked');
    expect(ahead && ahead.kind === 'route' && ahead.points[0]).toEqual(moving.pos);
    expect(walked && walked.kind === 'route' && walked.points.at(-1)).toEqual(moving.pos);
    expect(o.find(x => x.kind === 'traveller')).toMatchObject({ variant: 'solid', errorM: moving.posErrorM });
    expect(o.find(x => x.kind === 'ring')).toMatchObject({ radiusM: 100, label: '100 m' });
    expect(o.filter(x => x.kind === 'waypoint')).toHaveLength(1); // only the next waypoint
  });
  it('draws nothing before a route has arrived', () =>
    expect(fieldOverlays(fieldStateAt([sent], 100_000))).toEqual([]));
  it('draws no walked path before the traverse starts', () => {
    const ready = fieldStateAt([sent], 700_000);
    expect(ready.status).toBe('ready');
    expect(fieldOverlays(ready).some(x => x.kind === 'route' && x.variant === 'walked')).toBe(false);
  });
});

describe('fieldCells and fieldBars', () => {
  it('labels the six cells for an astronaut', () =>
    expect(fieldCells(moving).map(c => c.label)).toEqual(['Distance', 'ETA', 'Pace', 'Pos error', 'Last fix', 'Elevation']));
  it('swaps the readouts for a rover', () => {
    const rover = fieldStateAt([{ ...sent, traveller: 'rover' }, start], 1_300_000);
    expect(fieldCells(rover)[2].label).toBe('Speed');
    expect(fieldBars(rover).map(b => b.label)).toEqual(['Tilt', 'Climb left']);
    expect(fieldBars(moving).map(b => b.label)).toEqual(['Slope', 'Climb left']);
  });
  it('turns the last fix amber when it is stale and the error amber when it is large', () => {
    const late = fieldStateAt([sent, start], 700_000 + 2_401_000);
    expect(fieldCells(late)[4]).toMatchObject({ value: '40:01', tone: 'caution' });
    expect(fieldCells(moving)[3]).toMatchObject({ value: '±14', tone: 'nominal' }); // 650 m since the base
    const long = { ...sent, route: straightRoute(6000) };
    expect(fieldCells(fieldStateAt([long, start], 700_000 + 4_700_000))[3].tone).toBe('caution'); // about 5.1 km: ±103 m
  });
  it('keeps the error green right after a photo fix (±47 m, from a real engine run)', () => {
    const fix: MissionEvent = { id: 'p1', tMs: 900_000, type: 'photo-fix', origin: 'field' };
    expect(fieldCells(fieldStateAt([sent, start, fix], 1_000_000))[3]).toMatchObject({ value: '±50', tone: 'nominal' });
  });
  it('shows dashes for the error before a route arrives', () =>
    expect(fieldCells(fieldStateAt([sent], 100_000))[3]).toEqual({ label: 'Pos error', value: '--', tone: 'plain' }));
  it('shows remaining distance, ETA and pace while moving', () => {
    const [distance, eta, pace] = fieldCells(moving);
    expect(distance).toMatchObject({ value: '1.35', unit: 'km' }); // 2000 - 650
    expect(eta.value).toBe('20:46'); // 1350 m at 3.9 km/h
    expect(pace).toMatchObject({ value: '3.9', unit: 'km/h' });
  });
  it('shows dashes for the ETA when not moving', () =>
    expect(fieldCells(fieldStateAt([sent], 700_000))[1].value).toBe('--:--'));
  it('reads the real terrain under the traveller', () => {
    const [elevation] = fieldCells(moving).slice(5);
    expect(elevation.unit).toBe('m');
    expect(Number(elevation.value.replace(',', ''))).toBeLessThan(-2400); // Jezero floor, about -2,570 m
    const [slope, climbLeft] = fieldBars(moving);
    expect(slope.unit).toBe('°');
    expect(climbLeft.unit).toBe('m');
    const done = fieldBars(fieldStateAt([sent, start], 9_000_000))[1];
    expect(done.value).toBe('0'); // nothing left to climb at the end
  });
});

describe('fieldCamera', () => {
  it('follows the traveller heading-up', () =>
    expect(fieldCamera(moving)).toMatchObject({ mode: 'follow', zoom: 15.5, headingDeg: moving.headingDeg }));
  it('keeps the traveller above a panel covering the bottom of the map', () =>
    expect(fieldCamera(moving, 120)).toMatchObject({ mode: 'follow', insetBottomPx: 120 }));
  it('fits the demo area before a route arrives', () =>
    expect(fieldCamera(fieldStateAt([sent], 100_000)).mode).toBe('fit'));
});

describe('nextMoveView', () => {
  it('names the next move and the waypoint count', () => {
    const v = nextMoveView(moving)!;
    expect(v).toMatchObject({ maneuver: 'continue', text: 'Continue', waypoint: 'WP 2 · WP 2', waypointNumber: 2, waypointTotal: 4 });
    expect(v.distance).toEqual({ value: '350', unit: 'm' });
    expect(v.heading).toBe('000°');
  });
  it('says arrived at the end', () =>
    expect(nextMoveView(fieldStateAt([sent, start], 9_000_000))).toMatchObject({ maneuver: 'arrive', text: 'Arrived' }));
  it('is empty before a route arrives', () =>
    expect(nextMoveView(fieldStateAt([sent], 100_000))).toBeNull());
});

describe('fieldCue', () => {
  it('shows a fix cue for four minutes after a photo fix', () => {
    const fix: MissionEvent = { id: 'p1', tMs: 900_000, type: 'photo-fix', origin: 'field' };
    expect(fieldCue(fieldStateAt([sent, start, fix], 1_000_000)).fix).toBe(true);
    expect(fieldCue(fieldStateAt([sent, start, fix], 1_200_000)).fix).toBe(false);
    expect(fieldCue(fieldStateAt([sent, start], 750_000)).fix).toBe(false); // the start is not a photo fix
  });
  it('flags a route change for four minutes after it arrives', () => {
    const change: MissionEvent = { id: 'c', tMs: 800_000, type: 'route-changed', origin: 'control', route: R, hazards: [], reason: 'replan' };
    expect(fieldCue(fieldStateAt([sent, start, change], 1_500_000)).routeChanged).toBe(true);
    expect(fieldCue(fieldStateAt([sent, start, change], 1_800_000)).routeChanged).toBe(false);
  });
});

describe('fieldLog', () => {
  const msg: MissionEvent = { id: 'm1', tMs: 100_000, type: 'message', origin: 'control', text: 'Check the dunes.' };
  const report: MissionEvent = { id: 'f1', tMs: 900_000, type: 'report', origin: 'field', text: 'Copy.' };
  const ack: MissionEvent = { id: 'a1', tMs: 950_000, type: 'ack', origin: 'field', targetId: 'm1' };
  it('lists messages both ways, newest first, with where each one stands', () => {
    const log = fieldLog(fieldStateAt([sent, msg, report], 1_000_000));
    expect(log.map(e => [e.id, e.dir, e.state])).toEqual([
      ['f1', 'out', 'ARRIVES IN 09:40'],
      ['m1', 'in', 'TAP TO ACKNOWLEDGE'],
    ]);
    expect(log[1]).toMatchObject({ ackable: true, tone: 'caution', ageMs: 900_000 });
  });
  it('marks acknowledged and delivered messages', () => {
    const log = fieldLog(fieldStateAt([sent, msg, report, ack], 1_600_000));
    expect(log.map(e => e.state)).toEqual(['DELIVERED', 'ACKNOWLEDGED']);
    expect(log.every(e => !e.ackable && e.tone === 'nominal')).toBe(true);
  });
  it('is empty before any message', () => expect(fieldLog(moving)).toEqual([]));
  it('gives a short status for the LOG button', () => {
    expect(reportStatusShort(fieldStateAt([sent, report], 1_000_000))).toEqual({ text: '▲ 09:40', tone: 'caution' });
    expect(reportStatusShort(fieldStateAt([sent, report], 1_580_000))?.text).toBe('DELIVERED');
  });
});
