import { GameSimulation } from '../simulation/gameSimulation';
import { healedTop, replayTurnDetailed } from '../simulation/runSimulation';
import type { Block } from '../simulation/types';
import type {
  BestTurn,
  RelayEvent,
  RelayPlayer,
  RelayState,
  RelayTap,
  RelayTowerSummary,
  RelayTurn,
} from '../types/api';
import { FACTION_IDS, type FactionId } from '../types/factions';

/**
 * The relay's rules: turns, seats, and when a new tower is started.
 *
 * Since faction towers (`RelayRules` 'factions'), a day's relay is one tower per colour, and every
 * player builds their own colour's. The towers stand side by side and the race between them is
 * the point: a colour's tower is as tall as its players kept it going, and being passed by
 * another colour is something everybody on yours sees. Crews, below, are how a day that opened
 * before that still plays.
 *
 * A turn is ten seconds of stacking: as many blocks as the holder can land, each a little faster
 * than the last, until the time runs out or a block misses. It used to be one block, which made
 * every turn a single tap after a wait, with nothing to build up: a combo, the run's best feeling,
 * could not happen in the relay at all. Now a turn has its own rise, a streak of perfects to keep
 * and a choice between one more and stopping safe.
 *
 * One tower with everyone in the post taking turns does not survive popularity: a hundred people
 * in one rotation is a seventeen-minute wait for the last seat. A queue with a door on it is no
 * better: turning people away from a game they came to play is the worst thing the post could do.
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
   * Most people one tower's crew holds. Players asked for four: with ten-second turns, the last
   * seat waits half a minute, which is long enough to watch the others and short enough to stay.
   */
  CREW_MAX: 4,
  /** How long a turn lasts, server side. */
  TURN_MS: 10_000,
  /** What the client shows of it; the rest is slack for the round trip of the last drops. */
  SHOWN_TURN_MS: 9_000,
  /** Slack after a turn ends before a late tap is refused. Round trips are not free. */
  LATE_MS: 1_500,
  /**
   * Pause between one turn and the next, so the end of a turn -- its tally, or its fall -- is
   * seen before the next sweep starts.
   */
  TURN_GRACE_MS: 1_200,
  /**
   * Ticks a turn's blocks may take beyond the time the turn has run, for clocks a little apart.
   * A client cannot sweep faster than the clock, so a turn holding more than its time is not one.
   */
  TICK_SLACK: 90,
  /** A heartbeat older than this and you are not here. Three missed heartbeats. */
  PRESENT_MS: 20_000,
  /** How long a seat waits for someone who stepped away before it is given up. */
  SEAT_HOLD_MS: 60_000,
  /**
   * Turns in a row a holder may let run out without laying a block before the seat goes to
   * someone who is playing.
   */
  IDLE_LIMIT: 2,
  /**
   * Misses a player has in a day; the last one puts them out until tomorrow.
   *
   * It was one. A newcomer sat through five turns, tapped once, and on a miss was done for the
   * day two seconds into playing, which is the whole of the game for them and none of it good.
   * Then three, and with a subscriber's two more, five: far too many for a miss to matter. Two is
   * one chance to carry on, so the first tap is not the last and the second miss still counts.
   */
  LIVES: 2,
  /**
   * Lives a day on top of LIVES for a player who subscribed to the subreddit from the game, which
   * is offered when they are out. Reddit gives no way to ask whether someone is subscribed, so
   * this counts only subscriptions made through the game's own button (`Users.subscribedFrom`).
   */
  MEMBER_LIVES: 1,
  /** How many events a tower keeps for the ticker. */
  MAX_EVENTS: 24,
  /**
   * On a colour's tower the crew is everyone of that colour who sat down, so it can grow past
   * what ten-second turns can carry. Up to this many a turn is TURN_MS; past it the turns shorten
   * so a whole round stays near ROUND_MS, and never under MIN_TURN_MS.
   */
  FULL_TURNS_UP_TO: 6,
  ROUND_MS: 60_000,
  MIN_TURN_MS: 5_000,
  /**
   * Best turns a tower keeps, one per builder: more than it shows (MARKED), so a builder who drops
   * out of the shown few comes back when theirs is beaten, and the viewer's own is still known.
   */
  BEST_KEPT: 12,
  /** Best turns marked on a tower, besides the viewer's own. */
  MARKED: 5,
} as const;

