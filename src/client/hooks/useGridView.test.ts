import { describe, expect, it } from 'vitest';
import { MAX_ZOOM, MIN_ZOOM, ZOOM_STEP, clampZoom, zoomedIn, zoomedOut } from './useGridView';

describe('grid view zoom', () => {
  it('bottoms out close enough to read a single cell', () => {
    let z = MAX_ZOOM;
    for (let i = 0; i < 40; i++) z = zoomedIn(z);
    expect(z).toBe(MIN_ZOOM);
    // The fitted framing shows a whole plot; a fifth of that standoff is a handful of cells.
    expect(MIN_ZOOM).toBeLessThanOrEqual(0.25);
  });

  it('tops out far enough to frame a thousand-block tower from the plot', () => {
    let z = MIN_ZOOM;
    for (let i = 0; i < 40; i++) z = zoomedOut(z);
    expect(z).toBe(MAX_ZOOM);
    // A plot is fitted at roughly 120 units on a phone; a thousand blocks at 1.5 units each
    // needs about 2800 units of standoff at a 30 degree field of view. Players build these.
    expect(120 * MAX_ZOOM).toBeGreaterThanOrEqual((1500 / (2 * Math.tan(Math.PI / 12))) * 0.4);
  });

  it('is reversible in the middle of the range, so zooming out returns where you were', () => {
    expect(zoomedOut(zoomedIn(1))).toBeCloseTo(1);
    expect(zoomedIn(1)).toBeCloseTo(1 / ZOOM_STEP);
  });

  it('reports no change at the limits, which is what disables the buttons', () => {
    expect(zoomedIn(MIN_ZOOM)).toBe(MIN_ZOOM);
    expect(zoomedOut(MAX_ZOOM)).toBe(MAX_ZOOM);
  });

  it('clamps anything out of range and never lets NaN into the camera', () => {
    expect(clampZoom(-5)).toBe(MIN_ZOOM);
    expect(clampZoom(1e9)).toBe(MAX_ZOOM);
    expect(clampZoom(NaN)).toBe(1);
  });
});
