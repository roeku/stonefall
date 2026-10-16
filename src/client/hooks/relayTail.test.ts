import { describe, expect, it } from 'vitest';
import type { RelayPush, RelayState } from '../../shared/types/api';
import type { Block } from '../../shared/simulation/types';
import { withTail } from './relayTail';

const block = (i: number, width = 8000): Block => ({
  x: 0,
  z: 0,
  y: i * 1500,
  rotation: 0,
  width,
  depth: width,
  height: 1500,
});

const state = (n: number): RelayState => ({
  postId: 't3_x',
  day: '2026-10-16',
  tower: 2,
  blocks: Array.from({ length: n }, (_, i) => block(i)),
  colors: Array.from({ length: n }, () => 'rose' as const),
  turn: null,
  lobby: [
    {
      userId: 'a',
      username: 'a',
      faction: 'rose',
      snoovatar: null,
      joinedAt: 1,
      blocks: 0,
      perfects: 0,
    },
    {
      userId: 'b',
      username: 'b',
      faction: 'jade',
      snoovatar: null,
      joinedAt: 2,
      blocks: 0,
      perfects: 0,
    },
  ],
  builders: 1,
  fallen: 0,
  now: 0,
  closed: false,
  events: [],
  me: null,
  version: 10,
  towers: [],
  crewMax: 4,
});

const push = (from: number, blocks: Block[], extra: Partial<RelayPush> = {}): RelayPush => ({
  kind: 'relay',
  tower: 2,
  version: 13,
  tail: { from, blocks, colors: blocks.map(() => 'jade' as const) },
  ...extra,
});

describe('a push that brings its blocks', () => {
  it('puts them on top of the tower this page has, replacing the healed top', () => {
    const before = state(5);
    const healed = { ...block(4), width: 8000 };
    const next = withTail(before, push(4, [healed, block(5), block(6)]))!;
    expect(next.blocks).toHaveLength(7);
    expect(next.colors.slice(3)).toEqual(['rose', 'jade', 'jade', 'jade']);
    expect(next.version).toBe(13);
  });

  it('turns the crew round to whoever holds the turn, and keeps every event', () => {
    const turn = { userId: 'b', username: 'b', index: 6, startedAt: 1, endsAt: 2 };
    const events = [
      { at: 5, kind: 'landed' as const, username: 'a', block: 6 },
      { at: 5, kind: 'perfect' as const, username: 'a', block: 7, streak: 1 },
    ];
    const next = withTail(state(5), push(4, [block(4), block(5)], { turn, events }))!;
    expect(next.lobby.map((p) => p.userId)).toEqual(['b', 'a']);
    expect(next.turn).toEqual(turn);
    expect(next.events).toEqual(events);
  });

  it('is left to a fetch when this page has fallen behind where it starts', () => {
    expect(withTail(state(5), push(7, [block(7)]))).toBeNull();
    expect(withTail(state(5), { kind: 'relay', tower: 2, version: 13 })).toBeNull();
  });
});
