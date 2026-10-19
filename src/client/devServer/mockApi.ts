import {
  DEFAULT_STONE,
  STONES,
  isStoneId,
  isUnlocked,
  newlyUnlocked,
  stoneOf,
  type StoneId,
} from '../../shared/social/stones';
import type { Connect, Plugin } from 'vite';
import type {
  BragRecord,
  GridPlacement,
  PlayerGrid,
  PlayerRegion,
  RaiseKind,
  RelayPlayer,
  RelayState,
  RelayTap,
  RelayTowerSummary,
  TowerMapEntry,
  StoneNews,
} from '../../shared/types/api';
import {
  cellToWorld,
  REGION_PITCH,
  REGION_RADIUS,
  regionCenterCell,
  regionCoordForIndex,
  type RegionCoord,
} from '../../shared/types/worldGrid';
import { MAX_STACK_PER_CELL } from '../../shared/types/towerPlacement';
import { NOTE_MAX, commentToPost, type ScoreComment } from '../../shared/social/comments';
import { flairFor } from '../../shared/social/flair';
import {
  allDone,
  capstoneFor,
  countEvent,
  freshDay,
  levelOf,
  ordersCapstone,
  ordersNews,
  raiseXp,
  relayXp,
  xpAtLevel,
  type DayProgress,
  type ProgressEvent,
  type ProgressNews,
  type RaiseXpInput,
  type XpGain,
} from '../../shared/social/progress';
import { MAX_PLACEMENTS_PER_PLAYER } from '../../shared/constants/towers';
import { DEFAULT_CONFIG, type Block } from '../../shared/simulation/types';
import { createTurnSimulation, replayRun, replayTurn } from '../../shared/simulation/runSimulation';
import {
  LEGACY_RUN_PACE,
  RUN_PACE,
  paceOr,
  paceToReplay,
  type RunPace,
} from '../../shared/simulation/gameSimulation';
import { packTower } from '../../shared/types/packedBlocks';
import {
  defaultFactionFor,
  FACTION_IDS,
  isFactionId,
  type FactionId,
} from '../../shared/types/factions';
import {
  cellKey,
  KEEP_RADIUS,
  LEGACY_KEEP_RADIUS,
  LEGACY_RULES,
  RULES,
  cellKind,
  judgePlacement,
  landHoldsFrom,
  type KeepRecord,
  type MapRules,
  type PlacementVerdict,
} from '../../shared/types/territory';
import {
  RELAY,
  RELAY_RULES,
  applyDrop,
  featuredTower,
  freshTower,
  grantLives,
  inSeatOrder,
  livesToday,
  noteBestTurn,
  parseTaps,
  relayRulesOr,
  seatFor,
  settleTurn,
  shownTurnMs,
  summarize,
  towerIdFor,
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
  /** Their own plot, on a plots map. On a factions map they build from their colour's. */
  regionIndex: number;
  faction: FactionId;
  chosen: boolean;
  placements: GridPlacement[];
  /** The stone they build in (shared/social/stones.ts). */
  stone?: StoneId;
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

/**
 * How a seeded map differs from today's: the map an older post shows is another day's, with other
 * sides ahead, so the two can be told apart at a glance.
 */
interface MapSeed {
  /** Session ids are per map, so a tower on one day is never mistaken for one on another. */
  prefix: string;
  /** How many neighbours built. */
  players: number;
  /** Turns the colours and the heights, so another day has other standings. */
  shift: number;
  /** The keep size the map opened with. */
  keepRadius: number;
  /** Whose keeps the map opened with: a player's each, or a colour's. */
  rules: MapRules;
}

const TODAY_SEED: MapSeed = {
  prefix: 'local',
  players: SEEDED_PLAYERS,
  shift: 0,
  keepRadius: KEEP_RADIUS,
  rules: RULES,
};
/**
 * The day before, for the harness opened as an older post. Opened before the keep shrank and
 * before colours shared a keep, so the harness shows both: yesterday's plot each with a 3x3 keep,
 * and today's colours gathered round one-cell keeps of their own.
 */
const PAST_SEED: MapSeed = {
  prefix: 'past',
  players: 30,
  shift: 3,
  keepRadius: LEGACY_KEEP_RADIUS,
  rules: LEGACY_RULES,
};

/** In-memory store. Reset by restarting the dev server. */
class MockStore {
  private towers = new Map<string, MockTower>();
  private players = new Map<string, MockPlayer>();
  private nextRegion = 0;
  private nextSession = 1;
  /** Where each colour's keep is on a factions map: founded by the first of the colour seen. */
  private homes = new Map<FactionId, number>();
  /** Placement times, one apart, so a stack of everybody's towers has an order. */
  private clock = Date.now();
  /**
   * The local player's stones, as the server keeps them on the user record: two days in a row
   * so far and nothing posted, so today's first run earns Slate and the first comment Marble.
   */
  private progress = {
    streak: 2,
    bestStreak: 2,
    postedDays: 0,
    playedToday: false,
    postedToday: false,
  };

  /** The person playing. Fixed, since there is no auth here. */
  readonly me = 'local-player';

  get keepRadius(): number {
    return this.seed.keepRadius;
  }

  get rules(): MapRules {
    return this.seed.rules;
  }

  constructor(private readonly seed: MapSeed = TODAY_SEED) {
    if (seed.rules === 'factions') {
      this.seedColours();
      return;
    }
    this.seedNeighbours(1, MY_REGION);
    this.seedNeighbours(MY_REGION + 1, seed.players);
    this.seedMine();
    this.seedFrontier();
  }

  private stamp(): number {
    return ++this.clock;
  }

  player(userId: string, username: string): MockPlayer {
    let p = this.players.get(userId);
    if (!p) {
      p = {
        userId,
        username,
        regionIndex: this.rules === 'factions' ? -1 : this.nextRegion++,
        faction: defaultFactionFor(userId),
        chosen: false,
        placements: [],
      };
      this.players.set(userId, p);
    }
    return p;
  }

  /** Where a player builds from: their own plot, or on a factions map their colour's. */
  regionCoord(userId: string): RegionCoord {
    const p = this.player(userId, userId);
    return regionCoordForIndex(this.rules === 'factions' ? this.homeOf(p.faction) : p.regionIndex);
  }

  /** The region of a colour's keep, founded the first time anybody of the colour builds. */
  private homeOf(faction: FactionId): number {
    let index = this.homes.get(faction);
    if (index === undefined) {
      index = this.nextRegion++;
      this.homes.set(faction, index);
    }
    return index;
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
      const region = this.regionCoord(p.userId);
      const c = regionCenterCell(region);
      out.push({
        userId: p.userId,
        username: p.username,
        faction: p.faction,
        rx: region.rx,
        rz: region.rz,
        centerX: c.x,
        centerZ: c.z,
        ...(p.stone && p.stone !== 'neon' ? { stone: p.stone } : {}),
      });
    }
    return out;
  }

  /** The local player's stones, as the server reports them. */
  stoneNews(unlocked: StoneId[] = []): StoneNews {
    const p = this.progress;
    return {
      stone: this.player(this.me, 'you').stone ?? DEFAULT_STONE,
      unlocked,
      streak: p.streak,
      bestStreak: p.bestStreak,
      postedDays: p.postedDays,
      postedToday: p.postedToday,
    };
  }

  /** Apply a change to the local player's progress, wearing the newest stone it earned. */
  private advance(change: () => void): StoneNews {
    const before = { ...this.progress };
    change();
    const unlocked = newlyUnlocked(before, this.progress);
    const newest = unlocked[unlocked.length - 1];
    if (newest) this.player(this.me, 'you').stone = newest;
    return this.stoneNews(unlocked);
  }

  /** The local player's first run of the day: the streak goes from yesterday's 2 to 3. */
  played(): StoneNews {
    if (this.progress.playedToday) return this.stoneNews();
    return this.advance(() => {
      const p = this.progress;
      p.playedToday = true;
      p.streak += 1;
      p.bestStreak = Math.max(p.bestStreak, p.streak);
    });
  }

  /** The local player posted about a run: a day posted, once a day. */
  posted(): StoneNews {
    if (this.progress.postedToday) return this.stoneNews();
    return this.advance(() => {
      this.progress.postedToday = true;
      this.progress.postedDays += 1;
    });
  }

  /** What the local player's flair would say, from the same function the server uses. */
  flairText(): string {
    const me = this.player(this.me, 'you');
    return flairFor({
      faction: me.faction,
      stone: me.stone ?? DEFAULT_STONE,
      streak: this.progress.streak,
    }).text;
  }

  /** Wear an earned stone. */
  wear(stone: StoneId): boolean {
    if (!isUnlocked(stoneOf(stone), this.progress)) return false;
    this.player(this.me, 'you').stone = stone;
    return true;
  }

  /** Earn every stone and wear one, for /api/mock/map?stone=<id>. */
  wearAny(stone: StoneId): void {
    this.progress.bestStreak = Math.max(this.progress.bestStreak, 14);
    this.progress.postedDays = Math.max(this.progress.postedDays, 7);
    this.player(this.me, 'you').stone = stone;
  }

  addTower(userId: string, username: string, tower: Omit<MockTower, 'sessionId'>): string {
    const sessionId = `${this.seed.prefix}_session_${this.nextSession++}`;
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

  /**
   * Every tower standing, positioned: each cell's stack bottom to top, whoever built it. On a plots
   * map only a player's own keep stacks, in the order they stacked it; on a factions map a
   * colour's keep and land stack, in the order the towers went up.
   */
  board(): MockTower[] {
    const byCell = new Map<string, GridPlacement[]>();
    for (const p of this.players.values()) {
      for (const placement of p.placements) {
        const key = `${placement.gridX},${placement.gridZ}`;
        const bucket = byCell.get(key);
        if (bucket) bucket.push(placement);
        else byCell.set(key, [placement]);
      }
    }
    const out: MockTower[] = [];
    for (const bucket of byCell.values()) {
      bucket.sort((a, b) =>
        this.rules === 'factions' ? a.placedAt - b.placedAt : a.stackIndex - b.stackIndex
      );
      let baseY = 0;
      for (const placement of bucket) {
        const tower = this.towers.get(placement.sessionId);
        if (!tower) continue;
        out.push({
          ...tower,
          gridX: placement.gridX,
          gridZ: placement.gridZ,
          worldX: cellToWorld(placement.gridX),
          worldZ: cellToWorld(placement.gridZ),
          ...(baseY > 0 ? { stackBaseY: baseY } : {}),
        });
        baseY += placement.height;
      }
    }
    return out;
  }

  /** The rules as one player would be judged by them, against the board as it stands now. */
  private judgeFor(p: MockPlayer): (x: number, z: number, score: number) => PlacementVerdict {
    const board = this.board();
    const holdings = { keeps: this.keeps(), land: landHoldsFrom(board, this.keepRadius) };
    // Their own keep towers on a plots map; everybody's in the colour's keep on a factions map.
    const keepStacks = new Map<string, number>();
    const counted =
      this.rules === 'factions'
        ? board.map((t) => ({ gridX: t.gridX!, gridZ: t.gridZ! }))
        : p.placements.filter((x) => (x.kind ?? 'keep') === 'keep');
    for (const x of counted) {
      const k = cellKey(x.gridX, x.gridZ);
      keepStacks.set(k, (keepStacks.get(k) ?? 0) + 1);
    }
    const region = this.regionCoord(p.userId);
    return (x, z, score) =>
      judgePlacement({
        x,
        z,
        score,
        userId: p.userId,
        faction: p.faction,
        region,
        holdings,
        keepStacks,
        maxStack: MAX_STACK_PER_CELL,
        standing: p.placements.length,
        maxStanding: MAX_PLACEMENTS_PER_PLAYER,
        keepRadius: this.keepRadius,
        rules: this.rules,
      });
  }

  /** Stand a tower on a cell, without judgement: the caller has judged it. */
  private put(
    p: MockPlayer,
    sessionId: string,
    x: number,
    z: number,
    kind: 'keep' | 'land',
    stackIndex: number
  ): void {
    const tower = this.towers.get(sessionId)!;
    p.placements.push({
      sessionId,
      gridX: x,
      gridZ: z,
      stackIndex,
      height: measureHeight(tower.towerBlocks),
      placedAt: this.stamp(),
      kind,
    });
  }

  /**
   * The next take is a retake: the cell is said to have been the player's until its holder took
   * it. Set by /api/mock/map?retake=1, since the mock's neighbours never take anything themselves.
   */
  retakeNext = false;
  /** Runs whose take was a retake, as the server's take record says, for their comment. */
  readonly retakes = new Set<string>();

  /** The same judgement the server makes, then the same consequences. */
  raise(
    userId: string,
    sessionId: string,
    gridX: number,
    gridZ: number
  ):
    | {
        ok: true;
        kind: RaiseKind;
        /** Towers that came down with the cell. */
        fell: number;
        took?: {
          userId: string;
          username: string;
          score: number;
          faction: FactionId | null;
          back?: boolean;
        };
      }
    | { ok: false; message: string; bar?: number } {
    const p = this.player(userId, userId);
    const tower = this.towers.get(sessionId);
    if (!tower) return { ok: false, message: 'That run is gone.' };
    if (tower.userId !== userId) return { ok: false, message: 'Not your tower.' };
    if (p.placements.some((x) => x.sessionId === sessionId))
      return { ok: false, message: 'Already standing.' };

    const verdict = this.judgeFor(p)(gridX, gridZ, tower.score);
    if (!verdict.ok)
      return { ok: false, message: verdict.reason, ...(verdict.bar ? { bar: verdict.bar } : {}) };

    let took:
      | {
          userId: string;
          username: string;
          score: number;
          faction: FactionId | null;
          back?: boolean;
        }
      | undefined;
    let fell = 0;
    if (verdict.kind === 'take') {
      // Everything on the cell comes down: one tower on a plots map, a whole stack on a factions
      // map. The comment names whoever's score was the bar.
      for (const q of this.players.values()) {
        const before = q.placements.length;
        q.placements = q.placements.filter((x) => x.gridX !== gridX || x.gridZ !== gridZ);
        fell += before - q.placements.length;
      }
      took = {
        userId: verdict.from.userId,
        username: verdict.from.username,
        score: verdict.from.score,
        faction: verdict.from.faction,
        ...(this.retakeNext && verdict.from.userId !== userId ? { back: true } : {}),
      };
      if (took.back) this.retakes.add(sessionId);
      if (verdict.from.userId !== userId) this.retakeNext = false;
    }
    this.put(
      p,
      sessionId,
      gridX,
      gridZ,
      verdict.kind === 'keep' ? 'keep' : 'land',
      verdict.kind === 'keep' || verdict.kind === 'stack' ? verdict.stackOn : 0
    );
    return { ok: true, kind: verdict.kind, fell, ...(took ? { took } : {}) };
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
    const kind = cellKind(x, z, this.keepRadius) === 'keep' ? 'keep' : 'land';
    // One tower per land cell, as the rules keep it.
    if (
      kind === 'land' &&
      [...this.players.values()].some((q) =>
        q.placements.some((o) => o.gridX === x && o.gridZ === z)
      )
    )
      return;
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
    // The first four are the keep: spread over a 3x3 one, stacked on a single cell.
    const inKeep = this.keepRadius > 0;
    const cells: Array<[number, number]> = [
      [0, 0],
      inKeep ? [1, -1] : [0, 0],
      inKeep ? [-1, 1] : [0, 0],
      inKeep ? [0, 1] : [0, 0],
      [2, 1],
      [-2, -1],
      [1, 2],
    ];
    const { shift } = this.seed;
    cells.slice(0, cells.length - shift).forEach(([dx, dz], i) => {
      const id = this.seedTower(
        p,
        900 + i * 213 + shift * 97,
        realisticBlockCount(101 + shift, i),
        101_000 + i + shift * 7_919,
        i % 6
      );
      this.plant(p, id, c.x + dx, c.z + dz);
    });
  }

  private seedNeighbours(from: number, to: number): void {
    const { shift } = this.seed;
    for (let i = from; i <= to; i++) {
      const userId = `neighbour-${i}`;
      const p = this.player(userId, `player${i}`);
      // A spread of regulars and newcomers, a few of whom have posted, so the map shows every glow.
      // Most build in neon; the rest in a spread of stones, so the map shows every one in
      // several colours.
      p.stone = i % 3 === 0 ? 'neon' : (STONES[1 + (i % (STONES.length - 1))]?.id ?? 'neon');
      // Every other shifted day leans on fewer colours, so its standings have a clear leader.
      p.faction = FACTION_IDS[(i * (shift > 0 ? 3 : 1) + shift) % (shift > 0 ? 5 : 8)]!;
      const towerCount = 3 + ((i + shift) % 9);
      const region = regionCoordForIndex(p.regionIndex);
      const c = regionCenterCell(region);
      for (let t = 0; t < towerCount; t++) {
        const id = this.seedTower(
          p,
          400 + i * 137 + t * 61 + shift * 211,
          realisticBlockCount(i + shift, t),
          i * 1000 + t + shift * 100_000,
          (i + t) % 5
        );
        // The first three in the keep (the third stacked on the second), the rest out on land.
        if (t < 3) {
          const inKeep = this.keepRadius > 0;
          const dx = inKeep ? (t === 2 ? 0 : (t % 3) - 1) : 0;
          const dz = inKeep ? (i % 3) - 1 : 0;
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

  /**
   * A day on a factions map. The neighbours, five or so of each colour, take turns raising a
   * tower a round, the first of a colour founding its keep, so the colours grow outward from their
   * keeps side by side. Each puts their first tower on the colour's keep and the rest where the
   * rules let them: the open land nearest the keep, and every third on the colour's own ground,
   * so stacks show. The local player plays a share like anyone else, and a rival is given two
   * cells in their colour's reach, so takes can be reviewed.
   */
  private seedColours(): void {
    const { shift } = this.seed;
    const people: Array<{ p: MockPlayer; i: number; towers: number }> = [];
    for (let i = 1; i <= this.seed.players; i++) {
      const p = this.player(`neighbour-${i}`, `player${i}`);
      p.stone = i % 3 === 0 ? 'neon' : (STONES[1 + (i % (STONES.length - 1))]?.id ?? 'neon');
      p.faction = FACTION_IDS[(i * (shift > 0 ? 3 : 1) + shift) % (shift > 0 ? 5 : 8)]!;
      people.push({ p, i, towers: 3 + ((i + shift) % 9) });
      if (i === Math.floor(this.seed.players / 3)) {
        people.push({ p: this.player(this.me, 'you'), i: 0, towers: 7 });
      }
    }
    const rounds = Math.max(...people.map((x) => x.towers));
    for (let t = 0; t < rounds; t++) {
      for (const { p, i, towers } of people) {
        if (t >= towers) continue;
        const id = this.seedTower(
          p,
          i === 0 ? 900 + t * 213 : 400 + i * 137 + t * 61 + shift * 211,
          realisticBlockCount(i + shift, t),
          i * 1000 + t + shift * 100_000 + (i === 0 ? 101_000 : 0),
          (i + t) % 5
        );
        this.seedRaise(p, id, t);
      }
    }

    // A rival's two holds in the local player's reach: open land a couple of cells out.
    const me = this.player(this.me, 'you');
    const rival = people.find(({ p }) => p.faction !== me.faction)?.p;
    if (!rival) return;
    const judge = this.judgeFor(me);
    const home = regionCenterCell(this.regionCoord(me.userId));
    const scores: Array<[number, number]> = [
      [640, 27],
      [1290, 44],
    ];
    for (let ring = 2; ring <= REGION_PITCH && scores.length > 0; ring++) {
      for (let dx = -ring; dx <= ring && scores.length > 0; dx++) {
        for (let dz = -ring; dz <= ring && scores.length > 0; dz++) {
          if (Math.max(Math.abs(dx), Math.abs(dz)) !== ring) continue;
          const v = judge(home.x + dx, home.z + dz, 1);
          if (!v.ok || v.kind !== 'claim') continue;
          const [score, blocks] = scores.shift()!;
          const id = this.seedTower(rival, score, blocks, 77_000 + score, 3);
          this.put(rival, id, home.x + dx, home.z + dz, 'land', 0);
        }
      }
    }
  }

  /** Where a seeded neighbour raises: the colour's keep first, then outward from it. */
  private seedRaise(p: MockPlayer, sessionId: string, t: number): void {
    const score = this.towers.get(sessionId)!.score;
    const judge = this.judgeFor(p);
    const home = regionCenterCell(this.regionCoord(p.userId));
    if (t === 0) {
      const v = judge(home.x, home.z, score);
      if (v.ok && v.kind === 'keep') this.put(p, sessionId, home.x, home.z, 'keep', v.stackOn);
      return;
    }
    const want = t % 3 === 2 ? 'stack' : 'claim';
    let fallback: { x: number; z: number; stackOn: number } | null = null;
    for (let ring = 1; ring <= REGION_PITCH * 2; ring++) {
      for (let dx = -ring; dx <= ring; dx++) {
        for (let dz = -ring; dz <= ring; dz++) {
          if (Math.max(Math.abs(dx), Math.abs(dz)) !== ring) continue;
          const x = home.x + dx;
          const z = home.z + dz;
          const v = judge(x, z, score);
          if (!v.ok || (v.kind !== 'claim' && v.kind !== 'stack')) continue;
          const stackOn = v.kind === 'stack' ? v.stackOn : 0;
          if (v.kind === want) {
            this.put(p, sessionId, x, z, 'land', stackOn);
            return;
          }
          fallback ??= { x, z, stackOn };
        }
      }
    }
    if (fallback) this.put(p, sessionId, fallback.x, fallback.z, 'land', fallback.stackOn);
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

/**
 * The local player's progress (shared/social/progress.ts), as the server's `Progress` keeps it on
 * the user record. Starts most of the way into level 6, with three cells held yesterday and the
 * colour having won, so the first raise of a session drops the day's capstone and levels up.
 * `/api/mock/map?xp=N` sets the XP, `?capstone=1` lets today's capstone fall again (and clears the
 * orders), `?gold=1` makes the next capstone gold, `?orders=nearly` puts every order one short.
 */
class MockProgress {
  xp = xpAtLevel(6) + 290;
  held = 3;
  won = true;
  goldNext = false;
  private p: DayProgress | null = null;

  private today(day: string, faction: FactionId): DayProgress {
    if (!this.p || this.p.day !== day || this.p.faction !== faction)
      this.p = freshDay(day, faction);
    return this.p;
  }

  news(day: string, faction: FactionId, gains: XpGain[] = []): ProgressNews {
    const p = this.today(day, faction);
    return { xp: this.xp, orders: ordersNews(p), capstone: p.capstone, gains };
  }

  reset(): void {
    this.p = null;
  }

  /** Every order one short of done, so the next thing that counts finishes one. */
  nearly(day: string, faction: FactionId): void {
    const p = this.today(day, faction);
    p.counts = ordersNews(p).map((o) => Math.max(0, o.n - 1));
  }

  private earn(
    day: string,
    faction: FactionId,
    streak: number,
    first: XpGain,
    event: ProgressEvent,
    capstone: boolean
  ): ProgressNews {
    const p = this.today(day, faction);
    const gains: XpGain[] = first.xp > 0 ? [first] : [];
    if (capstone && !p.capstone) {
      const cap = capstoneFor('local-player', day, { streak, held: this.held, won: this.won });
      const golden = cap.golden || this.goldNext;
      this.goldNext = false;
      p.capstone = true;
      gains.push({
        kind: 'capstone',
        xp: golden && !cap.golden ? cap.xp * 3 : cap.xp,
        golden,
        streak: cap.streak,
        held: cap.held,
        won: cap.won,
      });
    }
    const orders = ordersNews(p);
    for (const i of countEvent(p, event))
      gains.push({ kind: 'order', xp: orders[i]?.xp ?? 0, order: i });
    if (!p.bonus && allDone(p)) {
      p.bonus = true;
      gains.push({ kind: 'capstone', orders: true, ...ordersCapstone('local-player', day) });
    }
    const before = levelOf(this.xp).level;
    this.xp += gains.reduce((n, g) => n + g.xp, 0);
    const after = levelOf(this.xp).level;
    console.log(
      `[mock] XP +${gains.reduce((n, g) => n + g.xp, 0)} (${gains.map((g) => g.kind).join(', ')}) = ${this.xp}${after > before ? `, level ${after}` : ''}`
    );
    return this.news(day, faction, gains);
  }

  raised(
    day: string,
    faction: FactionId,
    streak: number,
    raise: RaiseXpInput & { ahead: boolean }
  ): ProgressNews {
    const xp = raiseXp(raise);
    return this.earn(
      day,
      faction,
      streak,
      { kind: 'raise', xp: xp.xp, base: xp.base, mult: xp.mult, why: xp.why },
      {
        type: 'raise',
        kind: raise.kind,
        own: raise.own === true,
        ahead: raise.ahead,
        fell: raise.fell ?? 0,
        perfects: raise.perfects,
      },
      true
    );
  }

  relayed(day: string, faction: FactionId, blocks: number, perfects: number): ProgressNews {
    return this.earn(
      day,
      faction,
      0,
      { kind: 'relay', xp: relayXp(blocks, perfects), blocks },
      { type: 'relay', blocks },
      false
    );
  }
}

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
 * their seats on start, fill the first crew and spill into a second tower, and stack through
 * their turns the way a person does: a beat to start, each block dropped near the middle of its
 * sweep and no sooner than the sweep gets there, and now and then a miss, so a fall can be
 * watched from the local player's seat. A bot that falls is replaced by a fresh one a few seconds
 * later.
 *
 * `GET /api/mock/relay?bots=N` seats N more bots (more towers appear as crews fill);
 * `?miss=1` makes the next bot drop a miss, for looking at a fall on purpose (`&tower=N` for the
 * next one on that tower); `?youmiss=1` makes the local player's next drop one; `?youout=1` puts
 * them out for the day at once; `?unsub=1` forgets that they subscribed; `?grow=N` adds N
 * blocks to every tower at once; `?old=1` opens the relay post as yesterday's (`?old=0` back).
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
  /** Each bot's next drop of its current turn: when it is due, and at which tick of the sweep. */
  private botPlan = new Map<string, { at: number; tick: number }>();
  /** Who subscribed from the game, as the server's user record says. */
  subscribed = new Set<string>();

  /**
   * Today's relay, with bots at work. Given `pastFor`, yesterday's instead, as an older post shows
   * it: four towers as they topped out, and that player's day on the tallest, where they fell.
   * Nobody plays yesterday's; it has no bots and no clock.
   */
  constructor(pastFor?: string) {
    const now = Date.now();
    this.meta = {
      postId: pastFor ? 't3_mockrelay_past' : 't3_mockrelay',
      day: new Date(pastFor ? now - 86_400_000 : now).toISOString().slice(0, 10),
      towers: 0,
      closed: !!pastFor,
      createdAt: now,
      // Yesterday's, as an older post shows it, is from before faction towers: crews.
      rules: pastFor ? 'crews' : RELAY_RULES,
    };
    if (pastFor) {
      this.seedPastDay(pastFor, now);
      return;
    }
    if (this.rules === 'factions') {
      // A tower per colour from the start, each some way up already, so the race is a race: the
      // local player's colour (violet) third, a few blocks behind the colour above.
      const heights: Record<FactionId, number> = {
        ember: 9,
        gold: 22,
        lime: 0,
        jade: 14,
        cyan: 5,
        cobalt: 26,
        violet: 19,
        rose: 11,
      };
      for (const [k, f] of FACTION_IDS.entries()) {
        const n = this.addTower(now, f);
        const tower = this.towers.get(n)!;
        for (let i = 0; i < heights[f]; i++) this.growFree(tower, f);
        // The seeded blocks as turns by people who have gone home, so the tower is marked with
        // who built it (`noteBestTurn`) before anybody here has played.
        const sizes = [7, 4, 9, 3, 5, 2, 6];
        for (let at = 1, j = 0; at < tower.blocks.length; j++) {
          const laid = Math.min(tower.blocks.length - at, sizes[(j + k) % sizes.length]!);
          noteBestTurn(tower, {
            userId: `gone-${f}-${j}`,
            username: BOT_NAMES[(j * 3 + k) % BOT_NAMES.length]!,
            snoovatar: null,
            from: at,
            to: at + laid,
            laid,
            streak: (j * 5 + k) % (laid + 1),
          });
          at += laid;
        }
      }
    } else {
      this.addTower(now);
      // A tower some way up already, so the scene is a tower and not a base block.
      const first = this.towers.get(1)!;
      for (let i = 0; i < 14; i++) this.growFree(first, FACTION_IDS[(i * 5) % 8]!);
    }
    for (let i = 0; i < 8; i++) this.spawnBot(now - (8 - i) * 400);
    this.timer = setInterval(() => this.tick(), 350);
  }

  get rules() {
    return relayRulesOr(this.meta.rules);
  }

  private seedPastDay(me: string, now: number): void {
    const ended = [
      { height: 58, builders: 14, fallen: 5 },
      { height: 37, builders: 9, fallen: 4 },
      { height: 23, builders: 6, fallen: 3 },
      { height: 9, builders: 2, fallen: 1 },
    ];
    for (const [i, end] of ended.entries()) {
      const tower = this.towers.get(this.addTower(now - 3_600_000))!;
      for (let b = 1; b < end.height; b++) {
        this.growFree(tower, FACTION_IDS[(b * 3 + i) % FACTION_IDS.length]!);
      }
      Object.assign(tower, {
        builders: end.builders,
        fallen: end.fallen,
        closed: true,
        turn: null,
      });
      tower.events = [{ at: now, kind: 'closed', username: '', block: tower.blocks.length }];
    }
    this.players.set(me, {
      userId: me,
      username: 'you',
      faction: 'jade',
      snoovatar: null,
      joinedAt: now - 7_200_000,
      tower: 1,
      blocks: 7,
      perfects: 2,
      misses: RELAY.LIVES,
      out: { block: 44, at: now - 5_400_000 },
    });
  }

  /** Lay a block on a tower directly, at the crossing: for seeding only. */
  private growFree(tower: RelayTowerState, faction: FactionId): void {
    const replayed = replayTurn(tower.blocks, crossingTick(tower.blocks), 'relay');
    if (!replayed || replayed.isGameOver) return;
    tower.blocks = [...replayed.blocks];
    tower.colors = [...tower.colors, faction];
    tower.builders += 1;
  }

  addTower(now: number, faction?: FactionId): number {
    const n = faction ? towerIdFor(faction) : this.meta.towers + 1;
    this.meta.towers = Math.max(this.meta.towers, n);
    this.towers.set(n, freshTower(n, this.meta.day, now, faction));
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
    if (me?.faction && this.rules === 'factions') return towerIdFor(me.faction);
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
      rules: this.rules,
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
    grantLives(me, this.subscribed.has(userId) ? RELAY.MEMBER_LIVES : 0);
    if (me.out) return { ok: false, message: 'You are out for today.' };
    const stays = this.rules !== 'factions' || me.tower === towerIdFor(me.faction ?? 'cyan');
    if (me.tower && this.crews.get(me.tower)?.has(userId)) {
      if (stays) return { ok: true, started: false };
      this.crews.get(me.tower)?.delete(userId);
    }
    let n = seatFor(
      this.rules,
      me.faction ?? 'cyan',
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

  /** A batch of taps, in order, as the server's `Relay.drop` takes them. */
  drop(
    userId: string,
    taps: readonly RelayTap[]
  ):
    | {
        ok: true;
        result: 'landed' | 'perfect' | 'fell';
        taken: number;
        laid: number;
        perfects: number;
        state: RelayState;
      }
    | { ok: false; message: string; state?: RelayState } {
    const now = Date.now();
    const me = this.players.get(userId);
    if (!me || !me.tower) return { ok: false, message: 'Take a seat first.' };
    const blocksBefore = me.blocks;
    const perfectsBefore = me.perfects;
    if (taps.length === 0) return { ok: false, message: 'Nothing to drop.' };
    const n = me.tower;
    const tower = this.towers.get(n)!;
    let last: { result: 'landed' | 'perfect' | 'fell' } | null = null;
    let taken = 0;
    let refused: { reason: string; stale?: boolean } | null = null;
    for (const tap of taps) {
      let tick = tap.tick;
      if (!userId.startsWith('bot-') && this.forceMyMiss) {
        this.forceMyMiss = false;
        tick = farTick(tower.blocks, tower.turn?.laid ?? 0);
      }
      const outcome = applyDrop(tower, me, tick, tap.index, now);
      if (!outcome.ok) {
        refused = outcome;
        break;
      }
      last = outcome;
      taken += 1;
      console.log(
        `[mock:relay] ${me.username} ${outcome.result} on tower ${n} at ${tower.blocks.length}`
      );
      if (outcome.turnOver) break;
    }
    if (!last) {
      return {
        ok: false,
        message: refused?.reason ?? 'That tap did not read.',
        ...(refused?.stale ? { state: this.view(userId, null, now) } : {}),
      };
    }
    if (me.out) this.crews.get(n)?.delete(userId);
    if (!tower.turn) settleTurn(tower, this.crew(n, now), now + RELAY.TURN_GRACE_MS);
    if (me.out && userId.startsWith('bot-')) {
      setTimeout(() => this.spawnBot(Date.now()), 4000 + Math.random() * 3000);
    }
    return {
      ok: true,
      result: last.result,
      taken,
      laid: me.blocks - blocksBefore,
      perfects: me.perfects - perfectsBefore,
      state: this.view(userId, null, now),
    };
  }

  /** Subscribed, as the server's `Relay.subscribed`: today's extra lives, back in if out. */
  subscribe(userId: string): boolean {
    this.subscribed.add(userId);
    const me = this.players.get(userId);
    if (!me) return false;
    const n = me.tower;
    const back = grantLives(me, RELAY.MEMBER_LIVES);
    if (back && n) this.crews.get(n)?.delete(userId);
    return back;
  }

  control(query: URLSearchParams, me: string): void {
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
    const p = this.players.get(me);
    if (query.get('youout') === '1' && p && !p.out) {
      p.misses = livesToday(p);
      p.out = { block: this.towers.get(p.tower ?? 1)?.blocks.length ?? 1, at: Date.now() };
      if (p.tower) this.crews.get(p.tower)?.delete(me);
    }
    if (query.get('unsub') === '1') {
      this.subscribed.delete(me);
      if (p) delete p.extra;
    }
    // Grow every tower by N blocks at once, to see how the scene holds up late in a busy day, or
    // with `on=K` only tower K (a colour's, to put it just ahead of yours in the race).
    const grow = Number(query.get('grow'));
    const on = Number(query.get('on'));
    if (Number.isInteger(grow) && grow > 0) {
      for (const tower of this.towers.values()) {
        if (Number.isInteger(on) && on > 0 && tower.id !== on) continue;
        for (let i = 0; i < Math.min(2000, grow); i++) {
          this.growFree(
            tower,
            tower.faction ?? FACTION_IDS[(tower.blocks.length * 3) % FACTION_IDS.length]!
          );
        }
        tower.version += 1;
      }
    }
  }

  /**
   * Bots stay present and stack through their turns: a beat to start, then each block dropped
   * near the middle of its sweep, at the tick it got there, so the turn holds no more ticks than
   * the clock has run. One in sixteen drops misses, which ends the turn.
   */
  private tick(): void {
    const now = Date.now();
    for (const [n, seen] of this.crews) {
      for (const id of seen.keys()) if (id.startsWith('bot-')) seen.set(id, now);
      this.settle(n, now);
      const tower = this.towers.get(n)!;
      const turn = tower.turn;
      if (!turn || !turn.userId.startsWith('bot-') || now < turn.startedAt) continue;
      const laid = turn.laid ?? 0;
      const planKey = `${turn.userId}:${turn.startedAt}:${laid}`;
      let plan = this.botPlan.get(planKey);
      if (!plan) {
        const forced = this.forceMiss && (this.forceMissOn === null || this.forceMissOn === n);
        if (forced) this.forceMiss = false;
        const miss = forced || Math.random() < 1 / 16;
        const tick = Math.max(
          1,
          miss
            ? farTick(tower.blocks, laid)
            : crossingTick(tower.blocks, laid) + Math.round((Math.random() - 0.5) * 6)
        );
        // From the turn's start, or from the last landing: the sweep starts again from there.
        const from = laid === 0 ? turn.startedAt + 600 + Math.random() * 900 : now;
        plan = { at: from + (tick * 1000) / 60 + 30, tick };
        this.botPlan.set(planKey, plan);
      }
      if (now < plan.at) continue;
      this.botPlan.delete(planKey);
      // Past its shown time a turn is over for a person too: nobody drops into the last second.
      if (now > turn.startedAt + shownTurnMs(turn)) continue;
      this.drop(turn.userId, [{ tick: plan.tick, index: turn.index }]);
    }
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
  }
}

/** How far off the tower the sweep has the block at each of its first ticks. */
const sweepOffsets = (blocks: Block[], laid = 0): number[] => {
  const turn = createTurnSimulation(blocks, laid);
  const sim = turn.sim;
  let state = turn.state;
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
const crossingTick = (blocks: Block[], laid = 0): number => {
  const offsets = sweepOffsets(blocks, laid);
  let best = 0;
  offsets.forEach((o, i) => {
    if (o < offsets[best]!) best = i;
  });
  return best + 2;
};

/** A tick at which the block is as far off the tower as the sweep takes it: a sure miss. */
const farTick = (blocks: Block[], laid = 0): number => {
  const offsets = sweepOffsets(blocks, laid);
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

const TOO_LONG = `Keep it under ${NOTE_MAX.toLocaleString('en-US')} characters.`;

/**
 * Where a comment would go and what it would say, decided as the server decides it
 * (`commentToPost`). Null when the player's words are too long to take.
 */
const mockPlacement = (
  raw: unknown,
  comment: ScoreComment
): { topLevel: boolean; text: string; where: string } | null => {
  const post = commentToPost(comment, raw);
  return post && { ...post, where: post.topLevel ? 'top-level' : 'under Scores' };
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
  /**
   * Whether the app has push notifications. Off, as on the server until Devvit accepts Stonefall
   * into the beta (`PUSH_ENABLED`); /api/mock/map?push=1 shows the bell as it will be.
   */
  let push = false;
  /** The local player's flair and notifications, as the user record keeps them. */
  let flairOn = true;
  let notifyOn = false;
  /** Journeys started, so the log shows which journey each event landed on. */
  let journeys = 0;
  /**
   * Whether the map is opened as today's post or as yesterday's, flipped by /api/mock/map?live=0.
   * Yesterday's opens on that day's board as it ended, and a run from it is on today's map.
   */
  let mapLive = true;
  /** The same for the relay, flipped by /api/mock/relay?old=1: yesterday's towers, topped out. */
  let relayOld = false;
  const dayAfter = (day: string, n: number): string =>
    new Date(Date.parse(`${day}T12:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
  /** The day being played. `/api/mock/map?turn=1` moves it on, to try the day turning over. */
  let today = new Date().toISOString().slice(0, 10);
  /**
   * The pace today's runs are played at: the current one, or the legacy one with
   * `/api/mock/map?pace=1` (`?pace=2` back). Yesterday's map, as an older post, is legacy.
   */
  let pace: RunPace = RUN_PACE;

  return {
    name: 'stonefall-mock-api',
    configureServer(server) {
      // Built here, not when the plugin is created. The plugin is created whenever the config is
      // loaded, `vite build` included, and the relay's bots run on a timer: created there, it
      // kept every build process alive after the build had finished, so `npm run build` -- and
      // `npm run deploy` behind it -- never returned.
      const store = new MockStore();
      const pastStore = new MockStore(PAST_SEED);
      const progress = new MockProgress();
      const relay = new MockRelayStore();
      const pastRelay = new MockRelayStore(store.me);
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
            // `?view=post` is the board the post opens on: yesterday's, opened as yesterday's post.
            const past = query.get('view') === 'post' && !mapLive;
            const shown = past ? pastStore : store;
            const towers = shown.board();
            return send({
              type: 'board',
              // Packed as the server stores and sends them, so the harness reads what Reddit does.
              towers: towers.map(packTower),
              keeps: shown.keeps(),
              totalCount: towers.length,
              map: {
                day: past ? dayAfter(today, -1) : today,
                live: !past,
                keepRadius: shown.keepRadius,
                rules: shown.rules,
                // The live day's, whichever day is shown: runs are always on today's map.
                pace,
                todayPostId: 't3_mockmap',
                postDay: mapLive ? today : dayAfter(today, -1),
              },
            });
          }

          // Harness controls, for looking at states on purpose.
          if (path === '/api/mock/map') {
            if (query.has('live')) mapLive = query.get('live') !== '0';
            if (query.get('turn') === '1') today = dayAfter(today, 1);
            if (query.has('push')) push = query.get('push') === '1';
            if (query.has('pace')) pace = paceOr(query.get('pace'));
            if (query.get('retake') === '1') store.retakeNext = true;
            const wearing = query.get('stone');
            if (isStoneId(wearing)) store.wearAny(wearing);
            if (query.has('xp')) progress.xp = Math.max(0, Number(query.get('xp')) || 0);
            if (query.get('capstone') === '1') progress.reset();
            if (query.has('gold')) progress.goldNext = query.get('gold') === '1';
            if (query.get('orders') === 'nearly') progress.nearly(today, me.faction);
            console.log(
              `[mock] Playing ${today}, opened as ${mapLive ? "today's post" : 'an older post'}`
            );
            return send({ ok: true, live: mapLive, day: today });
          }
          if (path === '/api/mock/relay') {
            if (query.has('old')) relayOld = query.get('old') === '1';
            relay.control(query, store.me);
            return send({ ok: true, towers: relay.meta.towers, old: relayOld });
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
              stones: store.stoneNews(),
              progress: progress.news(today, me.faction),
              flair: flairOn,
              notify: push ? notifyOn : null,
            });
          }

          if (path === '/api/me/flair') {
            const { on } = await readJson(req);
            flairOn = on === true;
            const text = flairOn ? store.flairText() : null;
            console.log(`[mock] Flair ${flairOn ? `set: ${text}` : 'removed'}`);
            return send({ type: 'flair', success: true, on: flairOn, text });
          }

          if (path === '/api/me/notify') {
            if (req.method === 'POST') {
              const { on, offset } = await readJson(req);
              if (!push) {
                return send(
                  {
                    type: 'notify',
                    success: false,
                    on: null,
                    message: 'Notifications are not on for Stonefall yet.',
                  },
                  409
                );
              }
              notifyOn = on === true;
              console.log(`[mock] Notifications ${notifyOn ? 'on' : 'off'}, UTC offset ${offset}`);
            }
            return send({ type: 'notify', success: true, on: push ? notifyOn : null });
          }

          if (path === '/api/me/stone') {
            const { stone } = await readJson(req);
            if (!isStoneId(stone) || !store.wear(stone)) {
              return send({ type: 'stone', success: false, message: 'Not earned yet.' }, 409);
            }
            return send({ type: 'stone', success: true, stone });
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
            const { sessionId, gridX, gridZ, day } = await readJson(req);
            // As on the server: a cell picked on a map that has since turned over is refused.
            if (typeof day === 'string' && day !== today) {
              console.log(`[mock] Raise refused: aimed on ${day}, playing ${today}`);
              return send(
                {
                  type: 'place_tower',
                  success: false,
                  message: "A new day's map just opened. Raise it there.",
                  stale: true,
                },
                409
              );
            }
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
            const run = store.getTower(sessionId);
            const own = result.kind === 'take' && result.took?.userId === store.me;
            return send({
              type: 'place_tower',
              success: true,
              grid: store.gridOf(store.me),
              kind: result.kind,
              ...(result.took ? { took: result.took } : {}),
              progress: progress.raised(today, me.faction, store.stoneNews().streak, {
                kind: result.kind,
                blocks: run?.blockCount ?? 0,
                perfects: run?.perfectStreak ?? 0,
                own,
                back: result.took?.back === true,
                fell: result.fell,
                // The mock's neighbours are all behind the local player's colour or level with it.
                ahead: result.kind === 'take' && !own,
              }),
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
            // As the server's Maps.paceForRun: yesterday's map, an older post here, is legacy.
            const runPace = paceToReplay(body?.pace, pace, LEGACY_RUN_PACE);
            const state = replayRun(Number(body.seed), 'rotating_block', inputs, runPace);
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
            const stones = store.played();
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
              stones,
            });
          }

          if (path.startsWith('/api/telemetry/')) {
            const body = await readJson(req).catch(() => ({}));
            const event = path.replace('/api/telemetry/journey/', '');
            console.log(`[mock:journey] ${event}`, JSON.stringify(body));
            const receipt = { status: 'JOURNEY_RECEIPT_VALID', message: 'mock' };
            return send(
              event === 'start' ? { journeyId: `mock-journey-${++journeys}`, receipt } : { receipt }
            );
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
            const placed = mockPlacement(body.text, {
              kind: record.kind,
              score: record.score,
              blocks: record.blocks,
              perfectStreak: record.perfectStreak,
              faction: record.faction ?? null,
              passedUsername: body.passedUsername,
              passedScore: body.passedScore,
              cell: body.cell,
              back: body.kind === 'took' && store.retakes.has(body.sessionId),
            });
            if (!placed) {
              bragged.delete(body.sessionId);
              return send({ type: 'brag', success: false, message: TOO_LONG }, 409);
            }
            // As on the server: a line that names somebody answers their comment, when the
            // thread has one from them (the mock's stand-in for the comment their run was in).
            const named = typeof body.passedUsername === 'string' ? body.passedUsername : null;
            const repliedTo =
              named && (body.kind === 'took' || body.kind === 'passed')
                ? (feed.find((b) => b.username.toLowerCase() === named.toLowerCase())?.username ??
                  null)
                : null;
            if (repliedTo) placed.where = `in reply to u/${repliedTo}`;
            feed.unshift(record);
            feed.length = Math.min(feed.length, 40);
            const stones = store.posted();
            console.log(
              `[mock] Brag: ${record.score} pts (${record.kind}) ${placed.where}: ${JSON.stringify(placed.text.slice(0, 160))}`
            );
            return send({
              type: 'brag',
              success: true,
              record,
              topLevel: placed.topLevel && !repliedTo,
              ...(repliedTo ? { repliedTo } : {}),
              stones,
            });
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
          if (path === '/api/relay/state') {
            // `?view=post` is the relay the post opens on: yesterday's, opened as yesterday's post.
            const shown = query.get('view') === 'post' && relayOld ? pastRelay : relay;
            return send({
              type: 'relay',
              state: shown.view(store.me, watching(query.get('tower')), Date.now()),
            });
          }
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
          if (path === '/api/relay/subscribe') {
            const body = await readJson(req).catch(() => ({}));
            const back = relay.subscribe(store.me);
            console.log(`[mock:relay] you subscribed${back ? ', and are back in' : ''}`);
            return send({
              type: 'relay_subscribe',
              success: true,
              back,
              state: relay.view(store.me, back ? watching(body?.tower) : null, Date.now()),
            });
          }
          if (path === '/api/relay/brag') {
            const p = relay.players.get(store.me);
            if (!p?.out)
              return send(
                { type: 'relay_brag', success: false, message: 'Nothing to post yet.' },
                409
              );
            const { text } = await readJson(req).catch(() => ({ text: undefined }));
            const placed = mockPlacement(text, {
              kind: 'fell',
              score: 0,
              blocks: p.out.block,
              perfectStreak: 0,
              faction: p.faction ?? null,
            });
            if (!placed)
              return send({ type: 'relay_brag', success: false, message: TOO_LONG }, 409);
            console.log(
              `[mock] Relay brag: fell at ${p.out.block} ${placed.where}: ${JSON.stringify(placed.text.slice(0, 160))}`
            );
            return send({
              type: 'relay_brag',
              success: true,
              topLevel: placed.topLevel,
              stones: store.posted(),
            });
          }
          if (path === '/api/relay/drop') {
            const result = relay.drop(store.me, parseTaps(await readJson(req)));
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
              taken: result.taken,
              state: result.state,
              ...(result.laid > 0
                ? { progress: progress.relayed(today, me.faction, result.laid, result.perfects) }
                : {}),
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
