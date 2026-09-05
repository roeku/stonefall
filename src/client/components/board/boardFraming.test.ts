import { describe, expect, it } from 'vitest';
import type { TowerMapEntry } from '../../../shared/types/api';
import {
  PLOT_HALF,
  PLOT_WORLD,
  baseDistance,
  communityFrame,
  lookHeight,
  plotCenter,
} from './boardFraming';

const at = (worldX: number, worldZ: number): TowerMapEntry =>
  ({
    sessionId: `${worldX},${worldZ}`,
    worldX,
    worldZ,
    towerBlocks: [],
  }) as unknown as TowerMapEntry;

describe('communityFrame', () => {
  it('frames an empty grid as one plot at the origin', () => {
    expect(communityFrame([])).toEqual({ x: 0, z: 0, extent: PLOT_WORLD });
  });

  it('centres on the built area with a plot of margin', () => {
    const frame = communityFrame([at(-100, 0), at(100, 40)]);
    expect(frame.x).toBe(0);
    expect(frame.z).toBe(20);
    expect(frame.extent).toBe(100 + PLOT_HALF);
  });

  it('ignores towers with no position instead of collapsing to NaN', () => {
    const frame = communityFrame([at(10, 10), { sessionId: 'x' } as TowerMapEntry]);
    expect(frame.x).toBe(10);
    expect(Number.isFinite(frame.extent)).toBe(true);
  });
});

describe('baseDistance', () => {
  it('backs off further on a portrait phone than on a landscape monitor to fit the plot', () => {
    const portrait = baseDistance('mine', { aspect: 0.6, fovDeg: 30, extent: PLOT_HALF });
    const landscape = baseDistance('mine', { aspect: 1.8, fovDeg: 30, extent: PLOT_HALF });
    expect(portrait).toBeGreaterThan(landscape);
    expect(portrait).toBeLessThanOrEqual(400);
    expect(landscape).toBeGreaterThanOrEqual(90);
  });

  it('grows with the size of the city but never past the fog', () => {
    const small = baseDistance('community', { aspect: 1, fovDeg: 30, extent: 50 });
    const large = baseDistance('community', { aspect: 1, fovDeg: 30, extent: 500 });
    expect(large).toBeGreaterThan(small);
    expect(baseDistance('community', { aspect: 1, fovDeg: 30, extent: 1e6 })).toBe(1600);
  });

  it('backs the city off further on a portrait phone so its width fits the frame', () => {
    const portrait = baseDistance('community', { aspect: 0.46, fovDeg: 30, extent: 125 });
    const landscape = baseDistance('community', { aspect: 1.8, fovDeg: 30, extent: 125 });
    expect(portrait).toBeGreaterThan(landscape);
    // At that standoff the half-angle covers the city's half-width with margin.
    const halfH = Math.atan(Math.tan(Math.PI / 12) * 0.46);
    expect(portrait * Math.tan(halfH)).toBeGreaterThanOrEqual(125);
  });

  it('fits a tower to its height, so a thousand-block spire is seen whole', () => {
    const short = baseDistance('tower', { aspect: 1, fovDeg: 30, extent: 0, towerHeight: 30 });
    const tall = baseDistance('tower', { aspect: 1, fovDeg: 30, extent: 0, towerHeight: 1500 });
    expect(tall).toBeGreaterThan(short);
    // Framing 1500 units at a 30 degree field of view needs roughly 1500 / (2 tan 15deg).
    expect(tall).toBeGreaterThanOrEqual(1500 / (2 * Math.tan(Math.PI / 12)));
  });

  it('survives a degenerate aspect ratio from an unmeasured canvas', () => {
    expect(
      Number.isFinite(baseDistance('mine', { aspect: 0, fovDeg: 30, extent: PLOT_HALF }))
    ).toBe(true);
    expect(
      Number.isFinite(baseDistance('placing', { aspect: NaN, fovDeg: 30, extent: PLOT_HALF }))
    ).toBe(true);
  });
});

describe('lookHeight', () => {
  it('aims at the middle of a selected tower, offset by what it stands on', () => {
    expect(lookHeight('tower', 100, { baseY: 10, height: 100 })).toBe(55);
  });

  it('aims the city view at the ground, where the plots are', () => {
    expect(lookHeight('community', 600)).toBe(0);
  });
});

describe('plotCenter', () => {
  it('lands on the centre of the centre cell', () => {
    expect(plotCenter({ rx: 0, rz: 0, centerX: 0, centerZ: 0, radius: 3 })).toEqual({ x: 2, z: 2 });
  });
});
