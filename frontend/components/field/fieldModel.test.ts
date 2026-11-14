import { describe, expect, it } from 'vitest';
import { fieldBars, fieldCamera, fieldCells, fieldCue, fieldOverlays, nextMoveView } from '@/components/field/fieldModel';
import { fieldStateAt } from '@/lib/mission/field';
import type { MissionEvent } from '@/lib/mission/types';
import { straightRoute } from '@/lib/testing/fixtures';

const R = straightRoute(2000);
const sent: MissionEvent = { id: 'r1', tMs: 0, type: 'route-sent', origin: 'control', traveller: 'astronaut', route: R, hazards: [] };
const start: MissionEvent = { id: 's1', tMs: 700_000, type: 'traverse-started', origin: 'field' };
const moving = fieldStateAt([sent, start], 1_300_000, []);

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
    expect(fieldOverlays(fieldStateAt([sent], 100_000, []))).toEqual([]));
  it('draws no walked path before the traverse starts', () => {
    const ready = fieldStateAt([sent], 700_000, []);
    expect(ready.status).toBe('ready');
    expect(fieldOverlays(ready).some(x => x.kind === 'route' && x.variant === 'walked')).toBe(false);
  });
});

describe('fieldCells and fieldBars', () => {
  it('labels the six cells for an astronaut', () =>
    expect(fieldCells(moving).map(c => c.label)).toEqual(['Distance', 'ETA', 'Pace', 'Pos error', 'Last fix', 'Next pass']));
  it('swaps the readouts for a rover', () => {
    const rover = fieldStateAt([{ ...sent, traveller: 'rover' }, start], 1_300_000, []);
    expect(fieldCells(rover)[2].label).toBe('Speed');
    expect(fieldBars(rover).map(b => b.label)).toEqual(['Battery', 'Tilt']);
    expect(fieldBars(moving).map(b => b.label)).toEqual(['O₂', 'Power']);
  });
  it('turns the last fix amber when it is stale and the error amber when it is large', () => {
    const late = fieldStateAt([sent, start], 700_000 + 181_000, []);
    expect(fieldCells(late)[4]).toMatchObject({ value: '03:01', tone: 'caution' });
    expect(fieldCells(moving)[3].tone).toBe('caution'); // 650 m without a fix is about ±14 m
    expect(fieldCells(fieldStateAt([sent, start], 760_000, []))[3]).toMatchObject({ value: '±3', tone: 'nominal' });
  });
  it('shows remaining distance, ETA and pace while moving', () => {
    const [distance, eta, pace] = fieldCells(moving);
    expect(distance).toMatchObject({ value: '1.35', unit: 'km' }); // 2000 - 650
    expect(eta.value).toBe('20:46'); // 1350 m at 3.9 km/h
    expect(pace).toMatchObject({ value: '3.9', unit: 'km/h' });
  });
  it('shows dashes for the ETA when not moving', () =>
    expect(fieldCells(fieldStateAt([sent], 700_000, []))[1].value).toBe('--:--'));
  it('drains the consumables with mission time and never below 5 %', () => {
    const [o2, power] = fieldBars(moving); // 10 min after the start
    expect(o2).toMatchObject({ value: '91', unit: '%' });
    expect(power.value).toBe('90');
    const [o2Late] = fieldBars(fieldStateAt([sent, start], 700_000 + 600 * 60_000, []));
    expect(o2Late.fraction).toBeCloseTo(0.05, 5);
  });
});

describe('fieldCamera', () => {
  it('follows the traveller heading-up', () =>
    expect(fieldCamera(moving)).toMatchObject({ mode: 'follow', zoom: 15.5, headingDeg: moving.headingDeg }));
  it('fits the demo area before a route arrives', () =>
    expect(fieldCamera(fieldStateAt([sent], 100_000, [])).mode).toBe('fit'));
});

describe('nextMoveView', () => {
  it('names the next move and the waypoint count', () => {
    const v = nextMoveView(moving)!;
    expect(v).toMatchObject({ maneuver: 'continue', text: 'Continue', waypoint: 'WP 2 · WP 2', waypointNumber: 2, waypointTotal: 4 });
    expect(v.distance).toEqual({ value: '350', unit: 'm' });
    expect(v.heading).toBe('000°');
  });
  it('says arrived at the end', () =>
    expect(nextMoveView(fieldStateAt([sent, start], 9_000_000, []))).toMatchObject({ maneuver: 'arrive', text: 'Arrived' }));
  it('is empty before a route arrives', () =>
    expect(nextMoveView(fieldStateAt([sent], 100_000, []))).toBeNull());
});

describe('fieldCue', () => {
  it('shows a fix cue for four minutes after a pass', () => {
    const passes = [{ satellite: 'MRO', tMs: 900_000, quality: 'overhead' as const }];
    expect(fieldCue(fieldStateAt([sent, start], 1_000_000, passes)).fix).toBe(true);
    expect(fieldCue(fieldStateAt([sent, start], 1_200_000, passes)).fix).toBe(false);
    expect(fieldCue(fieldStateAt([sent, start], 750_000, passes)).fix).toBe(false); // the start is not a pass
  });
  it('flags a route change for four minutes after it arrives', () => {
    const change: MissionEvent = { id: 'c', tMs: 800_000, type: 'route-changed', origin: 'control', route: R, hazards: [], reason: 'replan' };
    expect(fieldCue(fieldStateAt([sent, start, change], 1_500_000, [])).routeChanged).toBe(true);
    expect(fieldCue(fieldStateAt([sent, start, change], 1_800_000, [])).routeChanged).toBe(false);
  });
});
