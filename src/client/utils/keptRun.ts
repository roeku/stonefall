import type { DropInput } from '../../shared/simulation/types';

/**
 * A run played signed out, kept in this browser until the player signs in to raise it.
 *
 * Devvit's guidance for logged-out players: let them play, ask them to sign in at a natural
 * stopping point with a reason to, and carry what they did across the sign-in, which reloads the
 * page. A run is only its seed and its taps (the server replays them to score it), so that is
 * all that is kept: nothing about the player, and nothing a run could not be rebuilt from.
 *
 * It is kept for an hour, and localStorage itself is cleared by every new app version.
 */
export interface KeptRun {
  seed: number;
  gameMode: string;
  inputs: DropInput[];
  score: number;
  at: number;
}

const KEY = 'stonefall:kept-run';
const MAX_AGE_MS = 60 * 60 * 1000;

export const keepRun = (run: Omit<KeptRun, 'at'>): KeptRun | null => {
  const kept: KeptRun = { ...run, score: Math.max(0, Math.round(run.score)), at: Date.now() };
  try {
    window.localStorage.setItem(KEY, JSON.stringify(kept));
    return kept;
  } catch {
    return null;
  }
};

export const readKeptRun = (): KeptRun | null => {
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return null;
    const run = JSON.parse(raw) as Partial<KeptRun>;
    const valid =
      Number.isInteger(run.seed) &&
      typeof run.gameMode === 'string' &&
      Array.isArray(run.inputs) &&
      run.inputs.length > 0 &&
      typeof run.score === 'number' &&
      typeof run.at === 'number' &&
      Date.now() - run.at < MAX_AGE_MS;
    if (!valid) {
      window.localStorage.removeItem(KEY);
      return null;
    }
    return run as KeptRun;
  } catch {
    return null;
  }
};

export const dropKeptRun = (): void => {
  try {
    window.localStorage.removeItem(KEY);
  } catch {
    // Nothing kept is nothing to drop.
  }
};
