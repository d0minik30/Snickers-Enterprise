// Example photos for the "find me from a photo" demo on the map, and the engine's saved answer for them.
// The photos are real Perseverance Navcam images (NASA/JPL-Caltech), stored in public/demo-photos/.
// The answer is a real, earlier run of the engine on exactly these six photos (lib/locate/fixtures).

import fixture from '@/lib/locate/fixtures/engine-sol17-18.json';
import { isLocateResult, type LocateRequest, type LocateResult } from '@/lib/locate/types';

export type DemoPhoto = { id: string; url: string; sha256: string };

/** SHA-256 of each file as published by NASA (the browse PNG). */
const SHA256: Record<string, string> = {
  NLF_0017_0668451937_008ECM_N0030578NCAM00195_01_290J: '7f1abe4676f90fb68b6593e40c2e5a3f2643100d1e6f0a8b397840d1f5bb3491',
  NLF_0017_0668453452_115ECM_N0030578NCAM00186_01_290J: '8a3a9e951768cfd2e706b0c2ca35658a7d58ed313d76ef8b0fc5bde5ce74fb3f',
  NLF_0017_0668454934_320ECM_N0030578NCAM00184_01_290J: 'e470be908ee16b740cb95cb6560ced79b11ec9a3e4887baf1b9114a0a88725bd',
  NLF_0018_0668545642_177ECM_N0030578NCAM00190_01_290J: '1876a20347df334c478dfe6c01c8253384410265d3c718852b9b65962f61852e',
  NLF_0018_0668547197_285ECM_N0030578NCAM00189_01_290J: '7cc5b982e325126d1f148cc625c5781c84a731cfeebd73b860ac3c5dfc719237',
  NLF_0018_0668555532_151ECM_N0030578NCAM00188_01_290J: '30b1dce0b4898e121c6197332917520f15112179accb73e94a76eb947f2137f5',
};

export const DEMO_PHOTOS: DemoPhoto[] = Object.entries(SHA256).map(([id, sha256]) => ({
  id, sha256, url: `/demo-photos/${id}.png`,
}));

/** Where the rover really was for these photos (NASA Mars 2020 localized waypoint, site 3 drive 578). */
export const DEMO_TRUTH = { lat: 18.4452799, lon: 77.45149726, label: 'Real rover position (NASA)' };

export type DemoAnswer = { request: LocateRequest; result: LocateResult; photoCount: number };

const file = fixture as unknown as { request: LocateRequest; result: unknown };

/** The saved answer, if every photo given is one of the example photos. Matched by file content or by name. */
export function demoAnswerFor(photos: { sha256: string; name: string }[]): DemoAnswer | null {
  if (photos.length === 0 || !isLocateResult(file.result)) return null;
  const known = (p: { sha256: string; name: string }) =>
    DEMO_PHOTOS.some(d => d.sha256 === p.sha256 || p.name.includes(d.id));
  if (!photos.every(known)) return null;
  return { request: file.request, result: file.result, photoCount: DEMO_PHOTOS.length };
}

export async function sha256Hex(blob: Blob): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', await blob.arrayBuffer());
  return Array.from(new Uint8Array(digest), b => b.toString(16).padStart(2, '0')).join('');
}
