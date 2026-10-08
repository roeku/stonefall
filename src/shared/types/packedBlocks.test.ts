import { describe, expect, it } from 'vitest';
import { createRunSimulation } from '../simulation/runSimulation';
import type { GameState } from '../simulation/types';
import type { TowerBlock, TowerMapEntry } from './api';
import { packBlocks, packTower, unpackBlocks, unpackTower } from './packedBlocks';

/** The blocks of a run as the server stores them (server/core/runs.ts `geometryOf`). */
const stored = (state: GameState): TowerBlock[] =>
  state.blocks.map((b) => ({
    x: b.x,
    y: b.y,
    z: b.z ?? 0,
    width: b.width,
    depth: b.depth ?? b.width,
    height: b.height,
    rotation: b.rotation ?? 0,
  }));

const offCentre = (state: GameState): number => {
  const moving = state.currentBlock;
  const top = state.blocks[state.blocks.length - 1];
  if (!moving || !top) return Infinity;
  return state.blocks.length % 2 === 0
    ? Math.abs(moving.x - top.x)
    : Math.abs((moving.z ?? 0) - (top.z ?? 0));
};

/** A run of real drops: mostly flush, every few a trim of a different size. */
const playRun = (seed: number, drops: number): TowerBlock[] => {
  const sim = createRunSimulation(seed);
  let state = sim.createInitialState();
  for (let n = 0; n < drops && !state.isGameOver; n++) {
    const trim = n % 3 === 2;
    const want = trim ? 300 + ((seed * 7 + n * 131) % 900) : 150;
    for (let guard = 0; guard < 4000; guard++) {
      const next = sim.stepSimulation(state);
      const off = offCentre(next);
      state = next;
      // A trim waits for the sweep to pass `want` off centre; dropping as the block spawns, far
      // out past the tower, would miss it entirely.
      if (trim ? Math.abs(off - want) <= 120 : off <= want) {
        state = sim.stepSimulation(state, { tick: state.tick + 1 });
        break;
      }
    }
  }
  return stored(state);
};

const entry = (towerBlocks: TowerBlock[]): TowerMapEntry => ({
  sessionId: 's',
  userId: 'u',
  username: 'name',
  score: 100,
  blockCount: towerBlocks.length,
  perfectStreak: 2,
  maxCombo: 2,
  gameMode: 'rotating_block',
  timestamp: 1,
  towerBlocks,
  height: 4500,
  faction: 'gold',
  gridX: 3,
  gridZ: -2,
  worldX: 28,
  worldZ: -12,
  stackBaseY: 0,
});

describe('packed tower blocks', () => {
  it('pack real runs, trims and all, and come back exactly', () => {
    for (const seed of [1, 42, 4242, 90210]) {
      const blocks = playRun(seed, 24);
      expect(blocks.length).toBeGreaterThan(8);
      expect(new Set(blocks.map((b) => b.width)).size).toBeGreaterThan(1);
      const packed = packBlocks(blocks);
      expect(packed).not.toBeNull();
      expect(unpackBlocks(packed!)).toEqual(blocks);
    }
  });

  it('are several times smaller as JSON', () => {
    const blocks = playRun(42, 40);
    const before = JSON.stringify(blocks).length;
    const after = JSON.stringify(packBlocks(blocks)).length;
    expect(after * 4).toBeLessThan(before);
  });

  it('round-trip a whole board entry, and leave every other field alone', () => {
    const tower = entry(playRun(7, 16));
    const packed = packTower(tower);
    expect(packed.towerBlocks).toBeUndefined();
    expect(packed.packed).toBeDefined();
    expect(unpackTower(packed)).toEqual(tower);
  });

  it('pack a tower drawn without geometry', () => {
    const tower = entry([]);
    expect(unpackTower(packTower(tower))).toEqual(tower);
  });

  it('stay as they are when packing would change them', () => {
    const base: TowerBlock = {
      x: 0,
      y: 0,
      z: 0,
      width: 8000,
      depth: 8000,
      height: 1500,
      rotation: 0,
    };
    const cases: TowerBlock[][] = [
      [base, { ...base, y: 1500, rotation: 0.3 }],
      [base, { ...base, y: 1500, height: 1200 }],
      [base, { ...base, y: 1700 }],
      [base, { x: 0, y: 1500, width: 8000, height: 1500, rotation: 0 }],
    ];
    for (const blocks of cases) {
      expect(packBlocks(blocks)).toBeNull();
      const tower = entry(blocks);
      const stays = packTower(tower);
      expect(stays.towerBlocks).toBe(blocks);
      expect(unpackTower(stays)).toEqual(tower);
    }
  });

  it('read a page stored before packing', () => {
    const tower = entry(playRun(3, 10));
    expect(unpackTower(JSON.parse(JSON.stringify(tower)))).toEqual(tower);
  });
});
