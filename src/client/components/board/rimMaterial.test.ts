import { describe, expect, it } from 'vitest';
import { COMPRESS_K, compressHeight } from './rimMaterial';

describe('compressHeight', () => {
  it('leaves heights alone at zero', () => {
    expect(compressHeight(0, 0)).toBe(0);
    expect(compressHeight(150, 0)).toBe(150);
    expect(compressHeight(1500, 0)).toBe(1500);
  });

  it('keeps a small tower and holds a spire to a bounded height', () => {
    // A twenty-block tower stays recognisable; a thousand-block one no longer dominates.
    expect(compressHeight(30, 1)).toBeGreaterThan(20);
    expect(compressHeight(1500, 1)).toBeLessThan(200);
    expect(compressHeight(1500, 1)).toBeGreaterThan(compressHeight(300, 1));
  });

  it('is monotonic, so a stack stays in order', () => {
    let last = -1;
    for (let y = 0; y <= 2000; y += 25) {
      const c = compressHeight(y, 1);
      expect(c).toBeGreaterThan(last);
      last = c;
    }
  });

  it('is exactly the curve the shader uses', () => {
    expect(compressHeight(COMPRESS_K, 1)).toBeCloseTo(COMPRESS_K * Math.log(2), 6);
  });
});