/**
 * How a day's relay seats people: `crews`, small crews on as many towers as it takes, or
 * `factions`, a tower per colour. Stored with the day when it opens, like the map's rules, so a
 * day in play never changes shape.
 */
export type RelayRules = 'crews' | 'factions';

/** The rules a relay opened now plays by. */
export const RELAY_RULES: RelayRules = 'factions';

/** Stored rules, or crews, which is what every relay that stored none played. */
export const relayRulesOr = (stored: unknown): RelayRules =>
  stored === 'factions' ? 'factions' : 'crews';

/** A colour's tower on a `factions` day: its place in FACTION_IDS, from 1. */
export const towerIdFor = (faction: FactionId): number => FACTION_IDS.indexOf(faction) + 1;

/** The colour a tower belongs to on a `factions` day. */
export const factionOfTower = (id: number): FactionId | null => FACTION_IDS[id - 1] ?? null;

/** How long a turn lasts for a crew of this size. */
export const turnMsFor = (crew: number): number =>
  crew <= RELAY.FULL_TURNS_UP_TO
    ? RELAY.TURN_MS
    : Math.max(RELAY.MIN_TURN_MS, Math.round(RELAY.ROUND_MS / crew / 100) * 100);

/** How much of a turn the client shows: all of it but the slack for the last round trip. */
export const shownTurnMs = (turn: Pick<RelayTurn, 'startedAt' | 'endsAt'>): number =>
  Math.max(1_000, turn.endsAt - turn.startedAt - (RELAY.TURN_MS - RELAY.SHOWN_TURN_MS));

/** One tower, as stored. `RelayState` is the view of it a client gets. */
export interface RelayTowerState {
  id: number;
  day: string;
  blocks: Block[];
  colors: (FactionId | null)[];
  turn: RelayTurn | null;
  /** Seat time of the last player to hold a turn, so rotation continues from there. */
  cursor: number;
  /** The colour whose tower this is, on a `factions` day. */
  faction?: FactionId | undefined;
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
  /** Each builder's best turn here, best first (`noteBestTurn`). */
  best?: BestTurn[] | undefined;
}

/**
 * How good a turn was: its blocks, and its longest run of perfects again, so a combo counts as
 * much as the blocks it was made of. The earlier of two equal turns ranks first.
 */
export const turnScore = (t: Pick<BestTurn, 'laid' | 'streak'>): number => t.laid + t.streak;

const byScore = (a: BestTurn, b: BestTurn): number =>
  turnScore(b) - turnScore(a) || a.from - b.from;

/**
 * Keep a turn as its builder's best on the tower if it beats the one they have. Mutates the tower.
 * Called on every landing, so a turn still going is already on the list.
 */
export const noteBestTurn = (tower: RelayTowerState, turn: BestTurn): void => {
  const list = tower.best ?? [];
  const theirs = list.find((b) => b.userId === turn.userId);
  if (theirs && theirs.from !== turn.from && byScore(theirs, turn) <= 0) return;
  tower.best = [...list.filter((b) => b.userId !== turn.userId), turn]
    .sort(byScore)
    .slice(0, RELAY.BEST_KEPT);
};

/** Where a builder's best turn ranks on a tower, from 1; 0 when it is not kept. */
export const bestRank = (best: readonly BestTurn[] | undefined, userId: string): number =>
  (best ?? []).findIndex((b) => b.userId === userId) + 1;

/** The post: which day, how many towers, whether the day is over. */
export interface RelayMeta {
  postId: string;
  day: string;
  towers: number;
  closed: boolean;
  createdAt: number;
  /** How it seats people. Absent is crews, as every relay before faction towers did. */
  rules?: RelayRules | undefined;
}

