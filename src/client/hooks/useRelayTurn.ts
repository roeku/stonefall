import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';
import { createTurnSimulation } from '../../shared/simulation/runSimulation';
import type { Block, GameState } from '../../shared/simulation/types';
import type { RelayState, RelayTap } from '../../shared/types/api';
import { shownTurnMs } from '../../shared/relay/rules';
import { needsRender } from './liveState';

/**
 * The turn in progress, simulated locally.
 *
 * Every client rebuilds the same moving block from the same standing blocks, so the player on
 * turn sees the sweep they will be judged on and everyone else sees a close approximation of
 * it. A turn is ten seconds of stacking, so the player's own turn runs ahead of the server: a
 * tap lands on the spot, the next block comes in at once, a little faster (setBurst), and the
 * taps go to the server behind it, which replays each against the same blocks and answers with
 * the tower everyone will agree on. An answer that is only behind what this client has, and
 * agrees with it as far as it goes, is not allowed to pull the turn back; one that disagrees is
 * the truth, and the turn carries on from it.
 *
 * One simulation runs the whole turn rather than one per block, so the scene's effects keep a
 * single clock. A block's tick is counted from where its sweep began, which is what the server
 * replays (`replayTurnDetailed` from fresh, with the turn's `laid`); relayTurn.test.ts holds the
 * two to the same blocks.
 */
export interface RelayTurnHook {
  /** What the scene draws: the standing tower and, while a turn is live, the moving block. */
  gameState: GameState | null;
  /** The state as of the latest tick. The sweep lives here; React hears only about changes. */
  liveState: RefObject<GameState | null>;
  /** True while a turn is on and its block is in play here. */
  live: boolean;
  /** The player's own turn is over on this page (time, or a miss) and the next is coming. */
  done: boolean;
  stepFrame: () => void;
  /**
   * Drop the block. Returns the tap to send and whether it landed here, or null if it is not
   * this client's turn.
   */
  tap: () => { tap: RelayTap; landed: boolean } | null;
  /**
   * This client's last landing, as its own simulation judged it. Kept past the server's answer,
   * which rebuilds the simulation and forgets it.
   */
  lastLanding: LastLanding | null;
  /** The player's own turn, as it goes: blocks laid, perfects in a row, best run of them. */
  burst: Burst | null;
  /**
   * The server refused some of this turn's taps: take the tower as it says, rather than the one
   * this page ran ahead to. Without it, an answer that is only shorter looks like one catching up.
   */
  resync: () => void;
}

export interface LastLanding {
  /** Counts this page's landings, so each one can be keyed on its own. */
  n: number;
  placement: NonNullable<GameState['lastPlacement']>;
}

export interface Burst {
  /** Which turn: its start, on the server's clock. */
  startedAt: number;
  laid: number;
  streak: number;
  best: number;
  /** How it ended, once it has: the clock, or a block over the edge. */
  ended: 'time' | 'fell' | null;
}

type Sim = ReturnType<typeof createTurnSimulation>['sim'];

/** The same block at the same index in two towers: position and extents. */
const sameAt = (a: readonly Block[], b: readonly Block[], i: number): boolean => {
  const x = a[i];
  const y = b[i];
  if (!x || !y) return false;
  return (
    x.x === y.x &&
    (x.z ?? 0) === (y.z ?? 0) &&
    x.y === y.y &&
    x.width === y.width &&
    (x.depth ?? x.width) === (y.depth ?? y.width)
  );
};

