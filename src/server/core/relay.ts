import { context, realtime, reddit, redis } from '@devvit/web/server';
import { healedTop, replayTurn } from '../../shared/simulation/runSimulation';
import { GameSimulation } from '../../shared/simulation/gameSimulation';
import type { Block } from '../../shared/simulation/types';
import type {
  RelayEvent,
  RelayPlayer,
  RelayPush,
  RelayState,
  RelayTurn,
} from '../../shared/types/api';
import type { FactionId } from '../../shared/types/factions';
import { SocialService } from './socialService';
import {
  RELAY_CURRENT,
  RELAY_TTL_SECONDS,
  relayLobbyKey,
  relayPlayersKey,
  relayStateKey,
} from './keys';
import { Users } from './users';

/**
 * Relay: the shared daily tower.
 *
 * One tower per day, in a post of its own. Whoever is in the post is in the lobby; turns rotate
 * through the lobby in the order people arrived; on your turn you get one block, ten seconds,
 * the ordinary sweep. Land it and the tower is one taller for everybody. Miss it and you are out
 * until tomorrow, the block you dropped is discarded, and the top heals to full width so the
 * next person is not paying for your mistake. A near miss still trims the top, so between heals
 * the risk is shared: the tower a careless run of players leaves behind is the tower you get.
 *
 * Every turn is verified the way a solo run is: the client sends the tick it tapped on, the
 * server rebuilds the same moving block from the same standing blocks and replays that one tap.
 * Nothing the client says about the outcome is read.
 *
 * Nobody is ever waited for. Turn timeouts are settled lazily, on whatever request comes next,
 * and heartbeats come every few seconds from every open client, so a forfeited turn passes
 * within a heartbeat of expiring. Changes are pushed over realtime; a client that misses one
 * notices the version gap and refetches.
 */

/** A heartbeat older than this and you are no longer in the lobby. Three missed heartbeats. */
export const PRESENT_MS = 20_000;
/** How long a turn lasts, server side. The client shows ten seconds and keeps two in reserve. */
export const TURN_MS = 12_000;
/** Slack after a turn ends before a late tap is refused. Round trips are not free. */
export const LATE_MS = 1_500;
/** Pause between a landing and the next turn, so the landing is seen before the next sweep. */
export const TURN_GRACE_MS = 900;
/** How many events the ticker keeps. */
const MAX_EVENTS = 24;
/** Most people a lobby lists. Beyond this, position still counts them; the strip does not draw them. */
const MAX_LOBBY = 64;

/** The stored row. `RelayState` is the view of it a client gets. */
interface RelayStored {
  postId: string;
  day: string;
  blocks: Block[];
  colors: (FactionId | null)[];
  turn: RelayTurn | null;
  /** joinedAt of the last player to hold a turn, so rotation continues from there. */
  cursor: number;
  builders: number;
  fallen: number;
  closed: boolean;
  events: RelayEvent[];
  version: number;
  createdAt: number;
}

const channelFor = (postId: string): string => `relay_${postId.replace(/[^a-zA-Z0-9_]/g, '')}`;

const dayOf = (ms: number): string => new Date(ms).toISOString().slice(0, 10);

const parsePlayer = (raw: string | null | undefined): RelayPlayer | null => {
  if (!raw) return null;
  try {
    return JSON.parse(raw) as RelayPlayer;
  } catch {
    return null;
  }
};

const push = async (postId: string, msg: RelayPush): Promise<void> => {
  try {
    // Structurally JSON already; the cast is for the interface-versus-index-signature gap.
    await realtime.send(channelFor(postId), JSON.parse(JSON.stringify(msg)));
  } catch {
    // Realtime is a convenience; polling covers its absence.
  }
};

const ttl = () => new Date(Date.now() + RELAY_TTL_SECONDS * 1000);

