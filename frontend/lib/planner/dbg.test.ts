import { writeFileSync } from 'node:fs';
import { it } from 'vitest';
import { DEFAULT_START, DEFAULT_END, PRESET_HAZARDS, planRoutes, elevationAt } from '@/lib/planner';
import { distanceM } from '@/lib/nav/geo';
const sep = (a: any, b: any) => Math.max(...a.points.map((p: any) => Math.min(...b.points.map((q: any) => distanceM(p, q)))));
it('dbg', () => {
  const out: string[] = [];
  for (const [s, e] of [[DEFAULT_START, DEFAULT_END], [{ lat: 18.43, lon: 77.395 }, { lat: 18.485, lon: 77.465 }]]) {
    const t = performance.now();
    const r = planRoutes(s, e, PRESET_HAZARDS);
    out.push('ms ' + (performance.now() - t).toFixed(0));
    r.forEach(x => out.push([x.profile, x.lengthM.toFixed(0), x.maxSlopeDeg.toFixed(1), x.risk].join(' ')));
    out.push('sep sf ' + sep(r[0], r[1]).toFixed(0) + '/' + sep(r[1], r[0]).toFixed(0) + ' sfl ' + sep(r[0], r[2]).toFixed(0) + '/' + sep(r[2], r[0]).toFixed(0) + ' shfl ' + sep(r[1], r[2]).toFixed(0) + '/' + sep(r[2], r[1]).toFixed(0));
  }
  let lo = 1e9, hi = -1e9;
  for (let la = 18.415; la <= 18.5; la += 0.0005) for (let l2 = 77.38; l2 <= 77.48; l2 += 0.0005) { const z = elevationAt({ lat: la, lon: l2 }); lo = Math.min(lo, z); hi = Math.max(hi, z); }
  out.push('range ' + lo.toFixed(1) + ' ' + hi.toFixed(1));
  writeFileSync('C:/tmp/Temp/claude/90606e02db838af1/5b90a930-5e38-451d-b80a-0839a6988cb4/scratchpad/dbg.txt', out.join('\n'));
});
it('far', () => {
  const r = planRoutes(DEFAULT_START, DEFAULT_END, PRESET_HAZARDS);
  let best = r[0].points[0], bd = 0;
  for (const p of r[0].points) { const d = Math.min(...r[1].points.map(q => distanceM(p, q))); if (d > bd) { bd = d; best = p; } }
  writeFileSync('C:/tmp/Temp/claude/90606e02db838af1/5b90a930-5e38-451d-b80a-0839a6988cb4/scratchpad/far.txt', JSON.stringify(best) + ' ' + bd);
});