/** A fresh tower: the base block alone, in its colour on a `factions` day. */
export const freshTower = (
  id: number,
  day: string,
  now: number,
  faction?: FactionId | null
): RelayTowerState => {
  const base = new GameSimulation(0, 'relay').createInitialState().blocks;
  return {
    id,
    day,
    ...(faction ? { faction } : {}),
    blocks: [...base],
    colors: base.map(() => faction ?? null),
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

/** "1 more life", "2 more lives": what subscribing adds, said the way the game says it. */
export const moreLives = (n: number = RELAY.MEMBER_LIVES): string =>
  `${n} more ${n === 1 ? 'life' : 'lives'}`;

/** Lives a player has today, spent or not. */
export const livesToday = (p: Pick<RelayPlayer, 'extra'>): number =>
  RELAY.LIVES + Math.max(0, p.extra ?? 0);

/** Misses a player can still afford today. Zero once they are out. */
export const livesLeft = (p: Pick<RelayPlayer, 'misses' | 'out' | 'extra'>): number =>
  p.out ? 0 : Math.max(0, livesToday(p) - (p.misses ?? 0));

/**
 * Give a player `extra` lives on top of RELAY.LIVES for the day. Mutates the player; never takes
 * lives away. One who was out and now has a life left is back in, watching: taking a seat again
 * is the player's own tap, not something a subscription does for them. True when they are back.
 */
export const grantLives = (p: RelayPlayer, extra: number): boolean => {
  if ((p.extra ?? 0) >= extra) return false;
  p.extra = extra;
  if (!p.out || (p.misses ?? 0) >= livesToday(p)) return false;
  delete p.out;
  p.tower = null;
  p.idle = 0;
  return true;
};

/** A crew in rotation order: by when each of them sat down. */
export const inSeatOrder = (crew: readonly RelayPlayer[]): RelayPlayer[] =>
  [...crew].sort((a, b) => seatOf(a) - seatOf(b) || a.userId.localeCompare(b.userId));

/**
 * Settle whose turn it is on one tower. Mutates the tower; returns whether anything changed.
 *
 * A turn ends when its holder misses, leaves, or runs out of time, and the next goes to whoever
 * sat down after the last holder, wrapping round. `crew` is who is here, seated on this tower and
 * not out, in seat order. `onIdle` hears about a holder who was here and let the whole turn run
 * out without laying a block, and answers whether that cost them their seat, in which case they
 * are skipped.
 *
 * A turn that ran its time is followed after TURN_GRACE_MS, counted from when it ended rather
 * than from whoever noticed, so the beat between turns is the same whoever settles it.
 */
export const settleTurn = (
  tower: RelayTowerState,
  crew: readonly RelayPlayer[],
  now: number,
  onIdle?: (userId: string) => boolean
): boolean => {
  let changed = false;
  let rotation = crew;
  let startAt = now;
  const turn = tower.turn;
  if (turn) {
    const holderHere = crew.some((p) => p.userId === turn.userId);
    if (!holderHere || now >= turn.endsAt) {
      tower.turn = null;
      changed = true;
      if (holderHere) startAt = Math.max(now, turn.endsAt + RELAY.TURN_GRACE_MS);
      if (holderHere && (turn.laid ?? 0) === 0 && onIdle?.(turn.userId)) {
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
      startedAt: startAt,
      // Shorter when a colour's whole crew is waiting, so the round still comes back in time.
      endsAt: startAt + turnMsFor(rotation.length),
      laid: 0,
      streak: 0,
      ticks: 0,
    };
    tower.cursor = seatOf(next);
    changed = true;
  }
  if (changed) tower.version += 1;
  return changed;
};

/** Whose block `index` on tower `towerId` is: a player's runs (RelayPlayer.runs), extended. */
export const markLaid = (player: RelayPlayer, towerId: number, index: number): void => {
  const runs = { ...(player.runs ?? {}) };
  const key = String(towerId);
  const mine = [...(runs[key] ?? [])];
  const last = mine[mine.length - 1];
  if (last && last[1] === index) mine[mine.length - 1] = [last[0], index + 1];
  else mine.push([index, index + 1]);
  runs[key] = mine;
  player.runs = runs;
};

/** How many blocks of a tower are a player's. */
export const laidCount = (runs: ReadonlyArray<readonly [number, number]> | undefined): number =>
  (runs ?? []).reduce((n, [a, b]) => n + Math.max(0, b - a), 0);

export type DropOutcome =
  | {
      ok: true;
      result: 'landed' | 'perfect' | 'fell';
      event: RelayEvent;
      /** The turn is over: it missed, or its time is up. Otherwise it goes on, one block taller. */
      turnOver: boolean;
    }
  | {
      ok: false;
      reason: string;
      /** The client is looking at a turn or a tower that has moved on; send it the new one. */
      stale?: boolean;
    };

/**
 * One tap on a tower. Mutates the tower and the player.
 *
 * The tick is the client's own count from the start of that block's sweep, replayed against the
 * same standing blocks and the same count of blocks already laid in the turn, so nothing the
 * client says about the outcome is read. `index` is which block the client thought it was
 * placing; if the tower has moved on since, the tap was aimed at a tower that no longer exists
 * and is refused rather than applied to the wrong top.
 *
 * A landing keeps the turn going, one block taller and a little faster, until its time is up.
 * A miss ends it, costs the player a life and heals the top to full width, so the next person is
 * not paying for it. The player keeps their seat until their last life goes, and then they are
 * out for the day. The next turn is not handed out here, because that needs the crew.
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
  const ticks = (turn.ticks ?? 0) + tick;
  if (ticks > ((now - turn.startedAt) * 60) / 1000 + RELAY.TICK_SLACK) {
    return { ok: false, reason: 'That turn ran faster than the clock.', stale: true };
  }

  const laidBefore = turn.laid ?? 0;
  const replay = replayTurnDetailed(tower.blocks, tick, 'relay', laidBefore);
  if (!replay) return { ok: false, reason: 'That tap did not read.' };

  let result: 'landed' | 'perfect' | 'fell';
  let event: RelayEvent;
  if (replay.state.isGameOver) {
    result = 'fell';
    const top = tower.blocks[tower.blocks.length - 1];
    const d = replay.dropped;
    player.misses = (player.misses ?? 0) + 1;
    player.idle = 0;
    const left = livesLeft(player);
    if (left === 0) {
      player.out = { block: tower.blocks.length, at: now };
      // A tower's tally counts the people it put out, not every block that went over.
      tower.fallen += 1;
    }
    tower.blocks = healedTop(tower.blocks);
    event = {
      at: now,
      kind: 'fell',
      username: player.username,
      block: tower.blocks.length,
      faction: player.faction,
      snoovatar: player.snoovatar,
      left,
      lives: livesToday(player),
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
    markLaid(player, tower.id, tower.blocks.length - 1);
    player.blocks += 1;
    if (perfect) player.perfects += 1;
    player.idle = 0;
    // The turn so far, as the builder's best on this tower if it is.
    const inTurn = laidBefore + 1;
    noteBestTurn(tower, {
      userId: player.userId,
      username: player.username,
      snoovatar: player.snoovatar,
      from: tower.blocks.length - inTurn,
      to: tower.blocks.length,
      laid: inTurn,
      streak: Math.max(turn.best ?? 0, perfect ? (turn.streak ?? 0) + 1 : 0),
    });
    event = {
      at: now,
      kind: result,
      username: player.username,
      block: tower.blocks.length,
      faction: player.faction,
      ...(perfect ? { streak: (turn.streak ?? 0) + 1 } : {}),
    };
    tower.events.push(event);
  }
  if (tower.events.length > RELAY.MAX_EVENTS) tower.events = tower.events.slice(-RELAY.MAX_EVENTS);

  // A landing in time keeps the turn: the next block is the same player's, a little faster.
  const turnOver = result === 'fell' || now >= turn.endsAt;
  tower.turn = turnOver
    ? null
    : {
        ...turn,
        index: tower.blocks.length,
        laid: laidBefore + 1,
        streak: result === 'perfect' ? (turn.streak ?? 0) + 1 : 0,
        best: Math.max(turn.best ?? 0, result === 'perfect' ? (turn.streak ?? 0) + 1 : 0),
        ticks,
      };
  tower.cursor = seatOf(player);
  tower.version += 1;
  return { ok: true, result, event, turnOver };
};

/** The taps in a drop request (RelayDropRequest), in order; empty if it holds none. */
export const parseTaps = (body: unknown): RelayTap[] => {
  const b = (body ?? {}) as { drops?: unknown; tick?: unknown; index?: unknown };
  const raw: unknown[] = Array.isArray(b.drops) ? b.drops : b.tick !== undefined ? [b] : [];
  return raw.map((t) => {
    const r = (t ?? {}) as { tick?: unknown; index?: unknown };
    return { tick: Number(r.tick), index: Number(r.index) };
  });
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

/**
 * Where someone who asks to build is seated: their colour's tower on a `factions` day, whatever
 * they were watching; otherwise as `chooseTower` says, null meaning a new tower.
 */
export const seatFor = (
  rules: RelayRules,
  faction: FactionId,
  towers: readonly TowerChoice[],
  watching: number | null,
  cap: number = RELAY.CREW_MAX
): number | null =>
  rules === 'factions' ? towerIdFor(faction) : chooseTower(towers, watching, cap);

/** One colour's tower in the day's race. */
export interface RaceEntry {
  faction: FactionId;
  tower: number;
  height: number;
}

/**
 * The colours' towers, tallest first, with the first to get there ahead on a tie (the lower id
 * stands in for that). Only towers anybody has built on count: a bare base is not in the race.
 */
export const raceOf = (
  towers: ReadonlyArray<Pick<RelayTowerSummary, 'id' | 'height' | 'faction' | 'builders'>>
): RaceEntry[] =>
  towers
    .filter((t) => t.faction && t.builders > 0)
    .map((t) => ({ faction: t.faction!, tower: t.id, height: t.height }))
    .sort((a, b) => b.height - a.height || a.tower - b.tower);

/**
 * Where a colour stands in the race: its place (0 when it has not built), and the colour just
 * above it with how far behind it is, or when it leads, the colour just below and how far ahead.
 */
export const raceStanding = (
  race: readonly RaceEntry[],
  faction: FactionId
): { place: number; above?: RaceEntry; below?: RaceEntry; gap: number } => {
  const i = race.findIndex((r) => r.faction === faction);
  if (i < 0)
    return {
      place: 0,
      gap: 0,
      ...(race[race.length - 1] ? { above: race[race.length - 1]! } : {}),
    };
  const mine = race[i]!;
  if (i === 0) {
    const below = race[1];
    return { place: 1, gap: below ? mine.height - below.height : 0, ...(below ? { below } : {}) };
  }
  const above = race[i - 1]!;
  return { place: i + 1, above, gap: above.height - mine.height };
};

/** The colours a tower went past by growing from `before` blocks to `after`. */
export const passedBetween = (
  race: readonly RaceEntry[],
  faction: FactionId,
  before: number,
  after: number
): FactionId[] =>
  race
    .filter((r) => r.faction !== faction && r.height >= before && r.height < after)
    .map((r) => r.faction);

/**
 * The tower a newcomer is shown first: where the most people are building, then the tallest. On
 * a day that has topped out, where nobody is building, that is the tallest: how high it got.
 */
export const featuredTower = (towers: readonly TowerChoice[]): number => {
  const open = towers.filter((t) => !t.closed);
  const busiest = [...(open.length > 0 ? open : towers)].sort(
    (a, b) => b.crew - a.crew || b.height - a.height || a.id - b.id
  )[0];
  return busiest?.id ?? 1;
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
  ...(tower.faction ? { faction: tower.faction } : {}),
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
  rules?: RelayRules | undefined;
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
    rules: args.rules ?? 'crews',
    best: tower.best ?? [],
  };
};
