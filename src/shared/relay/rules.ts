import { GameSimulation } from '../simulation/gameSimulation';
import { healedTop, replayTurnDetailed } from '../simulation/runSimulation';
import type { Block } from '../simulation/types';
import type {
  RelayEvent,
  RelayPlayer,
  RelayState,
  RelayTowerSummary,
  RelayTurn,
} from '../types/api';
import { FACTION_IDS, type FactionId } from '../types/factions';

/**
 * The relay's rules: turns, seats, and when a new tower is started.
 *
 * One tower with everyone in the post taking turns does not survive popularity. Turns run up to
 * ten seconds, so a hundred people in one rotation is a seventeen-minute wait for the last seat,
 * and nobody waits seventeen minutes to place one block. A queue with a door on it is no better:
 * turning people away from a game they came to play is the worst thing the post could do.
 *
 * So a post holds as many towers as it needs. A tower's crew is at most CREW_MAX people; asking
 * to build seats you on the tower you are watching if it has room, otherwise on the busiest
 * tower that does, and when every crew is full it starts a new tower. The towers stand side by
 * side, so a crew is racing the others rather than waiting behind them.
 *
 * Seats are taken, not handed out by presence. Reddit shows this post inline in the feed, so
 * "whoever has the post on screen" includes everyone scrolling past, and a rotation built from
 * them hands turns to people who never meant to play. A seat is kept while its holder is here;
 * a holder who lets two turns in a row run out gives it up for someone who is.
 *
 * Everything here is pure. The server wraps it in Redis and realtime; the local harness wraps it
 * in memory and bots. Both judge a turn with the same function, so the harness cannot drift.
 */

export const RELAY = {
  /**
   * Most people one tower's crew holds. With turns of up to ten seconds the last seat waits about
   * a minute at the very worst, and most turns end in two or three seconds with a tap.
   */
  CREW_MAX: 6,
  /** How long a turn lasts, server side. */
  TURN_MS: 10_000,
  /** What the client shows of it; the rest is slack for the round trip. */
  SHOWN_TURN_MS: 8_000,
  /** Slack after a turn ends before a late tap is refused. Round trips are not free. */
  LATE_MS: 1_500,
  /** Pause between a landing and the next turn, so the landing is seen before the next sweep. */
  TURN_GRACE_MS: 900,
  /** A heartbeat older than this and you are not here. Three missed heartbeats. */
  PRESENT_MS: 20_000,
  /** How long a seat waits for someone who stepped away before it is given up. */
  SEAT_HOLD_MS: 60_000,
  /** Turns in a row a holder may let run out before the seat goes to someone who is playing. */
  IDLE_LIMIT: 2,
  /** How many events a tower keeps for the ticker. */
  MAX_EVENTS: 24,
} as const;

/** One tower, as stored. `RelayState` is the view of it a client gets. */
export interface RelayTowerState {
  id: number;
  day: string;
  blocks: Block[];
  colors: (FactionId | null)[];
  turn: RelayTurn | null;
  /** Seat time of the last player to hold a turn, so rotation continues from there. */
  cursor: number;
  /** People who have laid at least one block on this tower. */
  builders: number;
  fallen: number;
  closed: boolean;
  events: RelayEvent[];
  version: number;
  createdAt: number;
  /** Who was seated here at the last write, so a crew change is a change worth pushing. */
  seated?: string | undefined;
  /** Storage's own stamp, so a write can tell whether it was the one that stuck. */
  rev?: string | undefined;
}

/** The post: which day, how many towers, whether the day is over. */
export interface RelayMeta {
  postId: string;
  day: string;
  towers: number;
  closed: boolean;
  createdAt: number;
}

/** A fresh tower: the base block alone. */
export const freshTower = (id: number, day: string, now: number): RelayTowerState => {
  const base = new GameSimulation(0, 'relay').createInitialState().blocks;
  return {
    id,
    day,
    blocks: [...base],
    colors: base.map(() => null),
    turn: null,
    cursor: 0,
    builders: 0,
    fallen: 0,
    closed: false,
    events: [{ at: now, kind: 'opened', username: '', block: base.length }],
    version: 1,
    createdAt: now,
  };
};

/** When a player took the seat they hold: their place in the rotation. */
export const seatOf = (p: RelayPlayer): number => p.seatedAt ?? p.joinedAt;

/** A crew in rotation order: by when each of them sat down. */
export const inSeatOrder = (crew: readonly RelayPlayer[]): RelayPlayer[] =>
  [...crew].sort((a, b) => seatOf(a) - seatOf(b) || a.userId.localeCompare(b.userId));

