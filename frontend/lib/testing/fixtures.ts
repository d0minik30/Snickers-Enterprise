import type { LatLon, Route, Waypoint } from '@/lib/planner/types';
import { cumulativeM, destination, pointAlong } from '@/lib/nav/geo';
import { spliceRoute } from '@/lib/planner';

export const ORIGIN: LatLon = { lat: 18.4446, lon: 77.4509 };

const WAYPOINT_SPACING_M = 500;

function flatRoute(id: string, points: LatLon[], waypoints: Waypoint[]): Route {
  return {
    id,
    profile: 'safest',
    points,
    elevationM: points.map(() => 0),
    waypoints,
    lengthM: cumulativeM(points).at(-1) ?? 0,
    maxSlopeDeg: 0,
    risk: 'low',
  };
}

export function straightRoute(lengthM = 2000, stepM = 500, bearing = 0): Route {
  const points: LatLon[] = [];
  for (let d = 0; d < lengthM; d += stepM) points.push(destination(ORIGIN, bearing, d));
  points.push(destination(ORIGIN, bearing, lengthM));
  const waypoints: Waypoint[] = [];
  for (let d = WAYPOINT_SPACING_M, n = 1; d < lengthM; d += WAYPOINT_SPACING_M, n++) {
    waypoints.push({ name: `WP ${n}`, distM: d, pos: destination(ORIGIN, bearing, d) });
  }
  const route = flatRoute(`fixture:straight:${lengthM}`, points, waypoints);
  waypoints.push({ name: 'End', distM: route.lengthM, pos: points[points.length - 1] });
  return route;
}

/** `old` diverted at `branchDistM` onto a 400 m tail running due east. */
export function divertedRoute(old: Route, branchDistM: number): Route {
  const start = pointAlong(old.points, branchDistM).pos;
  const end = destination(start, 90, 400);
  const tail = flatRoute('fixture:tail', [start, end], [{ name: 'End', distM: 400, pos: end }]);
  return spliceRoute(old, branchDistM, tail);
}

export function cornerRoute(): Route {
  const points: LatLon[] = [];
  for (let d = 0; d <= 300; d += 10) points.push(destination(ORIGIN, 0, d));
  const corner = points[points.length - 1];
  for (let d = 10; d <= 300; d += 10) points.push(destination(corner, 270, d));
  const end = points[points.length - 1];
  return flatRoute('fixture:corner', points, [{ name: 'End', distM: cumulativeM(points).at(-1) ?? 0, pos: end }]);
}
