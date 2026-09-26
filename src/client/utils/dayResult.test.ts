import { describe, expect, it } from 'vitest';
import type { TowerMapEntry } from '../../shared/types/api';
import { dayLine, dayResult } from './dayResult';

const tower = (userId: string, score: number, cell = true): TowerMapEntry => ({
  sessionId: `${userId}-${score}`,
  userId,
  username: userId,
  score,
  blockCount: 10,
  perfectStreak: 0,
  gameMode: 'rotating_block',
  timestamp: 0,
  towerBlocks: [],
  ...(cell ? { gridX: 1, gridZ: 2 } : {}),
});

describe('how a day ended', () => {
  const board = [tower('a', 900), tower('a', 2400), tower('b', 1500), tower('me', 1200)];

  it('counts builders and towers, and finds the best standing', () => {
    const r = dayResult(board, null);
    expect(r).toMatchObject({ builders: 3, towers: 4, mine: null });
    expect(r.best?.score).toBe(2400);
    expect(dayLine(r)).toBe('3 builders, 4 towers');
  });

  it("places the viewer's best among everyone's bests", () => {
    const r = dayResult(board, 'me');
    expect(r.mine).toEqual({ best: 1200, place: 3 });
    expect(dayLine(r)).toBe('3 builders, 4 towers · you placed 3rd');
    expect(dayResult(board, 'a').mine).toEqual({ best: 2400, place: 1 });
  });

  it('says so when nobody built', () => {
    expect(dayLine(dayResult([], 'me'))).toBe('Nobody built that day');
  });

  it('never tags a tower the grid does not place', () => {
    expect(dayResult([tower('a', 5000, false), tower('b', 10)], null).best?.userId).toBe('b');
  });
});