/**
 * Settle whose turn it is on one tower. Mutates the tower; returns whether anything changed.
 *
 * A turn ends when its holder drops, leaves, or runs out of time, and the next goes to whoever
 * sat down after the last holder, wrapping round. `crew` is who is here, seated on this tower and
 * not out, in seat order. `onTimeout` hears about a holder who was here and let the clock run
 * out, and answers whether that cost them their seat, in which case they are skipped.
 */
export const settleTurn = (
  tower: RelayTowerState,
  crew: readonly RelayPlayer[],
  now: number,
  onTimeout?: (userId: string) => boolean
): boolean => {
  let changed = false;
  let rotation = crew;
  const turn = tower.turn;
  if (turn) {
    const holderHere = crew.some((p) => p.userId === turn.userId);
    if (!holderHere || now >= turn.endsAt) {
      tower.turn = null;
      changed = true;
      if (holderHere && onTimeout?.(turn.userId)) {
        rotation = crew.filter((p) => p.userId !== turn.userId);
      }
    }
  }
  if (!tower.turn && rotation.length > 0 && !tower.closed) {
    const next = rotation.find((p) => seatOf(p) > tower.cursor) ?? rotation[0]!;
    tower.turn = {
      userId: next.userId,
      username: next.username,
      index: tower.blocks.length,
      startedAt: now,
      endsAt: now + RELAY.TURN_MS,
    };
    tower.cursor = seatOf(next);
    changed = true;
  }
  if (changed) tower.version += 1;
  return changed;
};

export type DropOutcome =
  | { ok: true; result: 'landed' | 'perfect' | 'fell'; event: RelayEvent }
  | {
      ok: false;
      reason: string;
      /** The client is looking at a turn or a tower that has moved on; send it the new one. */
      stale?: boolean;
    };

/**
 * One tap on a tower. Mutates the tower and the player.
 *
 * The tick is the client's own count from the start of its sweep, replayed against the same
 * standing blocks, so nothing the client says about the outcome is read. `index` is which block
 * the client thought it was placing; if the tower has moved on since, the tap was aimed at a
 * tower that no longer exists and is refused rather than applied to the wrong top.
 *
 * A miss puts the player out for the day and heals the top to full width, so the next person is
 * not paying for it. The next turn is not handed out here, because that needs the crew.
 */
export const applyDrop = (
  tower: RelayTowerState,
  player: RelayPlayer,
  tick: number,
  index: number,
  now: number
): DropOutcome => {
  if (tower.closed) return { ok: false, reason: "This tower is finished. Find today's post." };
  if (player.out) return { ok: false, reason: 'You are out for today.' };
  const turn = tower.turn;
  if (!turn || turn.userId !== player.userId) {
    return { ok: false, reason: 'Not your turn.', stale: true };
  }
  if (now >= turn.endsAt + RELAY.LATE_MS) {
    return { ok: false, reason: 'Too late. The turn passed on.', stale: true };
  }
  if (turn.index !== index || index !== tower.blocks.length) {
    return { ok: false, reason: 'The tower grew. Aim again.', stale: true };
  }
  if (now < turn.startedAt - RELAY.LATE_MS) return { ok: false, reason: 'Not yet.' };

  const replay = replayTurnDetailed(tower.blocks, tick, 'relay');
  if (!replay) return { ok: false, reason: 'That tap did not read.' };

  let result: 'landed' | 'perfect' | 'fell';
  let event: RelayEvent;
  if (replay.state.isGameOver) {
    result = 'fell';
    const top = tower.blocks[tower.blocks.length - 1];
    const d = replay.dropped;
    player.out = { block: tower.blocks.length, at: now };
    tower.fallen += 1;
    tower.blocks = healedTop(tower.blocks);
    event = {
      at: now,
      kind: 'fell',
      username: player.username,
      block: tower.blocks.length,
      faction: player.faction,
      snoovatar: player.snoovatar,
      ...(d && top
        ? {
            missed: {
              x: d.x,
              // Resting on the top it missed, centre height, whatever the sweep's own y was.
              y: top.y + top.height + Math.floor(d.height / 2),
              z: d.z ?? 0,
              width: d.width,
              depth: d.depth ?? d.width,
              height: d.height,
            },
          }
        : {}),
    };
    tower.events.push(event);
    tower.events.push({ at: now, kind: 'healed', username: '', block: tower.blocks.length });
  } else {
    const perfect = replay.state.lastPlacement?.isPositionPerfect === true;
    result = perfect ? 'perfect' : 'landed';
    tower.blocks = [...replay.state.blocks];
    tower.colors = [...tower.colors, player.faction];
    const laid = player.laidOn ?? [];
    if (!laid.includes(tower.id)) {
      tower.builders += 1;
      player.laidOn = [...laid, tower.id];
    }
    player.blocks += 1;
    if (perfect) player.perfects += 1;
    player.idle = 0;
    event = {
      at: now,
      kind: result,
      username: player.username,
      block: tower.blocks.length,
      faction: player.faction,
    };
    tower.events.push(event);
  }
  if (tower.events.length > RELAY.MAX_EVENTS) tower.events = tower.events.slice(-RELAY.MAX_EVENTS);

  tower.turn = null;
  tower.cursor = seatOf(player);
  tower.version += 1;
  return { ok: true, result, event };
};

