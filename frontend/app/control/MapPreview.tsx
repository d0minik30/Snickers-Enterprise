'use client';

// Temporary visual check for the map component; Task 7 replaces this page.
import dynamic from 'next/dynamic';
import { useMemo } from 'react';
import type { MapCamera, MapOverlay } from '@/components/map/overlays';
import { pointAlong } from '@/lib/nav/geo';
import { DEFAULT_END, DEFAULT_START, PRESET_HAZARDS, planRoutes } from '@/lib/planner';

const MarsMap = dynamic(() => import('@/components/map/MarsMap'), { ssr: false });

const CAMERA: MapCamera = { mode: 'fit', points: [DEFAULT_START, DEFAULT_END] };

export default function MapPreview() {
  const overlays = useMemo<MapOverlay[]>(() => {
    const [safest, shortest, flattest] = planRoutes(DEFAULT_START, DEFAULT_END, PRESET_HAZARDS);
    return [
      ...PRESET_HAZARDS.map(h => ({ kind: 'hazard' as const, id: h.id, hazard: h })),
      { kind: 'route', id: shortest.id, points: shortest.points, variant: 'alternative' },
      { kind: 'route', id: flattest.id, points: flattest.points, variant: 'alternative-dotted' },
      { kind: 'route', id: safest.id, points: safest.points, variant: 'active' },
      { kind: 'endpoint', id: 'start', pos: DEFAULT_START, variant: 'start' },
      { kind: 'endpoint', id: 'end', pos: DEFAULT_END, variant: 'end' },
      { kind: 'traveller', id: 'traveller', pos: DEFAULT_START, headingDeg: pointAlong(safest.points, 0).bearingDeg, errorM: 6, variant: 'solid' },
    ];
  }, []);

  return (
    <div style={{ position: 'fixed', inset: 0 }}>
      <MarsMap overlays={overlays} camera={CAMERA} />
    </div>
  );
}
