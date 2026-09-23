import { useCallback, useEffect, useRef, useState } from 'react';
import { createRunSimulation } from '../../shared/simulation/runSimulation';
import type { GameState } from '../../shared/simulation/types';
import type { RelayState } from '../../shared/types/api';

/**
 * The turn in progress, simulated locally.
 *
 * Every client rebuilds the same moving block from the same standing blocks, so the player on
 * turn sees the sweep they will be judged on and everyone else sees a close approximation of
 * it. A tap steps the local simulation on the spot, so the landing (or the fall) is felt on
 * the frame it happens, and the tick is sent to the server, which replays it and answers with
 * the tower everyone will now agree on.
 */
export interface RelayTurnHook {
  /** What the scene draws: the standing tower and, while a turn is live, the moving block. */
  gameState: GameState | null;
  /** True while the moving block is sweeping and nobody has dropped it yet. */
  live: boolean;
  /** True from the moment this client tapped until the server's state comes back. */
  dropped: boolean;
  stepFrame: () => void;
  /** Drop the block. Returns the tick to send, or null if it is not this client's turn. */
  tap: () => number | null;
}

type Sim = ReturnType<typeof createRunSimulation>;

export const useRelayTurn = (state: RelayState | null, myUserId: string | null): RelayTurnHook => {
  const simRef = useRef<Sim | null>(null);
  const stateRef = useRef<GameState | null>(null);
  const [gameState, setGameState] = useState<GameState | null>(null);
  const [dropped, setDropped] = useState(false);
  const droppedRef = useRef(false);

  const version = state?.version ?? 0;
  // The tower is part of the key: two towers can share a version number and a turn shape.
  const turnKey = `${state?.tower ?? 0}:${
    state?.turn ? `${state.turn.userId}:${state.turn.index}:${state.turn.startedAt}` : 'none'
  }`;

  // Rebuild the local simulation whenever the tower or the turn changes.
  useEffect(() => {
    if (!state) return;
    const sim = createRunSimulation(0, 'relay');
    const built = sim.createStateFromBlocks(state.blocks);
    const next = state.turn && !state.closed ? built : { ...built, currentBlock: null };
    simRef.current = sim;
    stateRef.current = next;
    setGameState(next);
    droppedRef.current = false;
    setDropped(false);
    // The blocks and the turn are what matter; both are summarised by version and turnKey.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [version, turnKey]);

  const live = !!state?.turn && !state.closed && !dropped && gameState?.currentBlock != null;

  const stepFrame = useCallback(() => {
    const sim = simRef.current;
    const current = stateRef.current;
    if (!sim || !current || current.isGameOver || !current.currentBlock || droppedRef.current)
      return;
    const next = sim.stepSimulation(current);
    stateRef.current = next;
    setGameState(next);
  }, []);

  const tap = useCallback((): number | null => {
    const sim = simRef.current;
    const current = stateRef.current;
    if (!sim || !current || !state?.turn || droppedRef.current) return null;
    if (!myUserId || state.turn.userId !== myUserId) return null;
    if (!current.currentBlock || current.isGameOver) return null;
    const tick = current.tick + 1;
    const next = sim.stepSimulation(current, { tick });
    stateRef.current = next;
    setGameState(next);
    droppedRef.current = true;
    setDropped(true);
    return tick;
  }, [state?.turn, myUserId]);

  return { gameState, live, dropped, stepFrame, tap };
};
