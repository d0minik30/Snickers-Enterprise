import type { Hazard, LatLon } from '@/lib/planner/types';

export type MapOverlay =
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
