// Example photos for the "find me from a photo" demo on the map, and the engine's saved answer for them.
// The photos are real Perseverance Navcam images (NASA/JPL-Caltech), stored in public/demo-photos/.
// The answer is a real live run of the engine on exactly these three photos, on the current terrain
// (lib/locate/fixtures/engine-pose3-770.json, the same answer the Locate screen shows when saved or offline).

import fixture from '@/lib/locate/fixtures/engine-pose3-770.json';
import { isLocateResult, type LocateRequest, type LocateResult } from '@/lib/locate/types';

export type DemoPhoto = { id: string; url: string; sha256: string };

/** SHA-256 of each file as published by NASA (as in data/test_photos/manifest.json). */
const SHA256: Record<string, string> = {
  NLF_0020_0668728525_175ECM_N0030770NCAM03020_01_295J: '88eb7d8ff346689d5c31189cc6ce053eed3cbe3db753151b3989c0904176ea46',
  NLF_0020_0668728577_477ECM_N0030770NCAM02020_01_295J: '8c77bc04eb0295600212c9f4bd8eb610de4d11ae285be8a72f22fb9da4771ab0',
  NLF_0020_0668728666_168ECM_N0030770NCAM02020_01_295J: 'c7932684f7df229a82d1c5796aaddcd36ed01012c8cc06c6a866c10cda0a05b5',
};

export const DEMO_PHOTOS: DemoPhoto[] = Object.entries(SHA256).map(([id, sha256]) => ({
  id, sha256, url: `/demo-photos/${id}.png`,
}));

/** Where the rover really was for these photos (NASA Mars 2020 localized waypoint, site 3 drive 770). */
export const DEMO_TRUTH = { lat: 18.44514836, lon: 77.45185605, label: 'Real rover position (NASA)' };

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
