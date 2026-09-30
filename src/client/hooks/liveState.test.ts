import { describe, expect, it } from 'vitest';
import { createRunSimulation } from '../../shared/simulation';
import type { GameState } from '../../shared/simulation/types';
import { needsRender } from './liveState';

const run = () => {
  const sim = createRunSimulation(1234, 'rotating_block');
  return { sim, state: sim.createInitialState() };
};

describe('needsRender', () => {
  it('skips the ticks that only move the block in play', () => {
    const { sim, state } = run();
    let prev: GameState = state;
    let renders = 0;
    for (let i = 0; i < 120; i++) {
      const next = sim.stepSimulation(prev);
      if (needsRender(prev, next)) renders++;
      prev = next;
    }
    // The block sweeps for two seconds and nothing else happens.
    expect(prev.currentBlock).not.toBeNull();
    expect(renders).toBe(0);
  });

  it('renders a drop, and an effect running out', () => {
    const { sim, state } = run();
    let prev = state;
    for (let i = 0; i < 20; i++) prev = sim.stepSimulation(prev);
    const dropped = sim.stepSimulation(prev, { tick: prev.tick + 1 });
    expect(dropped.blocks.length).toBe(prev.blocks.length + 1);
    expect(needsRender(prev, dropped)).toBe(true);

    // The offcut from that drop is kept for 60 ticks; its expiry is a render, the rest are not.
    prev = dropped;
    const effects = dropped.recentTrimEffects.length + (dropped.recentGrowthEffects?.length ?? 0);
    let renders = 0;
    for (let i = 0; i < 70; i++) {
      const next = sim.stepSimulation(prev);
      if (needsRender(prev, next)) renders++;
      prev = next;
    }
    expect(effects).toBeGreaterThan(0);
    expect(renders).toBe(1);
  });

  it('renders the start and the end of a scene', () => {
    const { state } = run();
    expect(needsRender(null, state)).toBe(true);
    expect(needsRender(state, null)).toBe(true);
    expect(needsRender(null, null)).toBe(false);
    expect(needsRender(state, { ...state, isGameOver: true })).toBe(true);
  });
});
