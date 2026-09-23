import type { Connect, Plugin } from 'vite';
import type {
  BragRecord,
  GridPlacement,
  PlayerGrid,
  PlayerRegion,
  RelayPlayer,
  RelayState,
  RelayTowerSummary,
  TowerMapEntry,
} from '../../shared/types/api';
import {
  cellToWorld,
  REGION_RADIUS,
  regionCenterCell,
  regionCoordForIndex,
  type RegionCoord,
} from '../../shared/types/worldGrid';
import { MAX_STACK_PER_CELL } from '../../shared/types/towerPlacement';
import { MAX_PLACEMENTS_PER_PLAYER } from '../../shared/constants/towers';
import { DEFAULT_CONFIG, type Block } from '../../shared/simulation/types';
import { replayRun, replayTurn } from '../../shared/simulation/runSimulation';
import { GameSimulation, RELAY_TUNING, RUN_TUNING } from '../../shared/simulation/gameSimulation';
import {
  defaultFactionFor,
  FACTION_IDS,
  isFactionId,
  type FactionId,
} from '../../shared/types/factions';
import {
  cellKey,
  cellKind,
  judgePlacement,
  landHoldsFrom,
  type KeepRecord,
} from '../../shared/types/territory';
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

/**
 * In-memory stand-in for the Devvit server, so the real client can be played in a browser.
 *
 * The point is to be able to *see* a change work. It deliberately reuses the *real* rules from
 * `shared/` -- cell kinds, reach, the bar, the stack cap, coordinate conversion, the relay turn
 * replay -- so behaviour here matches production. Only storage and identity are faked. If a
 * raise is legal in the harness it is legal on the server, and vice versa.
 *
 * What is NOT real: data lives in memory and resets when the dev server restarts, everyone is
 * the same fake user, Reddit itself is absent, and the relay lobby is populated by bots that
 * take their turns on a timer so the rotation can be watched.
 *
 * Open http://localhost:7474 for the map, http://localhost:7474/?relay for the relay post.
 */

type MockTower = TowerMapEntry;

interface MockPlayer {
  userId: string;
  username: string;
  regionIndex: number;
  faction: FactionId;
  chosen: boolean;
  placements: GridPlacement[];
}

/**
 * Enough neighbours to judge the grid as a map rather than as a handful of test objects.
 */
const SEEDED_PLAYERS = 40;

/**
 * The plot the local player is handed: the third ring out, where most real players are. At plot
 * zero, the middle of the world, a camera framed on the middle of the map and a camera framed on
 * the player's plot look the same, and the harness could not tell them apart.
 */
const MY_REGION = 21;

/** In-memory store. Reset by restarting the dev server. */
class MockStore {
  private towers = new Map<string, MockTower>();
  private players = new Map<string, MockPlayer>();
  private nextRegion = 0;
  private nextSession = 1;

  /** The person playing. Fixed, since there is no auth here. */
  readonly me = 'local-player';

  constructor() {
    this.seedNeighbours(1, MY_REGION);
    this.player(this.me, 'you');
    this.seedNeighbours(MY_REGION + 1, SEEDED_PLAYERS);
    this.seedMine();
    this.seedFrontier();
  }

  player(userId: string, username: string): MockPlayer {
    let p = this.players.get(userId);
    if (!p) {
      p = {
        userId,
        username,
        regionIndex: this.nextRegion++,
        faction: defaultFactionFor(userId),
        chosen: false,
        placements: [],
      };
      this.players.set(userId, p);
    }
    return p;
  }

  regionCoord(userId: string): RegionCoord {
    return regionCoordForIndex(this.player(userId, userId).regionIndex);
  }

  regionOf(userId: string): PlayerRegion {
    const region = this.regionCoord(userId);
    const center = regionCenterCell(region);
    return {
      rx: region.rx,
      rz: region.rz,
      centerX: center.x,
      centerZ: center.z,
      radius: REGION_RADIUS,
    };
  }

  keeps(): KeepRecord[] {
    const out: KeepRecord[] = [];
    for (const p of this.players.values()) {
      if (p.placements.length === 0 && p.userId !== this.me) continue;
      const region = regionCoordForIndex(p.regionIndex);
      const c = regionCenterCell(region);
      out.push({
        userId: p.userId,
        username: p.username,
        faction: p.faction,
        rx: region.rx,
        rz: region.rz,
        centerX: c.x,
        centerZ: c.z,
      });
    }
    return out;
  }

  addTower(userId: string, username: string, tower: Omit<MockTower, 'sessionId'>): string {
    const sessionId = `local_session_${this.nextSession++}`;
    this.towers.set(sessionId, { ...tower, sessionId, userId, username });
    return sessionId;
  }

  getTower(sessionId: string): MockTower | undefined {
    return this.towers.get(sessionId);
  }

  gridOf(userId: string): PlayerGrid {
    const p = this.player(userId, userId);
    return {
      userId: p.userId,
      username: p.username,
      placements: p.placements,
      updatedAt: Date.now(),
    };
  }