export const useRelayTurn = (
  state: RelayState | null,
  myUserId: string | null,
  serverNow: () => number
): RelayTurnHook => {
  const simRef = useRef<Sim | null>(null);
  const stateRef = useRef<GameState | null>(null);
  const [gameState, setGameState] = useState<GameState | null>(null);
  const [lastLanding, setLastLanding] = useState<LastLanding | null>(null);
  const [burst, setBurst] = useState<Burst | null>(null);
  const forceRef = useRef(false);
  const [nonce, setNonce] = useState(0);
  const burstRef = useRef<Burst | null>(null);
  /** The tick the block in hand began its sweep on: a tap is sent counted from there. */
  const spawnRef = useRef(0);
  /** Which turn this page is playing as its own, by tower, holder and start. */
  const ownRef = useRef<string | null>(null);
  const turnRef = useRef<RelayState['turn']>(null);
  const mineRef = useRef(false);

  const turn = state && !state.closed ? state.turn : null;
  const mine = !!turn && !!myUserId && turn.userId === myUserId;
  const version = state?.version ?? 0;
  // The tower is part of the key: two towers can share a version number and a turn shape.
  const turnKey = `${state?.tower ?? 0}:${turn ? `${turn.userId}:${turn.startedAt}` : 'none'}`;

  useEffect(() => {
    turnRef.current = turn;
    mineRef.current = mine;
  });

  const publishBurst = useCallback((next: Burst | null) => {
    burstRef.current = next;
    setBurst(next);
  }, []);

  // Rebuild the local simulation whenever the tower or the turn changes, unless the change is
  // only the server catching up with this page's own turn.
  useEffect(() => {
    if (!state) return;
    const local = stateRef.current;
    const own = mine && ownRef.current === turnKey;
    const forced = forceRef.current;
    forceRef.current = false;
    if (own && local && !forced) {
      const n = state.blocks.length;
      const behind =
        n <= local.blocks.length && (n === 0 || sameAt(state.blocks, local.blocks, n - 1));
      if (behind) return;
    }
    const laid = turn?.laid ?? 0;
    const built = createTurnSimulation(state.blocks, laid);
    simRef.current = built.sim;
    spawnRef.current = 0;
    const next = turn ? built.state : { ...built.state, currentBlock: null };
    stateRef.current = next;
    setGameState(next);
    if (mine) {
      // A new turn of the player's own, or the server's word on one under way.
      if (!own) ownRef.current = turnKey;
      const before = own ? burstRef.current : null;
      publishBurst({
        startedAt: turn!.startedAt,
        laid,
        streak: turn?.streak ?? 0,
        best: Math.max(before?.best ?? 0, turn?.streak ?? 0),
        ended: null,
      });
    } else {
      ownRef.current = null;
      // The player's own turn has gone to someone else: what it came to stays on screen until
      // the next of theirs begins.
      const b = burstRef.current;
      if (b && !b.ended) publishBurst({ ...b, ended: 'time' });
    }
    // The blocks and the turn are what matter; both are summarised by version and turnKey.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [version, turnKey, nonce]);

  const resync = useCallback(() => {
    forceRef.current = true;
    setNonce((n) => n + 1);
  }, []);

  /** The block in hand is put away: the turn's time is up here. */
  const putAway = useCallback(() => {
    const current = stateRef.current;
    if (!current || !current.currentBlock) return;
    const next = { ...current, currentBlock: null };
    stateRef.current = next;
    setGameState(next);
  }, []);

  const stepFrame = useCallback(() => {
    const sim = simRef.current;
    const current = stateRef.current;
    const t = turnRef.current;
    if (!sim || !current || !t || current.isGameOver || !current.currentBlock) return;
    const now = serverNow();
    // The beat between turns: the block waits at the edge until the turn begins.
    if (now < t.startedAt) return;
    if (mineRef.current) {
      const b = burstRef.current;
      if (b?.ended) return;
      if (now >= t.startedAt + shownTurnMs(t)) {
        if (b) publishBurst({ ...b, ended: 'time' });
        putAway();
        return;
      }
    } else if (now >= t.endsAt) {
      putAway();
      return;
    }
    const next = sim.stepSimulation(current);
    stateRef.current = next;
    if (needsRender(current, next)) setGameState(next);
  }, [serverNow, publishBurst, putAway]);

  const tap = useCallback((): { tap: RelayTap; landed: boolean } | null => {
    const sim = simRef.current;
    const current = stateRef.current;
    const t = turnRef.current;
    if (!sim || !current || !t || !mineRef.current) return null;
    const b = burstRef.current;
    if (!current.currentBlock || current.isGameOver || b?.ended) return null;
    if (serverNow() < t.startedAt) return null;
    const tick = current.tick + 1;
    const index = current.blocks.length;
    const sent = { tick: tick - spawnRef.current, index };
    const next = sim.stepSimulation(current, { tick });
    stateRef.current = next;
    setGameState(next);
    const placement = next.lastPlacement;
    if (next.isGameOver || !placement) {
      if (b) publishBurst({ ...b, ended: 'fell' });
      return { tap: sent, landed: false };
    }
    // Landed: the next block is already in, and it sweeps a little faster for this one.
    spawnRef.current = next.tick;
    const laid = (b?.laid ?? 0) + 1;
    sim.setBurst(laid);
    const streak = placement.isPositionPerfect ? (b?.streak ?? 0) + 1 : 0;
    publishBurst({
      startedAt: t.startedAt,
      laid,
      streak,
      best: Math.max(b?.best ?? 0, streak),
      ended: null,
    });
    setLastLanding((l) => ({ n: (l?.n ?? 0) + 1, placement }));
    return { tap: sent, landed: true };
  }, [serverNow, publishBurst]);

  const done = mine && !!burst?.ended;
  const live = !!turn && gameState?.currentBlock != null && !done;

  return { gameState, liveState: stateRef, live, done, stepFrame, tap, lastLanding, burst, resync };
};
