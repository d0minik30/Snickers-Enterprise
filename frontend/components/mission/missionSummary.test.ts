import { describe, expect, it } from 'vitest';
import { missionSummary } from '@/components/mission/missionSummary';
import { PACE_MPS, type MissionEvent } from '@/lib/mission/types';
import { cumulativeM } from '@/lib/nav/geo';
import type { Route } from '@/lib/planner/types';
import { straightRoute } from '@/lib/testing/fixtures';

const out = straightRoute(1000);
const points = [...out.points, ...out.points.slice(0, -1).reverse()];
const outAndBack: Route = { ...out, id: 'out-and-back', points, elevationM: points.map(() => 0), lengthM: cumulativeM(points).at(-1)! };
const start: MissionEvent = { id: 's1', tMs: 700_000, type: 'traverse-started', origin: 'field' };
const sent = (route: Route): MissionEvent => ({ id: 'r1', tMs: 0, type: 'route-sent', origin: 'control', traveller: 'astronaut', route, hazards: [] });
const after = (route: Route) => 700_000 + (route.lengthM / PACE_MPS.astronaut) * 1000 + 60_000;

describe('missionSummary', () => {
  it('reports an arrival at the destination', () => {
    expect(missionSummary([sent(out), start], after(out))).toMatchObject({ returned: false });
  });

  it('reports a route that ends at its own start as a return, not an arrival', () => {
    expect(missionSummary([sent(outAndBack), start], after(outAndBack))).toMatchObject({ returned: true });
  });
});