  /** Resolve one player's placements to positioned towers. Keeps stack; land does not. */
  resolve(userId: string): MockTower[] {
    const p = this.players.get(userId);
    if (!p) return [];
    const byCell = new Map<string, GridPlacement[]>();
    for (const placement of p.placements) {
      const key = `${placement.gridX},${placement.gridZ}`;
      const bucket = byCell.get(key);
      if (bucket) bucket.push(placement);
      else byCell.set(key, [placement]);
    }
    const baseBySession = new Map<string, number>();
    for (const bucket of byCell.values()) {
      bucket.sort((a, b) => a.stackIndex - b.stackIndex);
      let baseY = 0;
      for (const placement of bucket) {
        baseBySession.set(placement.sessionId, baseY);
        baseY += placement.height;
      }
    }
    const out: MockTower[] = [];
    for (const placement of p.placements) {
      const tower = this.towers.get(placement.sessionId);
      if (!tower) continue;
      const baseY = baseBySession.get(placement.sessionId) ?? 0;
      out.push({
        ...tower,
        gridX: placement.gridX,
        gridZ: placement.gridZ,
        worldX: cellToWorld(placement.gridX),
        worldZ: cellToWorld(placement.gridZ),
        ...(baseY > 0 ? { stackBaseY: baseY } : {}),
      });
    }
    return out;
  }

  board(): MockTower[] {
    return [...this.players.keys()].flatMap((userId) => this.resolve(userId));
  }

  /** The same judgement the server makes, then the same consequences. */
  raise(
    userId: string,
    sessionId: string,
    gridX: number,
    gridZ: number
  ):
    | {
        ok: true;
        kind: 'keep' | 'claim' | 'take';
        took?: { userId: string; username: string; score: number; faction: FactionId | null };
      }
    | { ok: false; message: string; bar?: number } {
    const p = this.player(userId, userId);
    const tower = this.towers.get(sessionId);
    if (!tower) return { ok: false, message: 'That run is gone.' };
    if (tower.userId !== userId) return { ok: false, message: 'Not your tower.' };
    if (p.placements.some((x) => x.sessionId === sessionId))
      return { ok: false, message: 'Already standing.' };

    const keepStacks = new Map<string, number>();
    for (const x of p.placements) {
      if ((x.kind ?? 'keep') !== 'keep') continue;
      const k = cellKey(x.gridX, x.gridZ);
      keepStacks.set(k, (keepStacks.get(k) ?? 0) + 1);
    }
    const board = this.board();
    const verdict = judgePlacement({
      x: gridX,
      z: gridZ,
      score: tower.score,
      userId,
      faction: p.faction,
      region: this.regionCoord(userId),
      holdings: { keeps: this.keeps(), land: landHoldsFrom(board) },
      keepStacks,
      maxStack: MAX_STACK_PER_CELL,
      standing: p.placements.length,
      maxStanding: MAX_PLACEMENTS_PER_PLAYER,
    });
    if (!verdict.ok)
      return { ok: false, message: verdict.reason, ...(verdict.bar ? { bar: verdict.bar } : {}) };

    let took:
      | { userId: string; username: string; score: number; faction: FactionId | null }
      | undefined;
    if (verdict.kind === 'take') {
      const loser = this.players.get(verdict.from.userId);
      if (loser)
        loser.placements = loser.placements.filter((x) => x.sessionId !== verdict.from.sessionId);
      took = {
        userId: verdict.from.userId,
        username: verdict.from.username,
        score: verdict.from.score,
        faction: verdict.from.faction,
      };
    }
    p.placements.push({
      sessionId,
      gridX,
      gridZ,
      stackIndex: verdict.kind === 'keep' ? verdict.stackOn : 0,
      height: measureHeight(tower.towerBlocks),
      placedAt: Date.now(),
      kind: verdict.kind === 'keep' ? 'keep' : 'land',
    });
    return { ok: true, kind: verdict.kind, ...(took ? { took } : {}) };
  }

  remove(userId: string, sessionId: string): boolean {
    const p = this.players.get(userId);
    if (!p) return false;
    const before = p.placements.length;
    p.placements = p.placements.filter((x) => x.sessionId !== sessionId);
    return p.placements.length !== before;
  }

  private seedTower(
    p: MockPlayer,
    score: number,
    blockCount: number,
    seed: number,
    perfects: number
  ): string {
    const blocks = generateTowerBlocks(blockCount, seed);
    return this.addTower(p.userId, p.username, {
      userId: p.userId,
      username: p.username,
      score,
      blockCount: blocks.length,
      perfectStreak: perfects,
      gameMode: 'rotating_block',
      timestamp: Date.now() - seed * 1000,
      towerBlocks: blocks,
      faction: p.faction,
    } as Omit<MockTower, 'sessionId'>);
  }

