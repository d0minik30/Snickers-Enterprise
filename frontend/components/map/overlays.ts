import { SAND_MIN_LABELLED_CELLS, sandAreas } from '@/lib/planner';
import type { Hazard, LatLon } from '@/lib/planner/types';

export type MapOverlay =
  | { kind: 'area'; id: string; rings: LatLon[][]; variant: 'sand' } // drawn under everything else
  | { kind: 'route'; id: string; points: LatLon[]; variant: 'active' | 'walked' | 'alternative' | 'alternative-dotted' | 'pending' }
  | { kind: 'hazard'; id: string; hazard: Hazard; pending?: boolean }
  | { kind: 'waypoint'; id: string; pos: LatLon; label: string }
  | { kind: 'endpoint'; id: string; pos: LatLon; variant: 'start' | 'end' }
  | { kind: 'traveller'; id: string; pos: LatLon; headingDeg: number; errorM: number; variant: 'solid' | 'ghost' }
  | { kind: 'ring'; id: string; center: LatLon; radiusM: number; label: string }
  | { kind: 'label'; id: string; pos: LatLon; text: string; tone: 'plain' | 'route' | 'caution' | 'inverse'; offsetY?: number }; // offsetY in screen px, + is down

export type MapCamera =
  // heading-up, traveller at 65 % of the height left uncovered; insetBottomPx = how much a panel covers at the bottom
  | { mode: 'follow'; center: LatLon; headingDeg: number; zoom: number; insetBottomPx?: number }
  | { mode: 'fit'; points: LatLon[] } // north-up, fitted with padding
  | { mode: 'free' }; // user pans and zooms, limited to DEMO_BOUNDS

/** Real mapped sand (eolian bedforms) in the demo area: the areas, and a chip on each patch big enough to read. */
export function sandOverlays(): { areas: MapOverlay[]; labels: MapOverlay[] } {
  const patches = sandAreas();
  return {
    areas: patches.map(a => ({ kind: 'area', id: `area:${a.id}`, rings: a.rings, variant: 'sand' })),
    labels: patches
      .filter(a => a.cells >= SAND_MIN_LABELLED_CELLS)
      .map(a => ({ kind: 'label', id: `label:${a.id}`, pos: a.labelAt, text: 'Sand', tone: 'plain' })),
  };
}
