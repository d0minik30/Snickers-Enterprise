'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { insideDemoBounds } from '@/components/control/controlModel';
import type { TravellerKind } from '@/lib/mission/types';
import { DEFAULT_END, DEFAULT_START, PRESET_HAZARDS, planRoutes } from '@/lib/planner';
import type { LatLon, Route, RouteProfile } from '@/lib/planner/types';

export type ArmedEnd = 'start' | 'end' | null;

export type PlanDraft = {
  traveller: TravellerKind;
  setTraveller: (t: TravellerKind) => void;
  start: LatLon;
  end: LatLon;
  arming: ArmedEnd;
  arm: (which: 'start' | 'end') => void;
  placeAt: (p: LatLon) => void;
  routes: Route[];
  selected: RouteProfile;
  select: (p: RouteProfile) => void;
  tooClose: boolean;
  reset: () => void;
};

/** The route being planned in Control. It lives only in this window until it is sent. */
export function usePlanDraft(): PlanDraft {
  const [traveller, setTraveller] = useState<TravellerKind>('astronaut');
  const [start, setStart] = useState<LatLon>(DEFAULT_START);
  const [end, setEnd] = useState<LatLon>(DEFAULT_END);
  const [arming, setArming] = useState<ArmedEnd>(null);
  const [selected, select] = useState<RouteProfile>('safest');

  const routes = useMemo(() => planRoutes(start, end, PRESET_HAZARDS), [start, end]);

  // Pressing the armed end's button again disarms it.
  const arm = useCallback((which: 'start' | 'end') => setArming(current => (current === which ? null : which)), []);

  const placeAt = useCallback((p: LatLon) => {
    if (!arming || !insideDemoBounds(p)) return;
    if (arming === 'start') setStart(p);
    else setEnd(p);
    setArming(null);
  }, [arming]);

  const reset = useCallback(() => {
    setTraveller('astronaut');
    setStart(DEFAULT_START);
    setEnd(DEFAULT_END);
    setArming(null);
    select('safest');
  }, []);

  useEffect(() => {
    if (!arming) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setArming(null); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [arming]);

  return {
    traveller, setTraveller, start, end, arming, arm, placeAt,
    routes, selected, select, tooClose: routes.length === 0, reset,
  };
}