  /** Raise without judgement, for seeding: neighbours' towers on their keeps and land. */
  private plant(p: MockPlayer, sessionId: string, x: number, z: number): void {
    const tower = this.towers.get(sessionId)!;
    const kind = cellKind(x, z) === 'keep' ? 'keep' : 'land';
    const stack =
      kind === 'keep' ? p.placements.filter((q) => q.gridX === x && q.gridZ === z).length : 0;
    if (kind === 'keep' && stack >= MAX_STACK_PER_CELL) return;
    p.placements.push({
      sessionId,
      gridX: x,
      gridZ: z,
      stackIndex: stack,
      height: measureHeight(tower.towerBlocks),
      placedAt: Date.now(),
      kind,
    });
  }

  /** The local player's own towers: a keep with a spread of heights, and a little land. */
  private seedMine(): void {
    const p = this.player(this.me, 'you');
    const c = regionCenterCell(regionCoordForIndex(p.regionIndex));
    const cells: Array<[number, number]> = [
      [0, 0],
      [1, -1],
      [-1, 1],
      [0, 1],
      [2, 1],
      [-2, -1],
      [1, 2],
    ];
    cells.forEach(([dx, dz], i) => {
      const id = this.seedTower(p, 900 + i * 213, realisticBlockCount(101, i), 101_000 + i, i % 6);
      this.plant(p, id, c.x + dx, c.z + dz);
    });
  }

  private seedNeighbours(from: number, to: number): void {
    for (let i = from; i <= to; i++) {
      const userId = `neighbour-${i}`;
      const p = this.player(userId, `player${i}`);
      p.faction = FACTION_IDS[i % FACTION_IDS.length]!;
      const towerCount = 3 + (i % 9);
      const region = regionCoordForIndex(p.regionIndex);
      const c = regionCenterCell(region);
      for (let t = 0; t < towerCount; t++) {
        const id = this.seedTower(
          p,
          400 + i * 137 + t * 61,
          realisticBlockCount(i, t),
          i * 1000 + t,
          (i + t) % 5
        );
        // The first three in the keep (the third stacked on the second), the rest out on land.
        if (t < 3) {
          const dx = t === 2 ? 0 : (t % 3) - 1;
          const dz = (i % 3) - 1;
          this.plant(p, id, c.x + dx, c.z + dz);
        } else {
          const ring = [
            [2, 0],
            [-2, 1],
            [0, -3],
            [3, 2],
            [-3, -2],
            [1, 3],
          ][t - 3] ?? [2, 2];
          this.plant(p, id, c.x + ring[0]!, c.z + ring[1]!);
        }
      }
    }
  }

  /** A few holds on the local player's own land by a neighbour, so takes can be reviewed. */
  private seedFrontier(): void {
    const me = this.player(this.me, 'you');
    const rival = this.player('neighbour-2', 'player2');
    const c = regionCenterCell(regionCoordForIndex(me.regionIndex));
    const id = this.seedTower(rival, 640, 27, 77_001, 3);
    this.plant(rival, id, c.x + 3, c.z - 1);
    const id2 = this.seedTower(rival, 1290, 44, 77_002, 9);
    this.plant(rival, id2, c.x + 3, c.z + 1);
  }
}

// --- Relay -------------------------------------------------------------------------------

const BOT_NAMES = [
  'lattice_dan',
  'kv_nine',
  'orbit_wren',
  'ferro_jay',
  'spire_ok',
  'tallpoppy',
  'mod_rook',
  'quietplumb',
  'nightshift_k',
  'bricklayer9',
  'vantablock',
  'heft_and_hold',
];

/**
 * The relay, in memory, with bots.
 *
 * The same rules as the server, from shared/relay/rules.ts: seats, crews of RELAY.CREW_MAX, a
 * new tower when every crew is full, turns, heals and falls. Only storage is faked. Bots take
 * their seats on start, fill the first crew and spill into a second tower, take their turns a
 * few seconds in, and now and then miss, so a fall can be watched from the local player's seat.
 * A bot that falls is replaced by a fresh one a few seconds later.
 *
 * `GET /api/mock/relay?bots=N` seats N more bots (more towers appear as crews fill);
 * `?miss=1` makes the next bot drop a miss, for looking at a fall on purpose (`&tower=N` for the
 * next one on that tower); `?youmiss=1` makes the local player's next drop one.
 */
class MockRelayStore {
  meta: RelayMeta;
  towers = new Map<number, RelayTowerState>();
  players = new Map<string, RelayPlayer>();
  /** Per tower, who is seated and when they were last here. */
  crews = new Map<number, Map<string, number>>();
  private timer: ReturnType<typeof setInterval> | null = null;
  private serial = 0;
  private forceMiss = false;
  /** Which tower the forced miss is for; any tower when null. */
  private forceMissOn: number | null = null;
  /** The local player's next drop misses, for looking at your own fall on purpose. */
  forceMyMiss = false;
  /** When each bot's current turn should be taken. */
  private botPlan = new Map<string, number>();

