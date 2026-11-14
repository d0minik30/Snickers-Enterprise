// Fixing a traced skyline by hand. Pure functions: each returns a new trace and never changes its input.
// Columns are indices into trace.x / y / weight / reason (one per photo column, left to right).

import type { Reason, Trace } from '@/lib/locate/types';

export type Tool = 'move' | 'erase' | 'rock' | 'restore';

const copy = (t: Trace): Trace => ({ ...t, y: [...t.y], weight: [...t.weight], reason: [...t.reason] });

/** The column nearest to photo x. */
export function columnAt(t: Trace, x: number): number {
  let lo = 0;
  let hi = t.x.length - 1;
  if (x <= t.x[lo]) return lo;
  if (x >= t.x[hi]) return hi;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (t.x[mid] <= x) lo = mid;
    else hi = mid;
  }
  return x - t.x[lo] <= t.x[hi] - x ? lo : hi;
}

/**
 * Drag the line at column i to row y. Neighbours within `radius` columns follow with a smooth
 * (cosine) falloff, so one drag reshapes a stretch instead of making a spike. A moved stretch counts
 * as checked by the user: its weight becomes 1 unless the user marked it erased or a rock.
 */
export function movePoint(t: Trace, i: number, y: number, radius: number): Trace {
  const out = copy(t);
  const dy = Math.min(Math.max(y, 0), t.height - 1) - t.y[i];
  const r = Math.max(0, Math.round(radius));
  for (let k = Math.max(0, i - r); k <= Math.min(t.x.length - 1, i + r); k++) {
    const f = r === 0 ? 1 : 0.5 * (1 + Math.cos((Math.PI * (k - i)) / (r + 1)));
    out.y[k] = Math.min(Math.max(t.y[k] + dy * f, 0), t.height - 1);
    if (f > 0.5 && t.reason[k] !== 'erased' && t.reason[k] !== 'rock') {
      out.weight[k] = 1;
      out.reason[k] = null;
    }
  }
  return out;
}

/** Mark columns a..b (either order, inclusive) as not to trust, with the user's reason. */
export function markRange(t: Trace, a: number, b: number, reason: Extract<Reason, 'erased' | 'rock'>): Trace {
  const out = copy(t);
  for (let k = Math.max(0, Math.min(a, b)); k <= Math.min(t.x.length - 1, Math.max(a, b)); k++) {
    out.weight[k] = 0;
    out.reason[k] = reason;
  }
  return out;
}

/** Put columns a..b back as first traced: line, weight and reason. */
export function restoreRange(t: Trace, original: Trace, a: number, b: number): Trace {
  const out = copy(t);
  for (let k = Math.max(0, Math.min(a, b)); k <= Math.min(t.x.length - 1, Math.max(a, b)); k++) {
    out.y[k] = original.y[k];
    out.weight[k] = original.weight[k];
    out.reason[k] = original.reason[k];
  }
  return out;
}

/** True when the user changed anything compared with the first trace. */
export function isEdited(t: Trace, original: Trace): boolean {
  return t.y.some((y, k) => y !== original.y[k]) || t.weight.some((w, k) => w !== original.weight[k]);
}

/** Runs of consecutive columns where test(k) holds, as [first, last], for drawing. */
export function runs(t: Trace, test: (k: number) => boolean): [number, number][] {
  const out: [number, number][] = [];
  let start = -1;
  for (let k = 0; k <= t.x.length; k++) {
    const on = k < t.x.length && test(k);
    if (on && start < 0) start = k;
    if (!on && start >= 0) {
      out.push([start, k - 1]);
      start = -1;
    }
  }
  return out;
}

/** Share of columns the engine will use (weight >= 0.5). */
export function trustedShare(t: Trace): number {
  return t.weight.filter(w => w >= 0.5).length / Math.max(1, t.weight.length);
}
