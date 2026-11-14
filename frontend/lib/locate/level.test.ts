import { describe, expect, it } from 'vitest';
import { gravityFromPitchRoll, levelLine, pinhole, pitchRollFromGravity, tiltFromMotion } from '@/lib/locate/level';
import { hfovFor } from '@/lib/locate/presets';

describe('gravity and pitch/roll', () => {
  it('round-trips (same conventions as backend/skyline/level.py)', () => {
    for (const [p, r] of [[0, 0], [10, 0], [-7, 4], [3, -12]]) {
      const back = pitchRollFromGravity(gravityFromPitchRoll(p, r));
      expect(back.pitchDeg).toBeCloseTo(p, 9);
      expect(back.rollDeg).toBeCloseTo(r, 9);
    }
  });
});

describe('levelLine', () => {
  const cam = pinhole(1000, 750, 60);
  it('runs through the middle row for a level camera', () => {
    const pts = levelLine(cam, 0, 0);
    expect(pts.length).toBeGreaterThan(10);
    for (const [, v] of pts) expect(v).toBeCloseTo(cam.cy, 6);
  });
  it('drops by f*tan(pitch) when the camera looks up', () => {
    const pts = levelLine(cam, 10, 0);
    const centre = pts.reduce((a, b) => (Math.abs(b[0] - cam.cx) < Math.abs(a[0] - cam.cx) ? b : a));
    expect(centre[1]).toBeCloseTo(cam.cy + cam.f * Math.tan((10 * Math.PI) / 180), 0);
  });
  it('rises on the right when the right side of the camera dips', () => {
    const pts = levelLine(cam, 0, 5);
    const left = pts[0];
    const right = pts[pts.length - 1];
    expect(right[1]).toBeLessThan(left[1]);
  });
});

describe('tiltFromMotion', () => {
  const g = 9.81;
  it('upright portrait phone looking at the horizon is level', () => {
    const t = tiltFromMotion(0, g, 0, 0)!; // accelerometer reads +y (up the screen) when upright
    expect(t.pitchDeg).toBeCloseTo(0, 9);
    expect(t.rollDeg).toBeCloseTo(0, 9);
  });
  it('tilting the top of the phone back points the camera up', () => {
    const p = (15 * Math.PI) / 180;
    // Gravity in the device frame is (0, -cos p, +sin p) when the back camera points up by p.
    const t = tiltFromMotion(0, g * Math.cos(p), -g * Math.sin(p), 0)!;
    expect(t.pitchDeg).toBeCloseTo(15, 9);
  });
  it('dipping the right side gives positive roll', () => {
    const r = (8 * Math.PI) / 180;
    const t = tiltFromMotion(-g * Math.sin(r), g * Math.cos(r), 0, 0)!;
    expect(t.rollDeg).toBeCloseTo(8, 9);
  });
  it('a level landscape phone (screen turned 90 degrees) is level too', () => {
    const t = tiltFromMotion(g, 0, 0, 90)!; // device's right edge points up
    expect(t.pitchDeg).toBeCloseTo(0, 9);
    expect(t.rollDeg).toBeCloseTo(0, 9);
  });
  it('gives nothing without real sensor data', () => {
    expect(tiltFromMotion(0, 0, 0, 0)).toBeNull();
    expect(tiltFromMotion(NaN, 1, 1, 0)).toBeNull();
  });
});

describe('hfovFor', () => {
  it('matches the skyline API for phone and Perseverance presets', () => {
    // 26 mm equivalent on a 4:3 photo: 2 atan(34.62 / 52) = 67.30 deg, the same formula as metadata.py
    expect(hfovFor({ kind: 'preset', id: 'iphone-main' }, 4032, 3024)).toBeCloseTo(67.3, 1);
    expect(hfovFor({ kind: 'preset', id: 'm2020-navcam' }, 1280, 960)).toBe(96);
    expect(hfovFor({ kind: 'fov', hfovDeg: 55 }, 10, 10)).toBe(55);
    expect(hfovFor({ kind: 'auto' }, 10, 10)).toBeNull();
  });
});