  constructor() {
    const now = Date.now();
    this.meta = {
      postId: 't3_mockrelay',
      day: new Date(now).toISOString().slice(0, 10),
      towers: 0,
      closed: false,
      createdAt: now,
    };
    this.addTower(now);
    // A tower some way up already, so the scene is a tower and not a base block.
    const first = this.towers.get(1)!;
    for (let i = 0; i < 14; i++) this.growFree(first, FACTION_IDS[(i * 5) % 8]!);
    for (let i = 0; i < 8; i++) this.spawnBot(now - (8 - i) * 400);
    this.timer = setInterval(() => this.tick(), 350);
  }

  /** Lay a block on a tower directly, at the crossing: for seeding only. */
  private growFree(tower: RelayTowerState, faction: FactionId): void {
    const replayed = replayTurn(tower.blocks, crossingTick(tower.blocks), 'relay');
    if (!replayed || replayed.isGameOver) return;
    tower.blocks = [...replayed.blocks];
    tower.colors = [...tower.colors, faction];
    tower.builders += 1;
  }

  addTower(now: number): number {
    const n = this.meta.towers + 1;
    this.meta.towers = n;
    this.towers.set(n, freshTower(n, this.meta.day, now));
    this.crews.set(n, new Map());
    return n;
  }

  spawnBot(now: number): void {
    const i = this.serial++;
    const id = `bot-${i}`;
    this.players.set(id, {
      userId: id,
      username: `${BOT_NAMES[i % BOT_NAMES.length]}${i >= BOT_NAMES.length ? i : ''}`,
      faction: FACTION_IDS[(i * 3 + 1) % FACTION_IDS.length]!,
      snoovatar: null,
      joinedAt: now,
      tower: null,
      blocks: 0,
      perfects: 0,
    });
    this.join(id, null, now);
  }

  /** Seats still held on a tower, whether or not their holder is here this second. */
  held(n: number, now: number): number {
    let count = 0;
    for (const [id, at] of this.crews.get(n) ?? new Map<string, number>()) {
      const p = this.players.get(id);
      if (p && !p.out && p.tower === n && at > now - RELAY.SEAT_HOLD_MS) count += 1;
    }
    return count;
  }

  /** Here, seated on the tower, not out, in seat order. */
  crew(n: number, now: number): RelayPlayer[] {
    const seen = this.crews.get(n) ?? new Map<string, number>();
    const out: RelayPlayer[] = [];
    for (const [id, at] of seen) {
      const p = this.players.get(id);
      if (p && !p.out && p.tower === n && at > now - RELAY.PRESENT_MS) out.push(p);
    }
    return inSeatOrder(out);
  }

  summaries(now: number): RelayTowerSummary[] {
    return [...this.towers.values()].map((t) => summarize(t, this.crew(t.id, now).length));
  }

  settle(n: number, now: number): void {
    const tower = this.towers.get(n);
    if (!tower) return;
    const crew = this.crew(n, now);
    settleTurn(tower, crew, now, (userId) => {
      const p = this.players.get(userId);
      if (!p) return false;
      p.idle = (p.idle ?? 0) + 1;
      if (p.idle < RELAY.IDLE_LIMIT) return false;
      p.tower = null;
      p.idle = 0;
      this.crews.get(n)?.delete(userId);
      return true;
    });
  }

  pick(me: RelayPlayer | null, watching: number | null, now: number): number {
    const valid = (n: number | null | undefined): n is number =>
      typeof n === 'number' && this.towers.has(n);
    if (me && !me.out && valid(me.tower)) return me.tower;
    if (valid(watching)) return watching;
    if (me && valid(me.tower)) return me.tower;
    return featuredTower(this.summaries(now));
  }

  view(userId: string | null, watching: number | null, now: number): RelayState {
    const me = userId ? (this.players.get(userId) ?? null) : null;
    const n = this.pick(me, watching, now);
    const tower = this.towers.get(n)!;
    return viewOf({
      postId: this.meta.postId,
      day: this.meta.day,
      tower,
      crew: this.crew(n, now),
      me,
      towers: this.summaries(now),
      now,
      closed: this.meta.closed,
    });
  }

  heartbeat(userId: string, username: string, watching: number | null): RelayState {
    const now = Date.now();
    let me = this.players.get(userId);
    if (!me) {
      me = {
        userId,
        username,
        faction: defaultFactionFor(userId),
        snoovatar: null,
        joinedAt: now,
        tower: null,
        blocks: 0,
        perfects: 0,
      };
      this.players.set(userId, me);
    }
    if (me.tower && !me.out) {
      const seats = this.crews.get(me.tower);
      const last = seats?.get(userId);
      // Away too long, as on the server: the seat went to somebody who was here.
      if (last === undefined || now - last > RELAY.SEAT_HOLD_MS) {
        me.tower = null;
        seats?.delete(userId);
      } else {
        seats?.set(userId, now);
      }
    }
    const n = this.pick(me, watching, now);
    this.settle(n, now);
    return this.view(userId, watching, now);
  }

