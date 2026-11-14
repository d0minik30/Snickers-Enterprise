import { describe, expect, it, vi } from 'vitest';
import { ENGINE_URL, EngineError, postConvert, postLocate, postSkyline } from '@/lib/locate/engine';
import type { SkylineResponse, Trace } from '@/lib/locate/types';

const trace: Trace = { width: 4, height: 3, x: [0, 3], y: [1, 1], weight: [1, 1], reason: [null, null], sun_px: null };
const answer: SkylineResponse = {
  skyline: {
    format: 'skyline/draft-1',
    camera: { model: 'pinhole', width: 4, height: 3, hfov_deg: 60, vfov_deg: 47, pitch_deg: 0, roll_deg: 0, source: 'manual' },
    level_source: 'assumed', eye_height_m: 1.7, time_utc: null, sun: null, az_step_deg: 0.1,
    samples: [{ az_offset_deg: -1, elev_deg: 2, weight: 1 }],
  },
  trace,
  debug_image: 'data:image/jpeg;base64,AAAA',
};

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

describe('engine client', () => {
  it('posts the photo, camera and label to /skyline and checks the answer', async () => {
    const fetchImpl = vi.fn(async () => json(answer));
    const out = await postSkyline(new Blob(['x']), 'p.jpg', { preset: 'iphone-main' }, { camera: {} }, fetchImpl);
    expect(out.skyline.samples).toHaveLength(1);
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

  it('reports an unreachable engine and a server error plainly', async () => {
    const down = vi.fn(async () => { throw new TypeError('Failed to fetch'); });
    await expect(postLocate([], down)).rejects.toMatchObject({ kind: 'unreachable' });
    const broken = vi.fn(async () => new Response('oops', { status: 502 }));
    await expect(postLocate([], broken)).rejects.toMatchObject({ kind: 'server', status: 502 });
  });

  it('rejects answers of the wrong shape rather than showing them', async () => {
    const fetchImpl = vi.fn(async () => json({ skyline: { samples: 'nope' } }));
    const err = await postSkyline(new Blob(['x']), 'p.jpg', {}, null, fetchImpl).catch(e => e);
    expect(err).toBeInstanceOf(EngineError);
    expect(err.kind).toBe('bad-response');
    await expect(postConvert({}, null, trace, fetchImpl)).rejects.toMatchObject({ kind: 'bad-response' });
  });

  it('sends an edited trace to /skyline/convert', async () => {
    const fetchImpl = vi.fn(async () => json({ skyline: answer.skyline }));
    await postConvert({ hfov_deg: 60 }, null, trace, fetchImpl);
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(`${ENGINE_URL}/skyline/convert`);
    expect(JSON.parse(init.body as string)).toEqual({
      camera: { hfov_deg: 60 }, label: null, width: 4, height: 3,
      trace: { x: [0, 3], y: [1, 1], weight: [1, 1], sun_px: null },
    });
  });
});
