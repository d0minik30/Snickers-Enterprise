// Talks to the engine server: POST /skyline and /skyline/convert (backend/skyline) and POST /locate
// (backend/engine). The site is a static export, so the address is fixed at build time.

import { isSkyline, isSkylineResponse, type CameraSpec, type Skyline, type SkylineResponse, type Trace } from '@/lib/locate/types';

// Written out in full so Next.js inlines it at build time (a computed name would not be).
export const ENGINE_URL = (process.env.NEXT_PUBLIC_ENGINE_URL || 'http://localhost:8000').replace(/\/+$/, '');

export type EngineErrorKind = 'unreachable' | 'timeout' | 'refused' | 'server' | 'bad-response';

export class EngineError extends Error {
  constructor(readonly kind: EngineErrorKind, message: string, readonly status?: number) {
    super(message);
    this.name = 'EngineError';
  }
}

const TIMEOUT_MS = { skyline: 90_000, convert: 30_000, locate: 180_000 } as const;

type Fetch = typeof fetch;

async function call(path: string, init: RequestInit, timeoutMs: number, fetchImpl: Fetch = fetch): Promise<unknown> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let res: Response;
  try {
    res = await fetchImpl(`${ENGINE_URL}${path}`, { ...init, signal: controller.signal });
  } catch (e) {
    if (controller.signal.aborted) throw new EngineError('timeout', `No answer from the engine after ${Math.round(timeoutMs / 1000)} s.`);
    throw new EngineError('unreachable', `Cannot reach the engine at ${ENGINE_URL}. Is it running?`);
  } finally {
    clearTimeout(timer);
  }
  let body: unknown = null;
  try {
    body = await res.json();
  } catch {
    // not JSON: handled below
  }
  if (!res.ok) {
    const detail = (body as { detail?: unknown } | null)?.detail;
    const message = typeof detail === 'object' && detail && 'message' in detail && typeof detail.message === 'string'
      ? detail.message
      : typeof detail === 'string' ? detail : `HTTP ${res.status}`;
    if (res.status === 404) {
      throw new EngineError('refused', `The engine at ${ENGINE_URL} has no ${path} yet (HTTP 404).`, 404);
    }
    throw new EngineError(res.status >= 500 ? 'server' : 'refused', message, res.status);
  }
  if (body === null) throw new EngineError('bad-response', 'The engine answered, but not with JSON.');
  return body;
}

export async function postSkyline(photo: Blob, filename: string, camera: CameraSpec, label: unknown | null,
  fetchImpl?: Fetch): Promise<SkylineResponse> {
  const form = new FormData();
  form.append('photo', photo, filename);
  form.append('camera', JSON.stringify(camera));
  if (label !== null) form.append('label', new Blob([JSON.stringify(label)], { type: 'application/json' }), 'label.json');
  const body = await call('/skyline', { method: 'POST', body: form }, TIMEOUT_MS.skyline, fetchImpl);
  if (!isSkylineResponse(body)) throw new EngineError('bad-response', 'The skyline answer has an unexpected shape.');
  return body;
}

/** Angles for a trace the user edited. Same camera info as the original request. */
export async function postConvert(camera: CameraSpec, label: unknown | null, trace: Trace,
  fetchImpl?: Fetch): Promise<Skyline> {
  const payload = {
    camera, label, width: trace.width, height: trace.height,
    trace: { x: trace.x, y: trace.y, weight: trace.weight, sun_px: trace.sun_px },
  };
  const body = await call('/skyline/convert', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload),
  }, TIMEOUT_MS.convert, fetchImpl);
  const skyline = (body as { skyline?: unknown }).skyline;
  if (!isSkyline(skyline)) throw new EngineError('bad-response', 'The converted skyline has an unexpected shape.');
  return skyline;
}

/** Ask the engine where the photos were taken. The request and answer formats follow
 *  backend/CONTRACTS.md once it exists; until then the answer is returned unchecked. */
export async function postLocate(skylines: Skyline[], fetchImpl?: Fetch): Promise<unknown> {
  return call('/locate', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ photos: skylines }),
  }, TIMEOUT_MS.locate, fetchImpl);
}
