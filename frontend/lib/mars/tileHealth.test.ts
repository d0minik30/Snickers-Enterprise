import { describe, expect, it } from 'vitest';
import { createTileHealth } from '@/lib/mars/tileHealth';

describe('tile health', () => {
  it('turns unavailable after three failures that outnumber the loads, and recovers', () => {
    const h = createTileHealth();
    h.failed(); h.failed(); expect(h.unavailable).toBe(false);
    h.failed(); expect(h.unavailable).toBe(true);
    h.loaded(); h.loaded(); h.loaded(); expect(h.unavailable).toBe(false);
    h.failed(); h.reset(); expect(h.unavailable).toBe(false);
  });
});
