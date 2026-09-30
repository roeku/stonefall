import type { Block, GameState } from '../../shared/simulation/types';

/**
 * Whether a step of the simulation changed anything React draws.
 *
 * The simulation steps sixty times a second, and each step used to be handed to React as new
 * state: the whole app re-rendered on every tick of a run, twice a frame, which is most of what
 * a run cost a phone. Almost all of those ticks only move the block in play, and the frame loop
 * moves that itself from the live state, so they stay in a ref and React hears only about what
 * it draws differently: a placement, the end, an effect coming or going, or the moving block
 * changing shape or starting to fall.
 *
 * Keyed on identity where the simulation keeps it (the blocks and the last placement are carried
 * over by reference until they change), on the members of the effect lists (the lists themselves
 * are filtered afresh on every tick), and on the moving block's shape, since that object is new
 * on every tick it moves.
 */
export const needsRender = (prev: GameState | null, next: GameState | null): boolean => {
  if (!prev || !next) return prev !== next;
  return (
    prev.blocks !== next.blocks ||
    prev.isGameOver !== next.isGameOver ||
    prev.score !== next.score ||
    prev.combo !== next.combo ||
    prev.lastPlacement !== next.lastPlacement ||
    !sameMembers(prev.recentTrimEffects, next.recentTrimEffects) ||
    !sameMembers(prev.recentGrowthEffects ?? [], next.recentGrowthEffects ?? []) ||
    !sameShape(prev.currentBlock, next.currentBlock)
  );
};

const sameShape = (a: Block | null, b: Block | null): boolean => {
  if (!a || !b) return a === b;
  return (
    a.width === b.width &&
    a.height === b.height &&
    a.depth === b.depth &&
    !!a.isFalling === !!b.isFalling
  );
};

const sameMembers = <T>(a: ReadonlyArray<T>, b: ReadonlyArray<T>): boolean =>
  a === b || (a.length === b.length && a.every((item, i) => item === b[i]));
