import { describe, expect, it } from 'vitest';
import { createRunSimulation } from '../src/shared/simulation/runSimulation';
import type { DropInput, GameState } from '../src/shared/simulation/types';

/**
 * HTTP smoke test against the local harness (`npm run play` on :7474). Not part of `npm test`:
 * run it by hand with `npx vitest run tools/smoke.test.ts` while the harness is up.
 *
 * Plays runs through the shared simulation exactly as the client does, then walks the raise
 * rules end to end: keep, claim, a refused take, a successful take, and a relay turn.
 */
const base = 'http://localhost:7474';
const call = async (path: string, body?: unknown) => {
  const res = await fetch(
    base + path,
    body === undefined
      ? {}
      : {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        }
  );
  return { status: res.status, data: (await res.json()) as any };
};

/** Taps aimed at the first crossing, missing by up to `slop` ticks; returns seed and inputs. */
const played = (seed: number, slop: number, maxBlocks = 400) => {
  const sim = createRunSimulation(seed) as never as {
    createInitialState(): GameState;
    stepSimulation(s: GameState, i?: DropInput): GameState;
    currentBlockSpawnTick: number;
    calculateSlidePosition(t: number, count?: number, phase?: number): number;
  };
  let state = sim.createInitialState();
  let x = (seed * 2654435761) % 2147483647;
  const rnd = () => (x = (x * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
  const taps: DropInput[] = [];
  let guard = 0;
  while (!state.isGameOver && guard++ < maxBlocks) {
    const top = state.blocks[state.blocks.length - 1]!;
    const cb = state.currentBlock;
    if (!cb) break;
    const axis = state.blocks.length % 2 === 0 ? 'x' : 'z';
    const topC = axis === 'x' ? top.x : (top.z ?? 0);
    const spawn = sim.currentBlockSpawnTick ?? 0;
    const phase = cb.slidePhaseOffset ?? 0;
    const err = (t: number) =>
      Math.abs(
        sim.calculateSlidePosition(
          Math.max(0, state.tick + t - spawn),
          state.blocks.length,
          phase
        ) - topC
      );
    let cross = 1;
    let prev = err(1);
    for (let t = 2; t < 1200; t++) {
      const e = err(t);
      if (e > prev) {
        cross = t - 1;
        break;
      }
      prev = e;
    }
    const at = Math.max(1, cross + Math.round((rnd() * 2 - 1) * slop));
    for (let k = 1; k < at; k++) {
      state = sim.stepSimulation(state);
      if (state.isGameOver) break;
    }
    if (state.isGameOver) break;
    const input: DropInput = { tick: state.tick + 1 };
    taps.push(input);
    state = sim.stepSimulation(state, input);
  }
  return { seed, inputs: taps, score: state.score, blocks: state.blocks.length };
};

const save = async (seed: number, slop: number, maxBlocks?: number) => {
  const run = played(seed, slop, maxBlocks);
  const sessionId = `smoke-${seed}-${Date.now()}`;
  const { status, data } = await call('/api/game/save-run', {
    sessionId,
    seed,
    gameMode: 'rotating_block',
    inputs: run.inputs,
  });
  expect(status).toBe(200);
  expect(data.success).toBe(true);
  expect(data.score).toBe(run.score);
  return { sessionId: data.sessionId as string, score: data.score as number };
};

describe('harness: the map', () => {
  it('says which day the map is and that it is still open', async () => {
    const { data } = await call('/api/board');
    expect(data.map.live).toBe(true);
    expect(data.map.day).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('serves the board with keeps and factions', async () => {
    const { data } = await call('/api/board');
    expect(data.towers.length).toBeGreaterThan(100);
    expect(data.keeps.length).toBeGreaterThan(10);
    expect(data.towers.every((t: any) => typeof t.faction === 'string')).toBe(true);
  });

  it('raises on the keep, claims land, and takes held land only by beating the bar', async () => {
    const me = (await call('/api/me')).data;
    const c = me.region;
    expect(c).toBeTruthy();

    // Keep: stacks.
    const a = await save(11, 3);
    const keep = await call('/api/grid/raise', {
      sessionId: a.sessionId,
      gridX: c.centerX,
      gridZ: c.centerZ,
    });
    expect(keep.data.success).toBe(true);
    expect(keep.data.kind).toBe('keep');

    // Claim: empty land on my own plot's edge.
    const b = await save(12, 3);
    const claim = await call('/api/grid/raise', {
      sessionId: b.sessionId,
      gridX: c.centerX - 3,
      gridZ: c.centerZ + 2,
    });
    expect(claim.data.success, JSON.stringify(claim.data)).toBe(true);
    expect(claim.data.kind).toBe('claim');

    // Out of reach: land on an empty plot well past the edge of the built map, where nothing of
    // any colour stands within reach. (A neighbour's far edge is not a safe choice: when the
    // neighbour flies the same colour, their land extends this player's reach.)
    const d = await save(13, 3);
    const far = await call('/api/grid/raise', {
      sessionId: d.sessionId,
      gridX: c.centerX + 8 * 9 + 3,
      gridZ: c.centerZ,
    });
    expect(far.data.success).toBe(false);
    expect(far.data.message).toMatch(/reach/i);

    // Take: the seeded rival hold at (+3, +1) has 1,290 standing. A weak run is refused with the bar.
    const weak = await save(14, 24, 12);
    const refused = await call('/api/grid/raise', {
      sessionId: weak.sessionId,
      gridX: c.centerX + 3,
      gridZ: c.centerZ + 1,
    });
    expect(refused.data.success).toBe(false);
    expect(refused.data.bar).toBe(1290);

    // A strong run takes it and names who lost it.
    const strong = await save(15, 0, 120);
    expect(strong.score).toBeGreaterThan(1290);
    const take = await call('/api/grid/raise', {
      sessionId: strong.sessionId,
      gridX: c.centerX + 3,
      gridZ: c.centerZ + 1,
    });
    expect(take.data.success, JSON.stringify(take.data)).toBe(true);
    expect(take.data.kind).toBe('take');
    expect(take.data.took.username).toBe('player2');

    const board = (await call('/api/board')).data;
    const cell = board.towers.filter(
      (t: any) => t.gridX === c.centerX + 3 && t.gridZ === c.centerZ + 1
    );
    expect(cell).toHaveLength(1);
    expect(cell[0].userId).toBe('local-player');

    // Announce it.
    const brag = await call('/api/social/brag', {
      sessionId: strong.sessionId,
      kind: 'took',
      passedUsername: 'player2',
      passedScore: 1290,
      cell: { x: c.centerX + 3, z: c.centerZ + 1 },
    });
    expect(brag.data.success).toBe(true);
    expect(brag.data.record.kind).toBe('took');
  });
  it('takes every tower a player has standing down when they change sides', async () => {
    const me = (await call('/api/me')).data;
    const standing = me.grid.placements.length;
    expect(standing).toBeGreaterThan(0);
    const other = me.faction === 'rose' ? 'jade' : 'rose';
    const res = await call('/api/me/faction', { faction: other });
    expect(res.data.success).toBe(true);
    expect(res.data.razed).toHaveLength(standing);
    expect((await call('/api/me')).data.grid.placements).toHaveLength(0);
    // Choosing the colour you already fly costs nothing.
    const again = await call('/api/me/faction', { faction: other });
    expect(again.data.razed).toHaveLength(0);
  });
});

describe('harness: the relay', () => {
  it('watches until asked, seats on a crew with room, gets a turn, and lands a block', async () => {
    let state = (await call('/api/relay/heartbeat', {})).data.state;
    expect(state.crewMax).toBeGreaterThan(0);
    const joined = await call('/api/relay/join', { tower: state.tower });
    expect(joined.data.success, JSON.stringify(joined.data)).toBe(true);
    state = joined.data.state;
    expect(state.lobby.some((p: any) => p.userId === 'local-player')).toBe(true);
    expect(state.lobby.length).toBeLessThanOrEqual(state.crewMax);
    // Wait for my turn (bots take theirs within a few seconds each).
    for (let i = 0; i < 60 && state.turn?.userId !== 'local-player'; i++) {
      await new Promise((r) => setTimeout(r, 1000));
      state = (await call('/api/relay/heartbeat', {})).data.state;
    }
    expect(state.turn?.userId).toBe('local-player');
    // Aim at the crossing with the same sim the client runs.
    const sim = createRunSimulation(0, 'relay');
    let local = sim.createStateFromBlocks(state.blocks);
    const axis = state.blocks.length % 2 === 0 ? 'x' : 'z';
    const top = state.blocks[state.blocks.length - 1];
    const centre = axis === 'x' ? top.x : (top.z ?? 0);
    let best = 1;
    let bestErr = Infinity;
    for (let t = 1; t < 400; t++) {
      local = sim.stepSimulation(local);
      const cb = local.currentBlock!;
      const err = Math.abs((axis === 'x' ? cb.x : (cb.z ?? 0)) - centre);
      if (err < bestErr) {
        bestErr = err;
        best = local.tick + 1;
      }
    }
    const drop = await call('/api/relay/drop', { tick: best, index: state.turn.index });
    expect(drop.data.success, JSON.stringify(drop.data)).toBe(true);
    expect(['landed', 'perfect']).toContain(drop.data.result);
    expect(drop.data.state.blocks.length).toBe(state.blocks.length + 1);
    expect(drop.data.state.colors.length).toBe(drop.data.state.blocks.length);
    expect(drop.data.state.turn?.userId).not.toBe('local-player');
  }, 90_000);

  it('starts a new tower when every crew is full, and never overfills one', async () => {
    const before = (await call('/api/relay/state')).data.state;
    await call('/api/mock/relay?bots=14');
    const after = (await call('/api/relay/state')).data.state;
    expect(after.towers.length).toBeGreaterThan(before.towers.length);
    for (const t of after.towers) expect(t.crew).toBeLessThanOrEqual(after.crewMax);
  });
});