  join(
    userId: string,
    watching: number | null,
    now: number
  ): { ok: true; started: boolean } | { ok: false; message: string } {
    const me = this.players.get(userId);
    if (!me) return { ok: false, message: 'Not here.' };
    if (me.out) return { ok: false, message: 'You are out for today.' };
    if (me.tower && this.crews.get(me.tower)?.has(userId)) return { ok: true, started: false };
    let n = chooseTower(
      [...this.towers.values()].map((t) => ({
        id: t.id,
        crew: this.held(t.id, now),
        height: t.blocks.length,
        closed: t.closed,
      })),
      watching
    );
    const started = n === null;
    if (n === null) n = this.addTower(now);
    me.tower = n;
    me.seatedAt = now;
    me.idle = 0;
    this.crews.get(n)!.set(userId, now);
    const tower = this.towers.get(n)!;
    tower.events = [
      ...tower.events,
      { at: now, kind: 'joined' as const, username: me.username, block: 0, faction: me.faction },
    ].slice(-RELAY.MAX_EVENTS);
    tower.version += 1;
    this.settle(n, now);
    return { ok: true, started };
  }

  drop(
    userId: string,
    tick: number,
    index: number
  ):
    | { ok: true; result: 'landed' | 'perfect' | 'fell'; state: RelayState }
    | { ok: false; message: string; state?: RelayState } {
    const now = Date.now();
    const me = this.players.get(userId);
    if (!me || !me.tower) return { ok: false, message: 'Take a seat first.' };
    const n = me.tower;
    const tower = this.towers.get(n)!;
    if (!userId.startsWith('bot-') && this.forceMyMiss) {
      this.forceMyMiss = false;
      tick = farTick(tower.blocks);
    }
    const outcome = applyDrop(tower, me, tick, index, now);
    if (!outcome.ok) {
      return {
        ok: false,
        message: outcome.reason,
        ...(outcome.stale ? { state: this.view(userId, null, now) } : {}),
      };
    }
    if (me.out) this.crews.get(n)?.delete(userId);
    settleTurn(tower, this.crew(n, now), now + RELAY.TURN_GRACE_MS);
    console.log(
      `[mock:relay] ${me.username} ${outcome.result} on tower ${n} at ${tower.blocks.length}`
    );
    if (me.out && userId.startsWith('bot-')) {
      setTimeout(() => this.spawnBot(Date.now()), 4000 + Math.random() * 3000);
    }
    return { ok: true, result: outcome.result, state: this.view(userId, null, now) };
  }

  control(query: URLSearchParams): void {
    const now = Date.now();
    const bots = Number(query.get('bots'));
    if (Number.isInteger(bots) && bots > 0) {
      for (let i = 0; i < Math.min(60, bots); i++) this.spawnBot(now);
    }
    if (query.get('miss') === '1') {
      this.forceMiss = true;
      const on = Number(query.get('tower'));
      this.forceMissOn = Number.isInteger(on) && on > 0 ? on : null;
    }
    if (query.get('youmiss') === '1') this.forceMyMiss = true;
  }

  /** Bots stay present, and take their turn a couple of seconds in. */
  private tick(): void {
    const now = Date.now();
    for (const [n, seen] of this.crews) {
      for (const id of seen.keys()) if (id.startsWith('bot-')) seen.set(id, now);
      this.settle(n, now);
      const tower = this.towers.get(n)!;
      const turn = tower.turn;
      if (!turn || !turn.userId.startsWith('bot-')) continue;
      const planKey = `${turn.userId}:${turn.startedAt}`;
      let at = this.botPlan.get(planKey);
      if (at === undefined) {
        at = turn.startedAt + 1500 + Math.random() * 2500;
        this.botPlan.set(planKey, at);
      }
      if (now < at) continue;
      this.botPlan.delete(planKey);
      const forced = this.forceMiss && (this.forceMissOn === null || this.forceMissOn === n);
      const miss = forced || Math.random() < 0.1;
      if (forced) this.forceMiss = false;
      const tickAt = miss
        ? farTick(tower.blocks)
        : crossingTick(tower.blocks) + Math.round((Math.random() - 0.5) * 10);
      this.drop(turn.userId, Math.max(1, tickAt), turn.index);
    }
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
  }
}

type SweepSim = GameSimulation & {
  setSlideSpeedMultiplier(m: number): void;
  setSlideBounds(b: number): void;
  setInstantPlaceMain(v: boolean): void;
};

/** How far off the tower the sweep has the block at each of its first ticks. */
const sweepOffsets = (blocks: Block[]): number[] => {
  const sim = new GameSimulation(0, 'relay') as SweepSim;
  sim.setSlideSpeedMultiplier(RELAY_TUNING.BASE_SPEED);
  sim.setSlideBounds(RUN_TUNING.DEFAULT_SLIDE_BOUNDS);
  sim.setInstantPlaceMain(true);
  let state = sim.createStateFromBlocks(blocks);
  const axis = blocks.length % 2 === 0 ? 'x' : 'z';
  const top = blocks[blocks.length - 1]!;
  const centre = axis === 'x' ? top.x : (top.z ?? 0);
  const out: number[] = [];
  for (let t = 1; t < 400; t++) {
    state = sim.stepSimulation(state);
    const cb = state.currentBlock!;
    out.push(Math.abs((axis === 'x' ? cb.x : (cb.z ?? 0)) - centre));
  }
  return out;
};

