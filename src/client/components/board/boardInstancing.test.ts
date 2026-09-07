import { describe, expect, it } from 'vitest';
import type { TowerBlock, TowerMapEntry } from '../../../shared/types/api';
import {
  BUILD_SECONDS,
  buildBoardInstances,
  chooseDetailed,
  rimColorFor,
  towerBox,
  writeMatrix,
} from './boardInstancing';

const block = (y: number, width = 4000, extra: Partial<TowerBlock> = {}): TowerBlock => ({
  x: 0,
  y,
  z: 0,
  rotation: 0,
  width,
  depth: width,
  height: 1500,
  ...extra,
});

const tower = (
  id: string,
  worldX: number,
  worldZ: number,
  blockCount: number,
  extra: Partial<TowerMapEntry> = {}
): TowerMapEntry => ({
  sessionId: id,
  userId: `u-${id}`,
  username: id,
  score: 100,
  blockCount,
  perfectStreak: 0,
  gameMode: 'rotating_block',
  timestamp: 0,
  towerBlocks: Array.from({ length: blockCount }, (_, i) => block(i * 1500)),
  worldX,
  worldZ,
  ...extra,
});

describe('towerBox', () => {
  it('measures blocks in world units from fixed-point', () => {
    const box = towerBox([block(0), block(1500), block(3000)]);
    expect(box).toEqual({ minX: -2, maxX: 2, minY: 0, maxY: 4.5, minZ: -2, maxZ: 2 });
  });

  it('widens the footprint of a rotated block so the box still contains it', () => {
    const box = towerBox([block(0, 4000, { rotation: 45_000 })]);
    expect(box?.maxX).toBeCloseTo(2 * Math.SQRT2, 5);
    expect(box?.maxY).toBe(1.5);
  });

  it('is null for nothing drawable', () => {
    expect(towerBox(undefined)).toBeNull();
    expect(towerBox([block(0, 0)])).toBeNull();
  });
});

describe('writeMatrix', () => {
  it('lays out translate * rotateY * scale in column-major order', () => {
    const out = new Float32Array(16);
    writeMatrix(out, 0, 10, 20, 30, Math.PI / 2, 2, 3, 4);
    // First column: rotated +x axis scaled by 2 -> (0, 0, -2) for a +90 degree yaw.
    expect(out[0]).toBeCloseTo(0);
    expect(out[2]).toBeCloseTo(-2);
    expect(out[5]).toBe(3);
    // Third column: rotated +z axis scaled by 4 -> (4, 0, 0).
    expect(out[8]).toBeCloseTo(4);
    expect(out[10]).toBeCloseTo(0);
    expect([out[12], out[13], out[14], out[15]]).toEqual([10, 20, 30, 1]);
  });
});

describe('chooseDetailed', () => {
  it('spends the budget on the towers nearest the focus', () => {
    const towers = [tower('far', 100, 0, 10), tower('near', 2, 0, 10), tower('mid', 30, 0, 10)];
    const detailed = chooseDetailed(towers, { x: 0, z: 0 }, 20);
    expect([...detailed].sort()).toEqual([1, 2]);
  });

  it('skips a tower that would overflow but still fits smaller ones after it', () => {
    const towers = [tower('a', 1, 0, 8), tower('b', 2, 0, 50), tower('c', 3, 0, 8)];
    const detailed = chooseDetailed(towers, { x: 0, z: 0 }, 20);
    expect([...detailed].sort()).toEqual([0, 2]);
  });
});

describe('buildBoardInstances', () => {
  it('draws every block of a detailed tower and one box for a silhouette', () => {
    const towers = [tower('near', 0, 0, 5), tower('far', 500, 0, 40)];
    const plan = buildBoardInstances(towers, { x: 0, z: 0 }, 10, () => 0);
    expect(plan.count).toBe(6);
    expect(plan.detailedTowers).toBe(1);
    expect(plan.totalBlocks).toBe(45);
    expect(plan.footprints.map((f) => f.detailed)).toEqual([true, false]);
    // The silhouette spans the whole tower.
    const far = plan.footprints[1]!;
    expect(far.height).toBe(60);
    expect(plan.matrices[5 * 16 + 5]).toBe(60);
    expect(plan.matrices[5 * 16 + 13]).toBe(30);
    expect([...plan.towerOfInstance]).toEqual([0, 0, 0, 0, 0, 1]);
  });

  it('positions blocks at the tower cell and lifts a stacked tower by its base', () => {
    const towers = [tower('stacked', 10, -6, 2, { stackBaseY: 4500 })];
    const plan = buildBoardInstances(towers, { x: 0, z: 0 }, 100, () => 0);
    // First block: centre y = base 4.5 + 0 + half height 0.75.
    expect(plan.matrices[12]).toBe(10);
    expect(plan.matrices[13]).toBe(5.25);
    expect(plan.matrices[14]).toBe(-6);
    expect(plan.footprints[0]?.baseY).toBe(4.5);
  });

  it('staggers the build-in from the bottom of each tower up', () => {
    const towers = [tower('t', 0, 0, 4)];
    const plan = buildBoardInstances(towers, { x: 0, z: 0 }, 100, () => 7);
    expect(plan.delays[0]).toBe(7);
    expect(plan.delays[3]).toBeCloseTo(7 + (3 / 4) * BUILD_SECONDS);
  });

  it('asks the caller when each tower appears, with its distance from the focus', () => {
    const seen: Array<[string, number]> = [];
    buildBoardInstances([tower('t', 3, 4, 1)], { x: 0, z: 0 }, 100, (id, dist) => {
      seen.push([id, dist]);
      return 0;
    });
    expect(seen).toEqual([['t', 5]]);
  });

  it('colours rims by the declared side, and stably otherwise', () => {
    expect(rimColorFor({ sessionId: 'x', playerColorChoice: 'blue' })).toEqual(
      rimColorFor({ sessionId: 'y', playerColorChoice: 'blue' })
    );
    expect(rimColorFor({ sessionId: 'x', playerColorChoice: 'orange' })).not.toEqual(
      rimColorFor({ sessionId: 'x', playerColorChoice: 'blue' })
    );
    expect(rimColorFor({ sessionId: 'same', playerColorChoice: null })).toEqual(
      rimColorFor({ sessionId: 'same', playerColorChoice: null })
    );
  });

  it('drops towers with no drawable blocks rather than drawing garbage', () => {
    const empty = tower('empty', 0, 0, 0);
    const plan = buildBoardInstances([empty, tower('ok', 8, 0, 1)], { x: 0, z: 0 }, 100, () => 0);
    expect(plan.count).toBe(1);
    expect(plan.footprints.map((f) => f.id)).toEqual(['ok']);
  });
});
