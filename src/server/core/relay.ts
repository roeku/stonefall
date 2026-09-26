import { context, realtime, reddit, redis } from '@devvit/web/server';
import type {
  RelayEvent,
  RelayPlayer,
  RelayPush,
  RelayState,
  RelayTowerSummary,
} from '../../shared/types/api';
import {
  RELAY,
  applyDrop,
  chooseTower,
  featuredTower,
  freshTower,
  inSeatOrder,
  settleTurn,
  summarize,
  viewOf,
  type RelayMeta,
  type RelayTowerState,
} from '../../shared/relay/rules';
import { SocialService } from './socialService';
import {
  RELAY_CURRENT,
  RELAY_TTL_SECONDS,
  relayCrewKey,
  relayLegacyStateKey,
  relayMetaKey,
  relayPlayersKey,
  relaySummaryKey,
  relayTowerCountKey,
  relayTowerKey,
} from './keys';
import { POST_STYLES, dayLabel, dayOf } from './maps';
import { Users } from './users';

/**
 * Relay: the shared daily towers.
 *
 * One post per day, holding as many towers as the day needs. An older relay post opens on its own
 * towers as they topped out (`shownFor`), and every seat, turn and heartbeat is today's, whichever
 * relay post it came from (see `relayPost` in the server entry), so a post found days later still
 * seats people. A tower's crew is a handful of people taking turns: on your turn you get one
 * block and a few seconds of the ordinary sweep.
 * Land it and the tower is one taller for the crew. Miss it and you are out until tomorrow, the
 * block you dropped goes over the edge for everyone to watch, and the top heals to full width
 * so the next person is not paying for your mistake. When every crew is full, the next person
 * to ask starts a new tower beside the others (see shared/relay/rules.ts for why).
 *
 * Every turn is verified the way a solo run is: the client sends the tick it tapped on, the
 * server rebuilds the same moving block from the same standing blocks and replays that one tap.
 *
 * Nobody is ever waited for. Turn timeouts are settled lazily, on whatever request comes next,
 * and heartbeats come every few seconds from everyone seated, so a forfeited turn passes within
 * a heartbeat of expiring. Every write to a tower is made under WATCH and stamped, so a
 * heartbeat settling a timeout can never overwrite the block somebody landed in the same
 * instant. Changes are pushed over realtime per tower; a client refetches when the push is
 * about the tower it is looking at and redraws a neighbour from the summary otherwise.
 */

const channelFor = (postId: string): string => `relay_${postId.replace(/[^a-zA-Z0-9_]/g, '')}`;

const ttl = (): Date => new Date(Date.now() + RELAY_TTL_SECONDS * 1000);

const parse = <T>(raw: string | null | undefined): T | null => {
  if (!raw) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
};

const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

const newRev = (): string => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;

const push = async (postId: string, msg: RelayPush): Promise<void> => {
  try {
    // Structurally JSON already; the parse is for the interface-versus-index-signature gap.
    await realtime.send(channelFor(postId), JSON.parse(JSON.stringify(msg)));
  } catch {
    // Realtime is a convenience; polling covers its absence.
  }
};

type Tx = Awaited<ReturnType<typeof redis.watch>>;

export type DropResult =
  | { ok: true; result: 'landed' | 'perfect' | 'fell'; state: RelayState }
  | { ok: false; reason: string; state?: RelayState };

export type JoinResult =
  | { ok: true; started: boolean; state: RelayState }
  | { ok: false; reason: string; state?: RelayState };