/** The tick at which the moving block first crosses the centre. */
const crossingTick = (blocks: Block[]): number => {
  const offsets = sweepOffsets(blocks);
  let best = 0;
  offsets.forEach((o, i) => {
    if (o < offsets[best]!) best = i;
  });
  return best + 2;
};

/** A tick at which the block is as far off the tower as the sweep takes it: a sure miss. */
const farTick = (blocks: Block[]): number => {
  const offsets = sweepOffsets(blocks);
  let worst = 0;
  offsets.forEach((o, i) => {
    if (o > offsets[worst]!) worst = i;
  });
  return worst + 2;
};

/** Same rule as the server: vertical extent from the geometry, in fixed-point units. */
const measureHeight = (blocks: readonly { y?: number; height?: number }[] | undefined): number => {
  if (!Array.isArray(blocks) || blocks.length === 0) return 0;
  let top = 0;
  for (const b of blocks) {
    const t = (b?.y ?? 0) + (b?.height ?? 0);
    if (Number.isFinite(t) && t > top) top = t;
  }
  return top;
};

/**
 * Block counts with the shape real play produces: mostly modest towers, a long tail of tall ones.
 */
const realisticBlockCount = (player: number, tower: number): number => {
  const roll = (player * 7919 + tower * 104_729) % 100;
  if (roll < 55) return 20 + ((player * 13 + tower * 29) % 90);
  if (roll < 85) return 120 + ((player * 17 + tower * 31) % 180);
  if (roll < 97) return 300 + ((player * 23 + tower * 37) % 320);
  return 700 + ((player * 41 + tower * 53) % 320);
};

/** Deterministic unit float from a couple of integers. */
const noise = (a: number, b: number): number => {
  let h = 2166136261 ^ a;
  h = Math.imul(h, 16777619) ^ b;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
};

/**
 * Tower geometry the way the simulation actually builds it, in its fixed-point units.
 */
const generateTowerBlocks = (count: number, seed: number) => {
  const H = DEFAULT_CONFIG.BLOCK_HEIGHT;
  const minExtent = DEFAULT_CONFIG.MIN_WIDTH_THRESHOLD;
  let width = DEFAULT_CONFIG.TOWER_WIDTH * 2;
  let depth = width;
  let x = 0;
  let z = 0;
  const skill = Math.min(0.97, 0.6 + count / 1400);

  const blocks = [{ x: 0, y: 0, z: 0, width, depth, height: H, rotation: 0 }];
  for (let i = 1; i < count; i++) {
    const axis = (i - 1) % 2 === 0 ? 'x' : 'z';
    const extent = axis === 'x' ? width : depth;
    if (noise(seed, i) > skill) {
      const miss = (noise(seed * 31 + 7, i) - 0.5) * extent * 0.3;
      const trimmed = Math.max(minExtent, Math.round(extent - Math.abs(miss)));
      const shift = Math.round(miss / 2);
      if (axis === 'x') {
        width = trimmed;
        x += shift;
      } else {
        depth = trimmed;
        z += shift;
      }
    }
    blocks.push({ x, y: i * H, z, width, depth, height: H, rotation: 0 });
  }
  return blocks;
};

const readJson = async (req: Connect.IncomingMessage): Promise<any> => {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  if (chunks.length === 0) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    return {};
  }
};

/**
 * Vite plugin serving the endpoints the client calls.
 */
