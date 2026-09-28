import { describe, expect, it } from 'vitest';
import { estimateAge, fayHours, lehrArea, lehrHours } from './age';

describe('slick age', () => {
  it('Lehr inverts its own area law', () => {
    const t = lehrHours(lehrArea(7, 500, 6), 500, 6);
    expect(t).toBeCloseTo(7, 3);
  });
  it('bigger slicks are older, by both laws', () => {
    expect(fayHours(20e6)[0]).toBeGreaterThan(fayHours(2e6)[0]);
    expect(lehrHours(20e6, 200, 6)).toBeGreaterThan(lehrHours(2e6, 200, 6));
  });
  it('gives a sane band for a 6 km² slick in 7 m/s wind', () => {
    const a = estimateAge({ areaM2: 6.03e6, windMs: 7.3 });
    expect(a.lowH).toBeGreaterThan(1);
    expect(a.highH).toBeLessThan(72);
    expect(a.lowH).toBeLessThanOrEqual(a.highH);
  });
});
