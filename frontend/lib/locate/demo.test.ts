import { describe, expect, it } from 'vitest';
import { DEMO_PHOTOS, demoAnswerFor } from '@/lib/locate/demo';

describe('demo answers', () => {
  it('answers when every photo is an example photo, by content or by name', () => {
    expect(demoAnswerFor([{ sha256: DEMO_PHOTOS[0].sha256, name: 'a.png' }])?.result.status).toBe('ok');
    expect(demoAnswerFor([{ sha256: 'x', name: `${DEMO_PHOTOS[2].id}01 (1).png` }])).not.toBeNull();
  });
  it('does not answer for an unknown photo, or for none', () => {
    expect(demoAnswerFor([{ sha256: DEMO_PHOTOS[0].sha256, name: 'a' }, { sha256: 'x', name: 'mine.jpg' }])).toBeNull();
    expect(demoAnswerFor([])).toBeNull();
  });
});
