import type { RelayPush, RelayState, RelayTowerSummary } from '../../shared/types/api';
import { RELAY } from '../../shared/relay/rules';

/** A tower's summary into the list, unless the list already has a newer one of it. */
export const mergeSummary = (
  towers: readonly RelayTowerSummary[],
  next: RelayTowerSummary
): RelayTowerSummary[] => {
  const i = towers.findIndex((t) => t.id === next.id);
  if (i < 0) return [...towers, next].sort((a, b) => a.id - b.id);
  if ((towers[i]?.version ?? 0) > next.version) return [...towers];
  const out = [...towers];
  out[i] = next;
  return out;
};

/**
 * The tower on screen with a push's new blocks on top (RelayPush `tail`), or null when this page
 * does not have the tower up to where the push starts.
 */
export const withTail = (current: RelayState, msg: RelayPush): RelayState | null => {
  const tail = msg.tail;
  if (!tail || !Number.isInteger(tail.from) || tail.from < 0) return null;
  if (tail.from > current.blocks.length) return null;
  const turn = msg.turn ?? null;
  // The crew in turn order from whoever holds the turn, as the server lists it.
  let lobby = current.lobby;
  if (turn) {
    const i = lobby.findIndex((p) => p.userId === turn.userId);
    if (i > 0) lobby = [...lobby.slice(i), ...lobby.slice(0, i)];
  }
  const fresh = msg.events ?? (msg.event ? [msg.event] : []);
  return {
    ...current,
    blocks: [...current.blocks.slice(0, tail.from), ...tail.blocks],
    colors: [...current.colors.slice(0, tail.from), ...tail.colors],
    turn,
    lobby,
    version: msg.version,
    events: [...current.events, ...fresh].slice(-RELAY.MAX_EVENTS),
    towers: msg.summary ? mergeSummary(current.towers, msg.summary) : current.towers,
    ...(msg.summary ? { builders: msg.summary.builders, fallen: msg.summary.fallen } : {}),
  };
};
