import { describe, expect, it, vi } from 'vitest';
import { ENGINE_URL, EngineError, postConvert, postLocate, postSkyline } from '@/lib/locate/engine';
import type { LocateRequest } from '@/lib/locate/types';
import { contractPhoto, contractResult, diagnostics, skylineResponse, trace } from '@/lib/testing/locateFixtures';

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
const request: LocateRequest = { contract_version: '0.1', photos: [{ ...contractPhoto(), id: 'photo_1' }] };

describe('engine client', () => {
  it('posts the photo, camera and label to /skyline and checks the answer', async () => {
    const fetchImpl = vi.fn(async () => json(skylineResponse()));
    const out = await postSkyline(new Blob(['x']), 'p.jpg', { preset: 'iphone-main' }, { camera: {} }, fetchImpl);
    expect(out.photo.samples).toHaveLength(30);
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(`${ENGINE_URL}/skyline`);
    const form = init.body as FormData;
    expect(form.get('camera')).toBe('{"preset":"iphone-main"}');
    expect(form.get('label')).toBeInstanceOf(Blob);
  });

  it('turns the error detail from the API into a refused error with its message', async () => {
    const fetchImpl = vi.fn(async () => json({ detail: { code: 'bad_input', message: 'no field of view' } }, 400));
    await expect(postSkyline(new Blob(['x']), 'p.jpg', {}, null, fetchImpl)).rejects.toMatchObject({
      kind: 'refused', message: 'no field of view', status: 400,
    });
  });

  it('names the fields of a 422 (the engine says which field breaks the contract)', async () => {
    const detail = [{ loc: ['body', 'photos', 0, 'samples'], msg: 'at least 20 samples', type: 'value_error' }];
    const fetchImpl = vi.fn(async () => json({ detail }, 422));
    await expect(postLocate(request, fetchImpl)).rejects.toMatchObject({
      kind: 'refused', status: 422, message: 'photos.0.samples: at least 20 samples',
    });
  });

  it('reports an unreachable engine, a missing endpoint and a server error plainly', async () => {
    const down = vi.fn(async () => { throw new TypeError('Failed to fetch'); });
    await expect(postLocate(request, down)).rejects.toMatchObject({ kind: 'unreachable' });
    const missing = vi.fn(async () => json({ detail: 'Not Found' }, 404));
    await expect(postLocate(request, missing)).rejects.toThrow(/has no \/locate yet/);
    const broken = vi.fn(async () => new Response('oops', { status: 502 }));
    await expect(postLocate(request, broken)).rejects.toMatchObject({ kind: 'server', status: 502 });
  });

  it('sends the contract body to /locate and accepts a result in the agreed format', async () => {
    const fetchImpl = vi.fn(async () => json(contractResult));
    const out = await postLocate(request, fetchImpl);
    expect(out.best.uncertainty_m).toBe(140);
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(`${ENGINE_URL}/locate`);
    expect(JSON.parse(init.body as string)).toEqual(request);
  });

  it('rejects answers of the wrong shape rather than showing them', async () => {
    const bad = vi.fn(async () => json({ photo: { samples: 'nope' } }));
    const err = await postSkyline(new Blob(['x']), 'p.jpg', {}, null, bad).catch(e => e);
    expect(err).toBeInstanceOf(EngineError);
    expect(err.kind).toBe('bad-response');
    await expect(postConvert({}, null, trace, bad)).rejects.toMatchObject({ kind: 'bad-response' });
    const noBest = vi.fn(async () => json({ ...contractResult, best: { lat: 18 } }));
    await expect(postLocate(request, noBest)).rejects.toMatchObject({ kind: 'bad-response' });
    const badGrid = vi.fn(async () => json({ ...contractResult, likelihood_grid: { ...contractResult.likelihood_grid, rows: 3 } }));
    await expect(postLocate(request, badGrid)).rejects.toMatchObject({ kind: 'bad-response' });
  });

  it('sends an edited trace to /skyline/convert', async () => {
    const fetchImpl = vi.fn(async () => json({ contract_version: '0.1', photo: contractPhoto(), diagnostics: diagnostics() }));
    const out = await postConvert({ hfov_deg: 60 }, null, trace, fetchImpl);
    expect(out.diagnostics.camera_model).toBe('pinhole');
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(`${ENGINE_URL}/skyline/convert`);
    expect(JSON.parse(init.body as string)).toEqual({
      camera: { hfov_deg: 60 }, label: null, width: 4, height: 3,
      trace: { x: trace.x, y: trace.y, weight: trace.weight, sun_px: null },
    });
  });
});