export const Relay = {
  channelFor,

  async currentPostId(): Promise<string | null> {
    return (await redis.get(RELAY_CURRENT)) ?? null;
  },

  /**
   * Which relay a relay post opens on: its own once its day has topped out, while its towers are
   * still stored, so an older post shows how its day ended; today's otherwise. What is played is
   * always today's.
   */
  async shownFor(postId: string): Promise<string> {
    const today = await this.currentPostId();
    if (!today || today === postId) return postId;
    return (await this.meta(postId))?.closed ? postId : today;
  },

  // --- Storage ------------------------------------------------------------------------------

  /**
   * The post's record, with its tower count. A post from before towers had crews has one
   * tower's state under the old key, and it becomes tower 1 the first time anyone asks.
   */
  async meta(postId: string): Promise<RelayMeta | null> {
    const stored = parse<RelayMeta>(await redis.get(relayMetaKey(postId)));
    if (stored) {
      const count = Number(await redis.get(relayTowerCountKey(postId)));
      return { ...stored, towers: Number.isInteger(count) && count > 0 ? count : 1 };
    }
    const legacy = parse<Partial<RelayTowerState> & { blocks: RelayTowerState['blocks'] }>(
      await redis.get(relayLegacyStateKey(postId))
    );
    if (!legacy || !Array.isArray(legacy.blocks)) return null;
    const now = Date.now();
    const tower: RelayTowerState = {
      id: 1,
      day: legacy.day ?? dayOf(now),
      blocks: legacy.blocks,
      colors: legacy.colors ?? legacy.blocks.map(() => null),
      turn: null,
      cursor: 0,
      builders: legacy.builders ?? 0,
      fallen: legacy.fallen ?? 0,
      closed: !!legacy.closed,
      events: legacy.events ?? [],
      version: (legacy.version ?? 1) + 1,
      createdAt: legacy.createdAt ?? now,
    };
    await redis.set(relayTowerKey(postId, 1), JSON.stringify(tower), {
      nx: true,
      expiration: ttl(),
    });
    const meta: RelayMeta = {
      postId,
      day: tower.day,
      towers: 1,
      closed: tower.closed,
      createdAt: tower.createdAt,
    };
    await this.writeMeta(meta);
    await redis.set(relayTowerCountKey(postId), '1', { nx: true, expiration: ttl() });
    await this.publish(postId, tower, 0);
    return meta;
  },

  async writeMeta(meta: RelayMeta): Promise<void> {
    await redis.set(relayMetaKey(meta.postId), JSON.stringify(meta), { expiration: ttl() });
  },

  async readTower(postId: string, n: number): Promise<RelayTowerState | null> {
    return parse<RelayTowerState>(await redis.get(relayTowerKey(postId, n)));
  },

  /**
   * Write a tower under the WATCH the caller holds. True when this write is the one that stuck:
   * the stamp is read back, because how a failed EXEC reports itself is the platform's business
   * and this has to be right either way.
   */
  async commit(postId: string, tx: Tx, tower: RelayTowerState): Promise<boolean> {
    tower.rev = newRev();
    try {
      await tx.multi();
      await tx.set(relayTowerKey(postId, tower.id), JSON.stringify(tower), { expiration: ttl() });
      await tx.exec();
    } catch {
      return false;
    }
    return (await this.readTower(postId, tower.id))?.rev === tower.rev;
  },

  /** Record a tower's summary and tell everyone in the post it changed. */
  async publish(
    postId: string,
    tower: RelayTowerState,
    crew: number,
    event?: RelayEvent
  ): Promise<RelayTowerSummary> {
    const summary = summarize(tower, crew);
    const key = relaySummaryKey(postId);
    await redis.hSet(key, { [String(tower.id)]: JSON.stringify(summary) });
    await redis.expire(key, RELAY_TTL_SECONDS);
    await push(postId, {
      kind: 'relay',
      tower: tower.id,
      version: tower.version,
      turn: tower.turn,
      summary,
      ...(event ? { event } : {}),
    });
    return summary;
  },

  async summaries(postId: string): Promise<RelayTowerSummary[]> {
    const all = (await redis.hGetAll(relaySummaryKey(postId))) ?? {};
    return Object.values(all)
      .map((raw) => parse<RelayTowerSummary>(raw))
      .filter((s): s is RelayTowerSummary => !!s && Number.isInteger(s.id))
      .sort((a, b) => a.id - b.id);
  },

  async player(postId: string, userId: string): Promise<RelayPlayer | null> {
    return parse<RelayPlayer>(await redis.hGet(relayPlayersKey(postId), userId));
  },

  async playersById(postId: string, ids: readonly string[]): Promise<RelayPlayer[]> {
    if (ids.length === 0) return [];
    const rows = await redis.hMGet(relayPlayersKey(postId), [...ids]);
    return (rows ?? []).map((raw) => parse<RelayPlayer>(raw)).filter((p): p is RelayPlayer => !!p);
  },

  async savePlayers(postId: string, players: readonly RelayPlayer[]): Promise<void> {
    if (players.length === 0) return;
    const key = relayPlayersKey(postId);
    await redis.hSet(key, Object.fromEntries(players.map((p) => [p.userId, JSON.stringify(p)])));
    await redis.expire(key, RELAY_TTL_SECONDS);
  },

  /** Who in a tower's crew has been here lately. Membership is kept to the seated and not out. */
  async presentIds(postId: string, n: number, now: number): Promise<string[]> {
    return this.seenSince(postId, n, now - RELAY.PRESENT_MS);
  },

  /**
   * Seats still held on a tower: here, or stepped away for less than SEAT_HOLD_MS. This, not
   * presence, is what counts against the crew limit, so somebody who looks away for a moment
   * comes back to a crew that did not fill up behind them.
   */
  async heldIds(postId: string, n: number, now: number): Promise<string[]> {
    return this.seenSince(postId, n, now - RELAY.SEAT_HOLD_MS);
  },

  async seenSince(postId: string, n: number, since: number): Promise<string[]> {
    const rows = await redis.zRange(relayCrewKey(postId, n), since, Date.now() + 60_000, {
      by: 'score',
    });
    return (rows ?? []).map((r) => r.member);
  },

  /** A tower's crew who are here, seated on it and not out, in seat order. */
  async crew(postId: string, n: number, now: number): Promise<RelayPlayer[]> {
    const players = await this.playersById(postId, await this.presentIds(postId, n, now));
    return inSeatOrder(players.filter((p) => p.tower === n && !p.out));
  },

  /** Which tower a viewer sees: their own seat, else the one they asked for, else the busiest. */
  pick(
    meta: RelayMeta,
    me: RelayPlayer | null,
    watching: number | null,
    summaries: readonly RelayTowerSummary[]
  ): number {
    const valid = (n: number | null | undefined): n is number =>
      typeof n === 'number' && Number.isInteger(n) && n >= 1 && n <= meta.towers;
    if (me && !me.out && valid(me.tower)) return me.tower;
    if (valid(watching)) return watching;
    if (me && valid(me.tower)) return me.tower;
    return featuredTower(
      summaries.map((s) => ({ id: s.id, crew: s.crew, height: s.height, closed: s.closed }))
    );
  },

  // --- Turns --------------------------------------------------------------------------------

  /**
   * Settle whose turn it is on one tower, under WATCH.
   *
   * Also notices when the crew itself changed -- someone sat down, stepped away, or came back --
   * and pushes that, so the seats on screen follow the people. `event` is written with it.
   */
  async settle(
    postId: string,
    n: number,
    now: number,
    event?: RelayEvent
  ): Promise<{ tower: RelayTowerState; crew: RelayPlayer[] } | null> {
    for (let attempt = 0; attempt < 3; attempt++) {
      const tx = await redis.watch(relayTowerKey(postId, n));
      const tower = await this.readTower(postId, n);
      if (!tower) {
        await tx.unwatch();
        return null;
      }
      const crew = await this.crew(postId, n, now);
      const touched: RelayPlayer[] = [];
      let changed = settleTurn(tower, crew, now, (userId) => {
        const p = crew.find((c) => c.userId === userId);
        if (!p) return false;
        p.idle = (p.idle ?? 0) + 1;
        touched.push(p);
        if (p.idle < RELAY.IDLE_LIMIT) return false;
        // Two turns in a row let run out: the seat goes to somebody who is playing.
        p.tower = null;
        p.idle = 0;
        return true;
      });
      const seatedNow = crew.filter((p) => p.tower === n);
      const seated = seatedNow.map((p) => p.userId).join(',');
      if (tower.seated !== seated) {
        tower.seated = seated;
        if (!changed) tower.version += 1;
        changed = true;
      }
      if (event) {
        tower.events = [...tower.events, event].slice(-RELAY.MAX_EVENTS);
        if (!changed) tower.version += 1;
        changed = true;
      }
      if (!changed) {
        await tx.unwatch();
        return { tower, crew: seatedNow };
      }
      if (!(await this.commit(postId, tx, tower))) continue;
      if (touched.length > 0) {
        await this.savePlayers(postId, touched);
        const benched = touched.filter((p) => p.tower !== n).map((p) => p.userId);
        if (benched.length > 0) await redis.zRem(relayCrewKey(postId, n), benched);
      }
      await this.publish(postId, tower, seatedNow.length, event);
      return { tower, crew: seatedNow };
    }
    // Lost three races in a row: somebody else is settling it. Show what they wrote.
    const tower = await this.readTower(postId, n);
    return tower ? { tower, crew: await this.crew(postId, n, now) } : null;
  },

  /** Read-only state for a viewer. */
  async state(
    postId: string,
    user: { userId: string; username: string } | null,
    watching: number | null
  ): Promise<RelayState | null> {
    const now = Date.now();
    const meta = await this.meta(postId);
    if (!meta) return null;
    const me = user
      ? ((await this.player(postId, user.userId)) ?? (await this.watcher(user, now)))
      : null;
    const summaries = await this.summaries(postId);
    const n = this.pick(meta, me, watching, summaries);
    const tower = await this.readTower(postId, n);
    if (!tower) return null;
    const crew = await this.crew(postId, n, now);
    return viewOf({
      postId,
      day: meta.day,
      tower,
      crew,
      me,
      towers: summaries,
      now,
      closed: meta.closed,
    });
  },

  /**
   * I am here.
   *
   * Keeps the player's seat warm if they hold one, and settles the turn on the tower they are
   * looking at. This is the write path that keeps rotations moving, which is why every open
   * client sends one every few seconds whether or not anything happened.
   * A seat left empty for longer than SEAT_HOLD_MS is given up: its holder watches until they
   * ask to build again.
   */
  async heartbeat(
    postId: string,
    user: { userId: string; username: string },
    watching: number | null
  ): Promise<RelayState | null> {
    const now = Date.now();
    const meta = await this.meta(postId);
    if (!meta) return null;

    let me = (await this.player(postId, user.userId)) ?? (await this.watcher(user, now));

    if (me.tower && !me.out && !meta.closed) {
      const key = relayCrewKey(postId, me.tower);
      const last = await redis.zScore(key, me.userId);
      if (last === undefined || now - last > RELAY.SEAT_HOLD_MS) {
        me.tower = null;
        me.idle = 0;
        await this.savePlayers(postId, [me]);
        if (last !== undefined) await redis.zRem(key, [me.userId]);
      } else {
        await redis.zAdd(key, { member: me.userId, score: now });
        await redis.zRemRangeByScore(key, 0, now - RELAY.SEAT_HOLD_MS);
        await redis.expire(key, RELAY_TTL_SECONDS);
      }
    }

    const summaries = await this.summaries(postId);
    const n = this.pick(meta, me, watching, summaries);
    const settled = meta.closed ? null : await this.settle(postId, n, now);
    const tower = settled?.tower ?? (await this.readTower(postId, n));
    if (!tower) return null;
    const crew = settled?.crew ?? (await this.crew(postId, n, now));
    // Settling may have cost this player their seat; their record is re-read if so.
    if (me.tower === n && !crew.some((p) => p.userId === me!.userId)) {
      me = (await this.player(postId, user.userId)) ?? me;
    }
    const fresh = summarize(tower, crew.length);
    return viewOf({
      postId,
      day: meta.day,
      tower,
      crew,
      me,
      towers: [...summaries.filter((s) => s.id !== n), fresh],
      now,
      closed: meta.closed,
    });
  },

  /**
   * Somebody watching who has never taken a seat, as the view shows them. Never stored: the post
   * sits in everyone's feed, so being here is not a choice to play. Taking a seat is, and `join`
   * is where a player's row, with their name and avatar, is first written.
   */
  async watcher(user: { userId: string; username: string }, now: number): Promise<RelayPlayer> {
    return {
      userId: user.userId,
      username: user.username,
      faction: await Users.faction(user.userId),
      snoovatar: null,
      joinedAt: now,
      tower: null,
      blocks: 0,
      perfects: 0,
    };
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

  /** A new tower beside the others. The counter is atomic, so two at once get two towers. */
  async addTower(postId: string, meta: RelayMeta, now: number): Promise<number> {
    const n = await redis.incrBy(relayTowerCountKey(postId), 1);
    await redis.expire(relayTowerCountKey(postId), RELAY_TTL_SECONDS);
    const tower = freshTower(n, meta.day, now);
    await redis.set(relayTowerKey(postId, n), JSON.stringify(tower), {
      nx: true,
      expiration: ttl(),
    });
    await this.publish(postId, tower, 0);
    return n;
  },

  /**
   * Take a seat.
   *
   * On the tower being watched if its crew has room, otherwise on the busiest crew that does,
   * otherwise on a new tower. Asking again while seated changes nothing.
   */
  async join(
    postId: string,
    user: { userId: string; username: string },
    watching: number | null
  ): Promise<JoinResult> {
    const now = Date.now();
    const meta = await this.meta(postId);
    if (!meta) return { ok: false, reason: 'No tower here.' };
    if (meta.closed) return { ok: false, reason: "This relay is finished. Find today's post." };

    const me: RelayPlayer = (await this.player(postId, user.userId)) ?? {
      userId: user.userId,
      username: user.username,
      faction: null,
      snoovatar: await this.snoovatarOf(),
      joinedAt: now,
      tower: null,
      blocks: 0,
      perfects: 0,
    };
    if (me.out) {
      return {
        ok: false,
        reason: 'You are out for today.',
        ...(await this.stateFor(postId, me, watching)),
      };
    }
    if (me.tower && (await redis.zScore(relayCrewKey(postId, me.tower), me.userId)) !== undefined) {
      const state = await this.state(postId, me, null);
      return state ? { ok: true, started: false, state } : { ok: false, reason: 'No tower here.' };
    }

    const summaries = await this.summaries(postId);
    const byId = new Map(summaries.map((s) => [s.id, s]));
    const choices = [];
    for (let id = 1; id <= meta.towers; id++) {
      choices.push({
        id,
        crew: (await this.heldIds(postId, id, now)).length,
        height: byId.get(id)?.height ?? 1,
        closed: byId.get(id)?.closed ?? false,
      });
    }
    let n = chooseTower(choices, watching);
    const started = n === null;
    if (n === null) n = await this.addTower(postId, meta, now);

    me.tower = n;
    me.seatedAt = now;
    me.idle = 0;
    me.username = user.username;
    // The colour they fly now, which is the colour their blocks will be laid in.
    me.faction = await Users.faction(user.userId);
    await this.savePlayers(postId, [me]);
    const key = relayCrewKey(postId, n);
    await redis.zAdd(key, { member: me.userId, score: now });
    await redis.expire(key, RELAY_TTL_SECONDS);

    const settled = await this.settle(postId, n, now, {
      at: now,
      kind: 'joined',
      username: me.username,
      block: 0,
      faction: me.faction,
    });
    if (!settled) return { ok: false, reason: 'No tower here.' };
    return {
      ok: true,
      started,
      state: viewOf({
        postId,
        day: meta.day,
        tower: settled.tower,
        crew: settled.crew,
        me,
        towers: [
          ...summaries.filter((s) => s.id !== n),
          summarize(settled.tower, settled.crew.length),
        ],
        now,
        closed: meta.closed,
      }),
    };
  },

  async stateFor(
    postId: string,
    me: RelayPlayer,
    watching: number | null
  ): Promise<{ state?: RelayState }> {
    const state = await this.state(postId, me, watching);
    return state ? { state } : {};
  },

  /**
   * One tap on the caller's tower.
   *
   * The tap is judged by `applyDrop`; the next turn is handed out after a beat, so the landing is
   * watched before the next sweep; and the whole thing is one stamped write under WATCH.
   */
  async drop(
    postId: string,
    user: { userId: string; username: string },
    tick: number,
    index: number
  ): Promise<DropResult> {
    const now = Date.now();
    const meta = await this.meta(postId);
    if (!meta) return { ok: false, reason: 'No tower here.' };
    if (meta.closed) return { ok: false, reason: "This relay is finished. Find today's post." };
    const base = await this.player(postId, user.userId);
    if (!base || !base.tower) return { ok: false, reason: 'Take a seat first.' };
    const n = base.tower;
    // Laid in the colour they fly now, not the one they joined under.
    base.faction = await Users.faction(user.userId);

    for (let attempt = 0; attempt < 2; attempt++) {
      const me = clone(base);
      const tx = await redis.watch(relayTowerKey(postId, n));
      const tower = await this.readTower(postId, n);
      if (!tower) {
        await tx.unwatch();
        return { ok: false, reason: 'No tower here.' };
      }
      const outcome = applyDrop(tower, me, tick, index, now);
      if (!outcome.ok) {
        await tx.unwatch();
        if (!outcome.stale) return { ok: false, reason: outcome.reason };
        const state = await this.state(postId, me, null);
        return { ok: false, reason: outcome.reason, ...(state ? { state } : {}) };
      }
      const crew = (await this.crew(postId, n, now))
        .map((p) => (p.userId === me.userId ? me : p))
        .filter((p) => !p.out);
      settleTurn(tower, crew, now + RELAY.TURN_GRACE_MS);
      tower.seated = crew.map((p) => p.userId).join(',');
      if (!(await this.commit(postId, tx, tower))) continue;

      await this.savePlayers(postId, [me]);
      if (me.out) await redis.zRem(relayCrewKey(postId, n), [me.userId]);
      const summary = await this.publish(postId, tower, crew.length, outcome.event);
      const summaries = await this.summaries(postId);
      return {
        ok: true,
        result: outcome.result,
        state: viewOf({
          postId,
          day: meta.day,
          tower,
          crew,
          me,
          towers: [...summaries.filter((s) => s.id !== n), summary],
          now,
          closed: meta.closed,
        }),
      };
    }
    return { ok: false, reason: 'The tower moved. Try again.' };
  },

  /**
   * Say in the thread that you fell. Once per player per day; the guard is the player and post.
   */
  async brag(
    postId: string,
    userId: string
  ): Promise<{ ok: true } | { ok: false; reason: string }> {
    const me = await this.player(postId, userId);
    if (!me?.out) return { ok: false, reason: 'Nothing to post yet.' };
    const result = await SocialService.brag(
      {
        sessionId: `relay:${postId}:${userId}`,
        kind: 'fell',
        score: 0,
        blocks: me.out.block,
        perfectStreak: 0,
        faction: me.faction,
      },
      // Today's relay thread, which is the relay every relay post plays.
      postId
    );
    return result.ok ? { ok: true } : { ok: false, reason: result.reason };
  },

  // --- Days ---------------------------------------------------------------------------------

  /**
   * Today's post, creating it if the day has turned.
   *
   * Idempotent: called by the daily job and by the moderator menu, and safe to call twice.
   * Yesterday's towers are closed and given their final line as a comment.
   */
  async openToday(): Promise<{ postId: string; created: boolean }> {
    const now = Date.now();
    const today = dayOf(now);
    const currentId = await this.currentPostId();
    if (currentId) {
      const current = await this.meta(currentId);
      if (current && current.day === today && !current.closed) {
        return { postId: currentId, created: false };
      }
      if (current && !current.closed) await this.close(current);
    }

    const { subredditName } = context;
    if (!subredditName) throw new Error('subredditName is required');
    const post = await reddit.submitCustomPost({
      subredditName,
      title: `Relay tower, ${dayLabel(today)}`,
      entry: 'relay',
      postData: { kind: 'relay', day: today },
      styles: POST_STYLES,
      textFallback: {
        text: 'Crews take turns adding one block each to shared towers. Open the post to take a seat.',
      },
    });
    const meta: RelayMeta = {
      postId: post.id,
      day: today,
      towers: 1,
      closed: false,
      createdAt: now,
    };
    await this.writeMeta(meta);
    await redis.set(relayTowerCountKey(post.id), '1', { expiration: ttl() });
    const tower = freshTower(1, today, now);
    await redis.set(relayTowerKey(post.id, 1), JSON.stringify(tower), { expiration: ttl() });
    await this.publish(post.id, tower, 0);
    await redis.set(RELAY_CURRENT, post.id);
    return { postId: post.id, created: true };
  },

  /** A deleted post stops being today's relay, so the moderator menu can open another. */
  async forgetPost(postId: string): Promise<void> {
    if ((await this.currentPostId()) === postId) await redis.del(RELAY_CURRENT);
  },

  /** Open a relay only if there is none at all: what an install or an upgrade does. */
  async ensureOpen(): Promise<{ postId: string; created: boolean }> {
    const currentId = await this.currentPostId();
    if (currentId && (await this.meta(currentId))) return { postId: currentId, created: false };
    return this.openToday();
  },

  /** End a day: no more turns on any tower, and a final line in the thread. */
  async close(meta: RelayMeta): Promise<void> {
    const now = Date.now();
    await this.writeMeta({ ...meta, closed: true });
    const heights: Array<{ id: number; height: number }> = [];
    let fallen = 0;
    for (let n = 1; n <= meta.towers; n++) {
      const tower = await this.readTower(meta.postId, n);
      if (!tower) continue;
      tower.closed = true;
      tower.turn = null;
      tower.events = [
        ...tower.events,
        { at: now, kind: 'closed' as const, username: '', block: tower.blocks.length },
      ].slice(-RELAY.MAX_EVENTS);
      tower.version += 1;
      await redis.set(relayTowerKey(meta.postId, n), JSON.stringify(tower), { expiration: ttl() });
      await this.publish(meta.postId, tower, 0);
      heights.push({ id: n, height: tower.blocks.length });
      fallen += tower.fallen;
    }
    const players = Object.values((await redis.hGetAll(relayPlayersKey(meta.postId))) ?? {})
      .map((raw) => parse<RelayPlayer>(raw))
      .filter((p): p is RelayPlayer => !!p);
    const builders = players.filter((p) => p.blocks > 0).length;
    const tally = `${builders.toLocaleString()} ${builders === 1 ? 'builder' : 'builders'}, ${fallen.toLocaleString()} fell.`;
    const one = heights.length <= 1;
    const final = one
      ? `Final height: **${(heights[0]?.height ?? 1).toLocaleString()} blocks**.`
      : `Final heights: ${[...heights]
          .sort((a, b) => b.height - a.height)
          .map((h) => `tower ${h.id} **${h.height.toLocaleString()}**`)
          .join(', ')}.`;
    const kept = one ? 'the tower as it ended' : 'the towers as they ended';
    const text = `${final} ${tally} This post keeps ${kept}; take a seat here to build today's.`;
    try {
      await reddit.submitComment({ id: meta.postId as `t3_${string}`, text, runAs: 'APP' });
    } catch {
      // The towers are closed either way.
    }
  },
};
