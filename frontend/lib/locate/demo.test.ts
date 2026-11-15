import { describe, expect, it } from 'vitest';
import { DEMO_PHOTOS, DEMO_TRUTH, demoAnswerFor } from '@/lib/locate/demo';
import { distanceM } from '@/lib/nav/geo';

describe('demo answers', () => {
  it('uses the three Navcam photos of pose 3/770, and the truth is inside the answer\'s 95 % circle', () => {
    expect(DEMO_PHOTOS.map(d => d.id).every(id => id.includes('N0030770NCAM'))).toBe(true);
    const a = demoAnswerFor(DEMO_PHOTOS.map(d => ({ sha256: d.sha256, name: `${d.id}.png` })))!;
    expect(a.photoCount).toBe(3);
    expect(a.request.photos).toHaveLength(3);
    expect(distanceM(a.result.best, DEMO_TRUTH)).toBeLessThan(a.result.best.uncertainty_95_m);
  });
  it('answers when every photo is an example photo, by content or by name', () => {
    expect(demoAnswerFor([{ sha256: DEMO_PHOTOS[0].sha256, name: 'a.png' }])?.result.status).toBe('ok');
    expect(demoAnswerFor([{ sha256: 'x', name: `${DEMO_PHOTOS[2].id}01 (1).png` }])).not.toBeNull();
  });
  it('does not answer for an unknown photo, or for none', () => {
    expect(demoAnswerFor([{ sha256: DEMO_PHOTOS[0].sha256, name: 'a' }, { sha256: 'x', name: 'mine.jpg' }])).toBeNull();
    expect(demoAnswerFor([])).toBeNull();
  });
});