export const Relay = {
  channelFor,

  async currentPostId(): Promise<string | null> {
    return (await redis.get(RELAY_CURRENT)) ?? null;
  },

  async read(postId: string): Promise<RelayStored | null> {
    const raw = await redis.get(relayStateKey(postId));
    if (!raw) return null;
    try {
      return JSON.parse(raw) as RelayStored;
    } catch {
      return null;
    }
  },

  async write(state: RelayStored): Promise<void> {
    await redis.set(relayStateKey(state.postId), JSON.stringify(state), { expiration: ttl() });
  },

  /** A fresh tower: the base block alone. */
  fresh(postId: string, now: number): RelayStored {
    const base = new GameSimulation(0, 'relay').createInitialState().blocks;
    return {
      postId,
      day: dayOf(now),
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
  },

  async players(postId: string): Promise<Map<string, RelayPlayer>> {
    const all = (await redis.hGetAll(relayPlayersKey(postId))) ?? {};
    const out = new Map<string, RelayPlayer>();
    for (const [id, raw] of Object.entries(all)) {
      const p = parsePlayer(raw);
      if (p) out.set(id, p);
    }
    return out;
  },

  async savePlayer(postId: string, p: RelayPlayer): Promise<void> {
    await redis.hSet(relayPlayersKey(postId), { [p.userId]: JSON.stringify(p) });
    await redis.expire(relayPlayersKey(postId), RELAY_TTL_SECONDS);
  },

  /** Who is here right now, in rotation order (arrival), fallen players excluded. */
  async present(
    postId: string,
    players: Map<string, RelayPlayer>,
    now: number
  ): Promise<RelayPlayer[]> {
    const key = relayLobbyKey(postId);
    // Everyone whose last heartbeat is recent. Older members are trimmed as a side effect of the
    // read only by the heartbeat, which is a write path anyway.
    const rows = await redis.zRange(key, now - PRESENT_MS, now + 60_000, { by: 'score' });
    const out: RelayPlayer[] = [];
    for (const row of rows ?? []) {
      const p = players.get(row.member);
      if (p && !p.out) out.push(p);
    }
    return out.sort((a, b) => a.joinedAt - b.joinedAt || a.userId.localeCompare(b.userId));
  },

  /**
   * Settle whose turn it is.
   *
   * Expires a turn whose holder left or ran out of time and hands the next one out in arrival
   * order, continuing from wherever the rotation last stopped. Returns whether anything changed.
   */
  advance(state: RelayStored, present: RelayPlayer[], now: number): boolean {
    let changed = false;
    if (state.turn) {
      const holderHere = present.some((p) => p.userId === state.turn!.userId);
      if (!holderHere || now >= state.turn.endsAt) {
        state.turn = null;
        changed = true;
      }
    }
    if (!state.turn && present.length > 0 && !state.closed) {
      const next = present.find((p) => p.joinedAt > state.cursor) ?? present[0]!;
      const startedAt = now;
      state.turn = {
        userId: next.userId,
        username: next.username,
        index: state.blocks.length,
        startedAt,
        endsAt: startedAt + TURN_MS,
      };
      state.cursor = next.joinedAt;
      changed = true;
    }
    if (changed) state.version += 1;
    return changed;
  },

  /** The view a client gets: the rotation from the current holder, plus the caller's own row. */
  view(
    state: RelayStored,
    present: RelayPlayer[],
    me: RelayPlayer | null,
    now: number
  ): RelayState {
    let order = present;
    if (state.turn) {
      const i = present.findIndex((p) => p.userId === state.turn!.userId);
      if (i > 0) order = [...present.slice(i), ...present.slice(0, i)];
    }
    return {
      postId: state.postId,
      day: state.day,
      blocks: state.blocks,
      colors: state.colors ?? state.blocks.map(() => null),
      turn: state.turn,
      lobby: order.slice(0, MAX_LOBBY),
      builders: state.builders,
      fallen: state.fallen,
      now,
      closed: state.closed,
      events: state.events,
      me: me ?? null,
      version: state.version,
    };
  },

  /** Read-only state for a viewer. */
  async state(postId: string, userId: string | null): Promise<RelayState | null> {
    const now = Date.now();
    const stored = await this.read(postId);
    if (!stored) return null;
    const players = await this.players(postId);
    const present = await this.present(postId, players, now);
    return this.view(stored, present, userId ? (players.get(userId) ?? null) : null, now);
  },

  /**
   * I am here.
   *
   * Registers presence, joins the lobby on first sight, and settles the turn. This is the write
   * path that keeps the rotation moving, which is why every open client sends one every few
   * seconds whether or not anything happened.
   */
  async heartbeat(
    postId: string,
    user: { userId: string; username: string }
  ): Promise<RelayState | null> {
    const now = Date.now();
    const stored = await this.read(postId);
    if (!stored) return null;

    const players = await this.players(postId);
    let me = players.get(user.userId) ?? null;
    if (!me) {
      me = {
        userId: user.userId,
        username: user.username,
        faction: await Users.faction(user.userId),
        snoovatar: await this.snoovatarOf(),
        joinedAt: now,
        blocks: 0,
        perfects: 0,
      };
      players.set(me.userId, me);
      await this.savePlayer(postId, me);
    }

    const lobby = relayLobbyKey(postId);
    await redis.zAdd(lobby, { member: user.userId, score: now });
    await redis.zRemRangeByScore(lobby, 0, now - PRESENT_MS * 3);
    await redis.expire(lobby, RELAY_TTL_SECONDS);

    const present = await this.present(postId, players, now);
    if (this.advance(stored, present, now)) {
      await this.write(stored);
      await push(postId, { kind: 'relay', version: stored.version, turn: stored.turn });
    }
    return this.view(stored, present, me, now);
  },

  async snoovatarOf(): Promise<string | null> {
    try {
      const user = await reddit.getCurrentUser();
      const url = await user?.getSnoovatarUrl();
      return typeof url === 'string' && url.length > 0 ? url : null;
    } catch {
      return null;
    }
  },

  /**
   * One tap on the shared tower.
   *
   * The tick is the client's own count from the start of its sweep, replayed here against the
   * same standing blocks. `index` is which block the client thought it was placing; if the
   * tower has moved on since, the tap was aimed at a tower that no longer exists and is refused
   * rather than applied to the wrong top.
   */
  async drop(
    postId: string,
    user: { userId: string; username: string },
    tick: number,
    index: number
  ): Promise<
    | { ok: true; result: 'landed' | 'perfect' | 'fell'; state: RelayState }
    | { ok: false; reason: string; state?: RelayState }
  > {
    const now = Date.now();
    const key = relayStateKey(postId);
    const tx = await redis.watch(key);
    const stored = await this.read(postId);
    if (!stored) {
      await tx.unwatch();
      return { ok: false, reason: 'No tower here.' };
    }
    const players = await this.players(postId);
    const present = await this.present(postId, players, now);
    const me = players.get(user.userId);

    if (stored.closed) {
      await tx.unwatch();
      return { ok: false, reason: "This tower is finished. Find today's post." };
    }
    if (!me || me.out) {
      await tx.unwatch();
      return { ok: false, reason: 'You are out for today.' };
    }

    // Settle an expired turn first, so a tap after a forfeit is judged against the new turn.
    if (stored.turn && now >= stored.turn.endsAt + LATE_MS) this.advance(stored, present, now);

    const turn = stored.turn;
    if (!turn || turn.userId !== user.userId) {
      await tx.unwatch();
      return { ok: false, reason: 'Not your turn.', state: this.view(stored, present, me, now) };
    }
    if (turn.index !== index || index !== stored.blocks.length) {
      await tx.unwatch();
      return {
        ok: false,
        reason: 'The tower grew. Aim again.',
        state: this.view(stored, present, me, now),
      };
    }
    if (now < turn.startedAt - LATE_MS) {
      await tx.unwatch();
      return { ok: false, reason: 'Not yet.' };
    }

    const replayed = replayTurn(stored.blocks, tick, 'relay');
    if (!replayed) {
      await tx.unwatch();
      return { ok: false, reason: 'That tap did not read.' };
    }

    let result: 'landed' | 'perfect' | 'fell';
    let landed: Block | undefined;
    let healed = false;
    if (replayed.isGameOver) {
      result = 'fell';
      me.out = { block: stored.blocks.length, at: now };
      stored.fallen += 1;
      stored.blocks = healedTop(stored.blocks);
      healed = true;
      stored.events.push({
        at: now,
        kind: 'fell',
        username: me.username,
        block: stored.blocks.length,
      });
      stored.events.push({ at: now, kind: 'healed', username: '', block: stored.blocks.length });
    } else {
      landed = replayed.blocks[replayed.blocks.length - 1];
      const perfect = replayed.lastPlacement?.isPositionPerfect === true;
      result = perfect ? 'perfect' : 'landed';
      stored.blocks = [...replayed.blocks];
      stored.colors = [...(stored.colors ?? []), me.faction];
      if (me.blocks === 0) stored.builders += 1;
      me.blocks += 1;
      if (perfect) me.perfects += 1;
      stored.events.push({
        at: now,
        kind: result,
        username: me.username,
        block: stored.blocks.length,
      });
    }
    if (stored.events.length > MAX_EVENTS) stored.events = stored.events.slice(-MAX_EVENTS);

    // Hand out the next turn after a beat, so the landing is watched before the next sweep.
    stored.turn = null;
    stored.cursor = me.joinedAt;
    const nextPresent = me.out ? present.filter((p) => p.userId !== me.userId) : present;
    this.advance(stored, nextPresent, now + TURN_GRACE_MS);
    stored.version += 1;

    try {
      await tx.multi();
      await tx.set(key, JSON.stringify(stored), { expiration: ttl() });
      await tx.exec();
    } catch {
      return { ok: false, reason: 'The tower moved. Try again.' };
    }
    const check = await this.read(postId);
    if (!check || check.version !== stored.version) {
      return { ok: false, reason: 'The tower moved. Try again.' };
    }

    await this.savePlayer(postId, me);
    const event = stored.events[stored.events.length - (healed ? 2 : 1)];
    await push(postId, {
      kind: 'relay',
      version: stored.version,
      ...(event ? { event } : {}),
      ...(landed ? { block: landed, blockFaction: me.faction } : {}),
      turn: stored.turn,
      healed,
    });

    return { ok: true, result, state: this.view(stored, nextPresent, me, now) };
  },

  /**
   * Say in the thread that you fell. Once per player per day; the guard is the player and post.
   */
  async brag(
    postId: string,
    userId: string
  ): Promise<{ ok: true } | { ok: false; reason: string }> {
    const players = await this.players(postId);
    const me = players.get(userId);
    if (!me?.out) return { ok: false, reason: 'Nothing to post yet.' };
    const result = await SocialService.brag({
      sessionId: `relay:${postId}:${userId}`,
      kind: 'fell',
      score: 0,
      blocks: me.out.block,
      perfectStreak: 0,
      faction: me.faction,
    });
    return result.ok ? { ok: true } : { ok: false, reason: result.reason };
  },

  /**
   * Today's post, creating it if the day has turned.
   *
   * Idempotent: called by the daily scheduler and by the moderator menu, and safe to call
   * twice. Yesterday's tower is closed and given its final line as a comment.
   */
  async openToday(): Promise<{ postId: string; created: boolean }> {
    const now = Date.now();
    const today = dayOf(now);
    const currentId = await this.currentPostId();
    if (currentId) {
      const current = await this.read(currentId);
      if (current && current.day === today && !current.closed) {
        return { postId: currentId, created: false };
      }
      if (current && !current.closed) await this.close(current);
    }

    const { subredditName } = context;
    if (!subredditName) throw new Error('subredditName is required');
    const date = new Date(now);
    const title = `Relay tower, ${date.toLocaleDateString('en-GB', {
      weekday: 'long',
      day: 'numeric',
      month: 'long',
      timeZone: 'UTC',
    })}`;
    const post = await reddit.submitCustomPost({
      subredditName,
      title,
      entry: 'relay',
      postData: { kind: 'relay', day: today },
      textFallback: {
        text: 'One tower, everyone in the thread takes turns adding a block. Open the post to join the lobby.',
      },
    });
    const state = this.fresh(post.id, now);
    await this.write(state);
    await redis.set(RELAY_CURRENT, post.id);
    return { postId: post.id, created: true };
  },

  /** End a day's tower: no more turns, and a final line in its thread. */
  async close(state: RelayStored): Promise<void> {
    state.closed = true;
    state.turn = null;
    state.events.push({ at: Date.now(), kind: 'closed', username: '', block: state.blocks.length });
    state.version += 1;
    await this.write(state);
    await push(state.postId, { kind: 'relay', version: state.version, turn: null });
    try {
      await reddit.submitComment({
        id: state.postId as `t3_${string}`,
        text:
          `Final height: **${state.blocks.length.toLocaleString()} blocks**. ` +
          `${state.builders.toLocaleString()} builders, ${state.fallen.toLocaleString()} fell. ` +
          `A new tower starts in today's post.`,
        runAs: 'APP',
      });
    } catch {
      // The tower is closed either way.
    }
  },
};