/** What choosing a tower needs to know about each one. */
export interface TowerChoice {
  id: number;
  /** Seated crew who are here. */
  crew: number;
  /** Blocks standing. */
  height: number;
  closed?: boolean | undefined;
}

/**
 * Which tower someone who asks to build is seated on. Null means every crew is full: start one.
 *
 * The tower they are watching, if it has room, because "Join" should join what is on screen.
 * Otherwise the busiest tower with room, because a crew is the point, and among empty ones the
 * tallest, so a tower whose crew went home is picked up rather than abandoned for a fresh base.
 */
export const chooseTower = (
  towers: readonly TowerChoice[],
  watching: number | null,
  cap: number = RELAY.CREW_MAX
): number | null => {
  const open = towers.filter((t) => !t.closed && t.crew < cap);
  if (watching !== null) {
    const w = open.find((t) => t.id === watching);
    if (w) return w.id;
  }
  if (open.length === 0) return null;
  return [...open].sort((a, b) => b.crew - a.crew || b.height - a.height || a.id - b.id)[0]!.id;
};

/** The tower a newcomer is shown first: where the most people are building, then the tallest. */
export const featuredTower = (towers: readonly TowerChoice[]): number => {
  const busiest = [...towers]
    .filter((t) => !t.closed)
    .sort((a, b) => b.crew - a.crew || b.height - a.height || a.id - b.id)[0];
  return busiest?.id ?? towers[0]?.id ?? 1;
};

/** Block colours as one character each: '0' for none, else the faction's index plus one. */
export const encodeColors = (colors: readonly (FactionId | null | undefined)[]): string =>
  colors
    .map((c) => {
      const i = c ? FACTION_IDS.indexOf(c) : -1;
      return i >= 0 ? String(i + 1) : '0';
    })
    .join('');

export const decodeColors = (encoded: string): (FactionId | null)[] =>
  [...encoded].map((ch) => {
    const i = Number(ch) - 1;
    return i >= 0 ? (FACTION_IDS[i] ?? null) : null;
  });

export const summarize = (tower: RelayTowerState, crew: number): RelayTowerSummary => ({
  id: tower.id,
  height: tower.blocks.length,
  colors: encodeColors(tower.colors),
  crew,
  turnUser: tower.turn?.username ?? null,
  builders: tower.builders,
  fallen: tower.fallen,
  closed: tower.closed,
  version: tower.version,
});

/** The view a client gets: one tower, its crew from whoever holds the turn, every summary. */
export const viewOf = (args: {
  postId: string;
  day: string;
  tower: RelayTowerState;
  /** Here, seated on this tower, not out, in seat order. */
  crew: readonly RelayPlayer[];
  me: RelayPlayer | null;
  towers: readonly RelayTowerSummary[];
  now: number;
  closed: boolean;
}): RelayState => {
  const { tower } = args;
  let lobby = [...args.crew];
  const turn = tower.turn;
  if (turn) {
    const i = lobby.findIndex((p) => p.userId === turn.userId);
    if (i > 0) lobby = [...lobby.slice(i), ...lobby.slice(0, i)];
  }
  return {
    postId: args.postId,
    day: args.day,
    tower: tower.id,
    blocks: tower.blocks,
    colors: tower.colors ?? tower.blocks.map(() => null),
    turn,
    lobby,
    builders: tower.builders,
    fallen: tower.fallen,
    now: args.now,
    closed: args.closed || tower.closed,
    events: tower.events,
    me: args.me,
    version: tower.version,
    towers: [...args.towers].sort((a, b) => a.id - b.id),
    crewMax: RELAY.CREW_MAX,
  };
};