export const mockApiPlugin = (): Plugin => {
  /** Seeded so the chatter strip has something to show on a cold harness. */
  const feed: BragRecord[] = [
    {
      username: 'lattice_dan',
      faction: 'jade',
      score: 3180,
      blocks: 41,
      perfectStreak: 12,
      kind: 'best',
      commentId: 't1_seed1',
      permalink: null,
      timestamp: Date.now() - 1000 * 60 * 7,
    },
    {
      username: 'kv_nine',
      faction: 'rose',
      score: 2440,
      blocks: 33,
      perfectStreak: 6,
      kind: 'took',
      passedUsername: 'lattice_dan',
      cell: { x: 5, z: -2 },
      commentId: 't1_seed2',
      permalink: null,
      timestamp: Date.now() - 1000 * 60 * 26,
    },
    {
      username: 'orbit_wren',
      faction: 'cobalt',
      score: 1905,
      blocks: 28,
      perfectStreak: 4,
      kind: 'claimed',
      cell: { x: -11, z: 6 },
      commentId: 't1_seed3',
      permalink: null,
      timestamp: Date.now() - 1000 * 60 * 63,
    },
  ];
  const bragged = new Set<string>();
  /** Whether the harness shows today's map or a closed one; flipped by /api/mock/map. */
  let mapLive = true;
  const today = new Date().toISOString().slice(0, 10);
  const yesterday = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);

  return {
    name: 'stonefall-mock-api',
    configureServer(server) {
      // Built here, not when the plugin is created. The plugin is created whenever the config is
      // loaded, `vite build` included, and the relay's bots run on a timer: created there, it
      // kept every build process alive after the build had finished, so `npm run build` -- and
      // `npm run deploy` behind it -- never returned.
      const store = new MockStore();
      const relay = new MockRelayStore();
      server.httpServer?.on('close', () => relay.stop());
      server.middlewares.use(async (req, res, next) => {
        const url = req.url ?? '';
        if (!url.startsWith('/api/')) return next();

        const send = (body: unknown, status = 200) => {
          res.statusCode = status;
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify(body));
        };

        const path = url.split('?')[0] ?? '';
        const query = new URLSearchParams(url.split('?')[1] ?? '');
        const me = store.player(store.me, 'you');

        try {
          if (path === '/api/log') {
            const { logs } = await readJson(req);
            for (const log of logs ?? [])
              console.log(`[client:${log.level ?? 'log'}] ${log.message}`);
            return send({ success: true });
          }

          if (path === '/api/board') {
            const towers = store.board();
            return send({
              type: 'board',
              towers,
              keeps: store.keeps(),
              totalCount: towers.length,
              map: {
                day: mapLive ? today : yesterday,
                live: mapLive,
                todayPostId: 't3_mockmap',
              },
            });
          }

          // Harness controls, for looking at states on purpose.
          if (path === '/api/mock/map') {
            mapLive = query.get('live') !== '0';
            console.log(`[mock] Map is ${mapLive ? 'live' : 'closed'}`);
            return send({ ok: true, live: mapLive });
          }
          if (path === '/api/mock/relay') {
            relay.control(query);
            return send({ ok: true, towers: relay.meta.towers });
          }

          if (path === '/api/me') {
            return send({
              type: 'me',
              userId: me.userId,
              username: me.username,
              grid: store.gridOf(store.me),
              region: store.regionOf(store.me),
              faction: me.faction,
              chosen: me.chosen,
            });
          }

          if (path === '/api/enter') {
            return send({
              type: 'enter',
              success: true,
              region: store.regionOf(store.me),
              faction: me.faction,
            });
          }

          if (path === '/api/me/faction') {
            const { faction } = await readJson(req);
            if (!isFactionId(faction))
              return send({ type: 'faction', success: false, message: 'Not a colour.' }, 400);
            const changed = me.faction !== faction;
            me.faction = faction;
            me.chosen = true;
            // Changing sides costs everything standing, as on the server.
            const razed = changed ? me.placements.map((p) => p.sessionId) : [];
            if (changed) me.placements = [];
            console.log(`[mock] Faction: ${faction}, razed ${razed.length}`);
            return send({ type: 'faction', success: true, faction, razed });
          }

          if (path === '/api/grid/raise') {
            const { sessionId, gridX, gridZ } = await readJson(req);
            const result = store.raise(store.me, sessionId, Number(gridX), Number(gridZ));
            if (!result.ok) {
              console.log(`[mock] Raise refused at ${gridX},${gridZ}: ${result.message}`);
              return send(
                {
                  type: 'place_tower',
                  success: false,
                  message: result.message,
                  ...(result.bar ? { bar: result.bar } : {}),
                },
                409
              );
            }
            console.log(
              `[mock] Raised ${sessionId} at ${gridX},${gridZ}: ${result.kind}${result.took ? ` from ${result.took.username}` : ''}`
            );
            return send({
              type: 'place_tower',
              success: true,
              grid: store.gridOf(store.me),
              kind: result.kind,
              ...(result.took ? { took: result.took } : {}),
            });
          }

          if (path === '/api/grid/remove') {
            const { sessionId } = await readJson(req);
            const removed = store.remove(store.me, sessionId);
            return send(
              {
                type: 'remove_placement',
                success: removed,
                ...(removed
                  ? { grid: store.gridOf(store.me) }
                  : { message: 'That tower is not yours.' }),
              },
              removed ? 200 : 400
            );
          }

          // Runs are replayed here exactly as the server replays them.
          if (path === '/api/game/save-run') {
            const body = await readJson(req);
            const inputs: Array<{ tick: number }> = Array.isArray(body?.inputs) ? body.inputs : [];
            if (!inputs.length)
              return send({ type: 'save_run', success: false, message: 'No inputs' }, 400);
            const state = replayRun(Number(body.seed), 'rotating_block', inputs);
            if (!state)
              return send(
                { type: 'save_run', success: false, message: 'Replay produced nothing' },
                400
              );
            const towerBlocks = state.blocks.map((b) => ({
              x: b.x,
              y: b.y,
              z: b.z ?? 0,
              width: b.width,
              depth: b.depth ?? b.width,
              height: b.height,
              rotation: b.rotation ?? 0,
            }));
            const sessionId = store.addTower(store.me, 'you', {
              userId: store.me,
              username: 'you',
              score: state.score,
              blockCount: state.blocks.length,
              perfectStreak: state.perfectBlockCount ?? 0,
              gameMode: 'rotating_block',
              timestamp: Date.now(),
              towerBlocks,
              faction: me.faction,
            } as Omit<MockTower, 'sessionId'>);
            console.log(
              `[mock] Replayed run: ${inputs.length} taps -> ${state.score} pts, ${state.blocks.length} blocks -> ${sessionId}`
            );
            return send({
              type: 'save_run',
              success: true,
              sessionId,
              score: state.score,
              blockCount: state.blocks.length,
              perfectCount: state.perfectBlockCount ?? 0,
              maxCombo: state.maxCombo ?? 0,
              towerBlocks,
              isPersonalBest: true,
              faction: me.faction,
            });
          }

          if (path.startsWith('/api/telemetry/')) {
            const body = await readJson(req).catch(() => ({}));
            const event = path.replace('/api/telemetry/journey/', '');
            console.log(`[mock:journey] ${event}`, JSON.stringify(body));
            const receipt = { status: 'JOURNEY_RECEIPT_VALID', message: 'mock' };
            return send(event === 'start' ? { journeyId: 'mock-journey', receipt } : { receipt });
          }

          if (path === '/api/social/brag') {
            const body = await readJson(req);
            if (bragged.has(body.sessionId))
              return send(
                { type: 'brag', success: false, message: 'Already posted this one' },
                409
              );
            bragged.add(body.sessionId);
            const tower = store.getTower(body.sessionId);
            const record: BragRecord = {
              username: 'you',
              faction: me.faction,
              score: tower?.score ?? 0,
              blocks: tower?.blockCount ?? 0,
              perfectStreak: tower?.perfectStreak ?? 0,
              kind: body.kind ?? 'plain',
              commentId: `t1_mock${bragged.size}`,
              permalink: null,
              timestamp: Date.now(),
              ...(body.passedUsername ? { passedUsername: body.passedUsername } : {}),
              ...(body.cell ? { cell: body.cell } : {}),
            };
            feed.unshift(record);
            feed.length = Math.min(feed.length, 40);
            console.log(`[mock] Brag: ${record.score} pts (${record.kind})`);
            return send({ type: 'brag', success: true, record });
          }

          if (path === '/api/social/feed') return send({ type: 'feed', brags: feed.slice(0, 12) });

          // Relay.
          const watching = (raw: unknown): number | null => {
            const n = Number(raw);
            return Number.isInteger(n) && n >= 1 ? n : null;
          };
          if (path === '/api/relay/today')
            return send({ type: 'relay_today', postId: relay.meta.postId });
          if (path === '/api/map/today' || path === '/api/map/latest')
            return send({ type: 'map_today', postId: 't3_mockmap' });
          if (path === '/api/relay/state')
            return send({
              type: 'relay',
              state: relay.view(store.me, watching(query.get('tower')), Date.now()),
            });
          if (path === '/api/relay/heartbeat') {
            const body = await readJson(req);
            return send({
              type: 'relay',
              state: relay.heartbeat(store.me, 'you', watching(body?.tower)),
            });
          }
          if (path === '/api/relay/join') {
            const body = await readJson(req);
            const now = Date.now();
            const result = relay.join(store.me, watching(body?.tower), now);
            const state = relay.view(store.me, null, now);
            if (!result.ok)
              return send(
                { type: 'relay_join', success: false, message: result.message, state },
                409
              );
            console.log(
              `[mock:relay] you ${result.started ? 'started' : 'joined'} tower ${state.tower}`
            );
            return send({ type: 'relay_join', success: true, started: result.started, state });
          }
          if (path === '/api/relay/brag') {
            const p = relay.players.get(store.me);
            if (!p?.out)
              return send(
                { type: 'relay_brag', success: false, message: 'Nothing to post yet.' },
                409
              );
            console.log(`[mock] Relay brag: fell at ${p.out.block}`);
            return send({ type: 'relay_brag', success: true });
          }
          if (path === '/api/relay/drop') {
            const { tick, index } = await readJson(req);
            const result = relay.drop(store.me, Number(tick), Number(index));
            if (!result.ok)
              return send(
                {
                  type: 'relay_drop',
                  success: false,
                  message: result.message,
                  ...(result.state ? { state: result.state } : {}),
                },
                409
              );
            return send({
              type: 'relay_drop',
              success: true,
              result: result.result,
              state: result.state,
            });
          }

          console.warn(`[mock] UNHANDLED ${req.method} ${path} -- returning 404`);
          return send({ status: 'error', message: `No mock for ${path}` }, 404);
        } catch (e) {
          console.error(`[mock] Error handling ${path}:`, e);
          return send({ status: 'error', message: 'Mock server error' }, 500);
        }
      });
    },
  };
};
