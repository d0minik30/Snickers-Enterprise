import { describe, expect, it } from 'vitest';
import { columnAt, isEdited, markRange, movePoint, restoreRange, runs, trustedShare } from '@/lib/locate/edit';
import type { Trace } from '@/lib/locate/types';

const trace = (n = 11): Trace => ({
  width: 100, height: 80,
  x: Array.from({ length: n }, (_, i) => i * 10),
  y: Array(n).fill(40),
  weight: [0, 0.5, 1, 1, 1, 1, 1, 1, 1, 0.5, 0],
  reason: ['edge', 'edge', null, null, null, null, null, null, null, 'edge', 'edge'],
  sun_px: null,
});

describe('columnAt', () => {
  it('finds the nearest column, clamped to the ends', () => {
    const t = trace();
    expect(columnAt(t, 24)).toBe(2);
    expect(columnAt(t, 26)).toBe(3);
    expect(columnAt(t, -5)).toBe(0);
    expect(columnAt(t, 500)).toBe(10);
  });
});

describe('movePoint', () => {
  it('moves the column fully and its neighbours partly, without touching the input', () => {
    const t = trace();
    const m = movePoint(t, 5, 20, 2);
    expect(m.y[5]).toBe(20);
    expect(m.y[4]).toBeGreaterThan(20);
    expect(m.y[4]).toBeLessThan(40);
    expect(m.y[3]).toBeGreaterThan(m.y[4]);
    expect(m.y[2]).toBe(40);
    expect(t.y[5]).toBe(40);
  });
  it('counts a moved stretch as checked by the user', () => {
    const m = movePoint(trace(), 1, 30, 0);
    expect(m.weight[1]).toBe(1);
    expect(m.reason[1]).toBeNull();
  });
  it('keeps the line inside the photo', () => {
    expect(movePoint(trace(), 5, -50, 1).y[5]).toBe(0);
    expect(movePoint(trace(), 5, 500, 1).y[5]).toBe(79);
  });
  it('does not un-erase a stretch the user erased', () => {
    const erased = markRange(trace(), 4, 6, 'erased');
    const m = movePoint(erased, 5, 30, 1);
    expect(m.weight[5]).toBe(0);
    expect(m.reason[5]).toBe('erased');
  });
});

describe('markRange and restoreRange', () => {
  it('marks columns in either order and restores them as first traced', () => {
    const t = trace();
    const marked = markRange(t, 6, 3, 'rock');
    expect(marked.weight.slice(3, 7)).toEqual([0, 0, 0, 0]);
    expect(marked.reason.slice(3, 7)).toEqual(['rock', 'rock', 'rock', 'rock']);
    expect(marked.weight[7]).toBe(1);
    const moved = movePoint(marked, 8, 10, 0);
    const back = restoreRange(moved, t, 0, 10);
    expect(back).toEqual(t);
    expect(isEdited(back, t)).toBe(false);
    expect(isEdited(marked, t)).toBe(true);
  });
});

describe('runs and trustedShare', () => {
  it('groups consecutive columns and counts what the engine will use', () => {
    const t = markRange(trace(), 4, 5, 'erased');
    expect(runs(t, k => t.weight[k] >= 0.5)).toEqual([[1, 3], [6, 9]]);
    expect(trustedShare(t)).toBeCloseTo(7 / 11);
  });
});
