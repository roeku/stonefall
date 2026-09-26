import { redis } from '@devvit/web/server';
import type {
  GridPlacement,
  PlayerGrid,
  PlayerRegion,
  RaiseKind,
  TowerMapEntry,
} from '../../shared/types/api';
import { factionName, type FactionId } from '../../shared/types/factions';
import { MAX_PLACEMENTS_PER_PLAYER } from '../../shared/constants/towers';
import { MAX_STACK_PER_CELL } from '../../shared/types/towerPlacement';
import {
  cellKey as cellName,
  cellKind,
  judgePlacement,
  landCountByFaction,
  parseCellKey,
  type Holdings,
  type KeepRecord,
  type LandHold,
} from '../../shared/types/territory';
import {
  cellToWorld,
  REGION_RADIUS,
  regionCenterCell,
  regionCoordForIndex,
  type RegionCoord,
} from '../../shared/types/worldGrid';
import {
  BOARD_MAX_BLOCKS,
  BOARD_MAX_TOWERS,
  BOARD_PAGE_SIZE,
  LAND_INDEX_LIMIT,
  MAP_TTL_SECONDS,
  PLOT_INDEX_LIMIT,
  boardKeepsKey,
  boardMetaKey,
  boardPageKey,
  cellKey,
  keepKey,
  landIndexKey,
  nextRegionKey,
  plotIndexKey,
  plotKey,
  regionKey,
  regionOwnerKey,
  tookKey,
} from './keys';
import { Runs, type StoredRun } from './runs';
import { Users } from './users';

/**
 * Plots: where each player's towers stand, who holds which cell, and the board everyone sees.
 *
 * Everything here is scoped to one map, and a map is one day: `map` is the day it opened. A
 * player is given a plot on their first run of the day, packed outward from the centre in the
 * order people arrive, so each morning's board starts from nothing and fills with whoever plays.
 *
 * Three kinds of cell, decided by geometry alone (see shared/types/territory.ts): a keep, which
 * only its owner builds on and which stacks; land, which anyone in reach can claim and which
 * is held by one tower until a higher-scoring one topples it; and road, which nothing stands
 * on. The rules are judged by the shared `judgePlacement`, the same function the client uses to
 * draw what is takeable, so the map never promises what the server refuses.
 *
 * Storage stays proportional to players and held cells rather than to games played: a plot is
 * a list of placements that reference runs by id, a hold is one small row per land cell, and
 * the board is rebuilt when a placement changes it and read as fixed pages. Reads never write.
 * Every key expires a fortnight after its day, so a map nobody writes to any more goes away.
 */

export type RaiseResult =
  | {
      ok: true;
      grid: PlayerGrid;
      kind: RaiseKind;
      took?: { userId: string; username: string; score: number; faction: FactionId | null };
    }
  | { ok: false; reason: string; bar?: number };

const emptyGrid = (userId: string, username: string): PlayerGrid => ({
  userId,
  username,
  placements: [],
  updatedAt: Date.now(),
});

const parse = <T>(raw: string | null | undefined): T | null => {
  if (!raw) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
};

/** mGet in chunks of a hundred: one round trip per hundred rows instead of one per row. */
const readMany = async <T>(keys: readonly string[]): Promise<(T | null)[]> => {
  const out: (T | null)[] = [];
  for (let i = 0; i < keys.length; i += 100) {
    const rows = await redis.mGet(keys.slice(i, i + 100));
    for (const raw of rows ?? []) out.push(parse<T>(raw));
  }
  return out;
};

/**
 * When everything about a map goes: a fixed time after the day it opened.
 *
 * Absolute rather than refreshed on write, so a key written late in the day does not outlive the
 * rest of its map, and a map that is never written again still expires on schedule.
 */
export const mapExpiry = (map: string): Date => {
  const opened = Date.parse(`${map}T00:00:00Z`);
  const from = Number.isFinite(opened) ? opened : Date.now();
  return new Date(Math.max(Date.now() + 60 * 60 * 1000, from + MAP_TTL_SECONDS * 1000));
};

const ttlSeconds = (map: string): number =>
  Math.max(60, Math.floor((mapExpiry(map).getTime() - Date.now()) / 1000));

const entryFromRun = (
  run: StoredRun,
  p: { gridX: number; gridZ: number },
  stackBaseY: number,
  withGeometry: boolean
): TowerMapEntry => ({
  sessionId: run.sessionId,
  userId: run.userId,
  username: run.username,
  score: run.score,
  blockCount: run.blockCount,
  perfectStreak: run.perfectCount,
  maxCombo: run.maxCombo,
  gameMode: run.gameMode,
  timestamp: run.createdAt,
  towerBlocks: withGeometry ? run.towerBlocks : [],
  height: run.height,
  faction: run.faction ?? null,
  gridX: p.gridX,
  gridZ: p.gridZ,
  worldX: cellToWorld(p.gridX),
  worldZ: cellToWorld(p.gridZ),
  stackBaseY,
});

export const Plots = {
  // --- Regions and keeps -------------------------------------------------------------------

  /**
   * The region a player builds in on this map, allocating one on first use.
   *
   * An INCR allocator rather than a hash of the user id: hashing would eventually hand two
   * players the same patch and interleave their builds. Assigned when a run starts, not when the
   * post is opened, so the map is packed with people who play rather than people who looked. The
   * index is claimed with NX, so a double tap on Build cannot hand one player two plots.
   */
  async getOrAssignRegion(map: string, userId: string, username: string): Promise<RegionCoord> {
    const existing = await this.getRegion(map, userId);
    if (existing) {
      // A keep row is what puts the keep on the map; make sure one exists.
      if (!(await redis.get(keepKey(map, userId)))) {
        await this.writeKeep(map, userId, username, existing);
      }
      return existing;
    }
    const counter = nextRegionKey(map);
    // incrBy returns the value after incrementing, so subtracting one keeps index 0 in use.
    const next = (await redis.incrBy(counter, 1)) - 1;
    await redis.expire(counter, ttlSeconds(map));
    await redis.set(regionKey(map, userId), String(next), {
      nx: true,
      expiration: mapExpiry(map),
    });
    const region = await this.getRegion(map, userId);
    if (!region) throw new Error('region allocation failed');
    await redis.set(regionOwnerKey(map, region.rx, region.rz), userId, {
      expiration: mapExpiry(map),
    });
    await this.writeKeep(map, userId, username, region);
    return region;
  },

  async writeKeep(
    map: string,
    userId: string,
    username: string,
    region: RegionCoord,
    faction?: FactionId
  ): Promise<KeepRecord> {
    const center = regionCenterCell(region);
    const keep: KeepRecord = {
      userId,
      username,
      faction: faction ?? (await Users.faction(userId)),
      rx: region.rx,
      rz: region.rz,
      centerX: center.x,
      centerZ: center.z,
    };
    await redis.set(keepKey(map, userId), JSON.stringify(keep), { expiration: mapExpiry(map) });
    return keep;
  },

  async getRegion(map: string, userId: string): Promise<RegionCoord | null> {
    const existing = await redis.get(regionKey(map, userId));
    if (!existing) return null;
    const index = parseInt(existing, 10);
    return Number.isInteger(index) && index >= 0 ? regionCoordForIndex(index) : null;
  },

  describeRegion(region: RegionCoord): PlayerRegion {
    const center = regionCenterCell(region);
    return {
      rx: region.rx,
      rz: region.rz,
      centerX: center.x,
      centerZ: center.z,
      radius: REGION_RADIUS,
    };
  },

  // --- Plots --------------------------------------------------------------------------------

  async getPlot(map: string, userId: string): Promise<PlayerGrid | null> {
    const parsed = parse<PlayerGrid>(await redis.get(plotKey(map, userId)));
    return parsed && Array.isArray(parsed.placements) ? parsed : null;
  },

  async savePlot(map: string, grid: PlayerGrid): Promise<void> {
    grid.updatedAt = Date.now();
    await redis.set(plotKey(map, grid.userId), JSON.stringify(grid), {
      expiration: mapExpiry(map),
    });
    const index = plotIndexKey(map);
    await redis.zAdd(index, { member: grid.userId, score: grid.updatedAt });
    await redis.zRemRangeByRank(index, 0, -(PLOT_INDEX_LIMIT + 1));
    await redis.expire(index, ttlSeconds(map));
  },

  // --- Holds --------------------------------------------------------------------------------

  async getHold(map: string, x: number, z: number): Promise<LandHold | null> {
    return parse<LandHold>(await redis.get(cellKey(map, x, z)));
  },

  /** Whose tower a run toppled when it was raised, if it toppled somebody else's. */
  async tookFrom(
    map: string,
    sessionId: string
  ): Promise<{ username: string; score: number } | null> {
    return parse<{ username: string; score: number }>(await redis.get(tookKey(map, sessionId)));
  },

  /** Every held land cell, newest first. Stale index rows are dropped as they are found. */
  async landHolds(map: string): Promise<LandHold[]> {
    const index = landIndexKey(map);
    const rows = await redis.zRange(index, 0, LAND_INDEX_LIMIT - 1, {
      by: 'rank',
      reverse: true,
    });
    const members = (rows ?? []).map((r) => r.member);
    const cells = members.map((m) => parseCellKey(m));
    const holds = await readMany<LandHold>(
      cells.map((c, i) => (c ? cellKey(map, c.x, c.z) : `bad:${members[i]}`))
    );
    const out: LandHold[] = [];
    const stale: string[] = [];
    holds.forEach((h, i) => {
      if (h && Number.isInteger(h.x) && Number.isInteger(h.z)) out.push(h);
      else stale.push(members[i]!);
    });
    if (stale.length) await redis.zRem(index, stale);
    return out;
  },

  /** Keeps of everyone who has raised anything on this map, newest plot first. */
  async keeps(map: string): Promise<KeepRecord[]> {
    const rows = await redis.zRange(plotIndexKey(map), 0, PLOT_INDEX_LIMIT - 1, {
      by: 'rank',
      reverse: true,
    });
    const users = (rows ?? []).map((r) => r.member);
    const keeps = await readMany<KeepRecord>(users.map((u) => keepKey(map, u)));
    return keeps.filter((k): k is KeepRecord => !!k && Number.isInteger(k.rx));
  },

  /** What the reach rule is judged against: cached keeps, fresh holds. */
  async holdings(map: string): Promise<Holdings> {
    const cached = parse<KeepRecord[]>(await redis.get(boardKeepsKey(map)));
    const keeps = cached && (await this.isBoardFresh(map)) ? cached : await this.keeps(map);
    return { keeps, land: await this.landHolds(map) };
  },

  // --- Raising and toppling ----------------------------------------------------------------

  /**
   * Put a run on the grid.
   *
   * Every rejection here is an expected gameplay outcome rather than an error, so each returns
   * a reason the client can show. The take itself runs under WATCH on the cell, so two players
   * who beat the same bar in the same instant cannot both end up standing on it: the second
   * exec fails and is told who got there first.
   */
  async raise(
    map: string,
    userId: string,
    username: string,
    sessionId: string,
    gridX: number,
    gridZ: number
  ): Promise<RaiseResult> {
    if (!Number.isInteger(gridX) || !Number.isInteger(gridZ)) {
      return { ok: false, reason: 'Not a cell.' };
    }

    const run = await Runs.get(sessionId);
    if (!run) return { ok: false, reason: 'That run is gone.' };
    if (run.userId !== userId) return { ok: false, reason: 'Not your tower.' };

    const faction = await Users.faction(userId);
    // A tower flies the colour it was built under, and switching colours takes down everything
    // standing under the old one; a tower built before a switch would otherwise go up afterwards
    // in a colour its builder has left.
    if (run.faction && run.faction !== faction) {
      return { ok: false, reason: `Built under ${factionName(run.faction)}. That side is gone.` };
    }

    const region = await this.getOrAssignRegion(map, userId, username);
    const grid = (await this.getPlot(map, userId)) ?? emptyGrid(userId, username);
    grid.username = username;
    if (grid.placements.some((p) => p.sessionId === sessionId)) {
      return { ok: false, reason: 'Already standing.' };
    }

    const keepStacks = new Map<string, number>();
    for (const p of grid.placements) {
      if ((p.kind ?? 'keep') !== 'keep') continue;
      const k = cellName(p.gridX, p.gridZ);
      keepStacks.set(k, (keepStacks.get(k) ?? 0) + 1);
    }

    const kind = cellKind(gridX, gridZ);
    const holdings: Holdings = kind === 'land' ? await this.holdings(map) : { keeps: [], land: [] };
    const verdict = judgePlacement({
      x: gridX,
      z: gridZ,
      score: run.score,
      userId,
      faction,
      region,
      holdings,
      keepStacks,
      maxStack: MAX_STACK_PER_CELL,
      standing: grid.placements.length,
      maxStanding: MAX_PLACEMENTS_PER_PLAYER,
    });
    if (!verdict.ok) {
      return { ok: false, reason: verdict.reason, ...(verdict.bar ? { bar: verdict.bar } : {}) };
    }

    if (verdict.kind === 'keep') {
      grid.placements.push({
        sessionId,
        gridX,
        gridZ,
        stackIndex: verdict.stackOn,
        height: run.height,
        placedAt: Date.now(),
        kind: 'keep',
      });
      await this.savePlot(map, grid);
      await this.invalidateBoard(map);
      return { ok: true, grid, kind: 'keep' };
    }

    // Land. Take the cell under WATCH, then settle the plots.
    const key = cellKey(map, gridX, gridZ);
    const now = Date.now();
    const hold: LandHold = {
      x: gridX,
      z: gridZ,
      userId,
      username,
      faction,
      score: run.score,
      sessionId,
      placedAt: now,
    };

    let previous: LandHold | null = null;
    let won = false;
    for (let attempt = 0; attempt < 2 && !won; attempt++) {
      const tx = await redis.watch(key);
      previous = parse<LandHold>(await redis.get(key));
      if (previous && run.score <= previous.score) {
        await tx.unwatch();
        return {
          ok: false,
          reason: `Beat ${previous.score.toLocaleString()} to take it.`,
          bar: previous.score,
        };
      }
      try {
        await tx.multi();
        await tx.set(key, JSON.stringify(hold), { expiration: mapExpiry(map) });
        await tx.zAdd(landIndexKey(map), { member: `${gridX},${gridZ}`, score: now });
        await tx.exec();
      } catch {
        // A failed exec is a lost race; the re-read below decides.
      }
      const after = parse<LandHold>(await redis.get(key));
      won = after?.sessionId === sessionId;
    }
    if (!won) {
      const after = await this.getHold(map, gridX, gridZ);
      return {
        ok: false,
        reason: after ? `u/${after.username} got there first.` : 'Try that again.',
        ...(after ? { bar: after.score } : {}),
      };
    }

    const landIndex = landIndexKey(map);
    await redis.zRemRangeByRank(landIndex, 0, -(LAND_INDEX_LIMIT + 1));
    await redis.expire(landIndex, ttlSeconds(map));

    // The toppled tower comes off its owner's plot. When that owner is the raiser, it comes off
    // the same grid object before the new placement goes on.
    if (previous) {
      if (previous.userId === userId) {
        grid.placements = grid.placements.filter((p) => p.sessionId !== previous!.sessionId);
      } else {
        const theirs = await this.getPlot(map, previous.userId);
        if (theirs) {
          theirs.placements = theirs.placements.filter((p) => p.sessionId !== previous!.sessionId);
          await this.savePlot(map, theirs);
        }
      }
    }

    grid.placements.push({
      sessionId,
      gridX,
      gridZ,
      stackIndex: 0,
      height: run.height,
      placedAt: now,
      kind: 'land',
    });
    await this.savePlot(map, grid);
    await this.invalidateBoard(map);

    // Whose tower came down, as the server saw it, for the comment that may name them.
    if (previous && previous.userId !== userId) {
      await redis.set(
        tookKey(map, sessionId),
        JSON.stringify({ username: previous.username, score: previous.score }),
        { expiration: mapExpiry(map) }
      );
    }

    return previous
      ? {
          ok: true,
          grid,
          kind: 'take',
          took: {
            userId: previous.userId,
            username: previous.username,
            score: previous.score,
            faction: previous.faction,
          },
        }
      : { ok: true, grid, kind: 'claim' };
  },

  /** Take one of the caller's own towers down. */
  async remove(
    map: string,
    userId: string,
    sessionId: string
  ): Promise<{ ok: true; grid: PlayerGrid } | { ok: false; reason: string }> {
    const grid = await this.getPlot(map, userId);
    if (!grid) return { ok: false, reason: 'Nothing standing yet.' };
    const removed = grid.placements.find((p) => p.sessionId === sessionId);
    if (!removed) return { ok: false, reason: 'That tower is not yours.' };
    grid.placements = grid.placements.filter((p) => p.sessionId !== sessionId);

    if ((removed.kind ?? 'keep') === 'land') {
      await this.releaseHold(map, removed.gridX, removed.gridZ, sessionId);
    } else {
      // Close the gap in the cell's stack, so nothing above it is left floating.
      const same = grid.placements
        .filter((p) => p.gridX === removed.gridX && p.gridZ === removed.gridZ)
        .sort((a, b) => a.stackIndex - b.stackIndex);
      same.forEach((p, i) => {
        p.stackIndex = i;
      });
    }

    await this.savePlot(map, grid);
    await this.invalidateBoard(map);
    return { ok: true, grid };
  },

  /** Give up a land cell, if the tower standing there is still the one named. */
  async releaseHold(map: string, x: number, z: number, sessionId: string): Promise<void> {
    const hold = await this.getHold(map, x, z);
    if (hold?.sessionId !== sessionId) return;
    await redis.del(cellKey(map, x, z));
    await redis.zRem(landIndexKey(map), [`${x},${z}`]);
  },

  /**
   * Bring down everything a player has standing on this map: the price of changing sides.
   *
   * A colour is the only allegiance the game has, and reach is by colour, so a player who could
   * keep their towers while switching would hold ground for one side and build for another, and
   * could hop to whichever colour reaches deepest before every raise. Their keep stays theirs,
   * empty and in the new colour. Returns the session ids that came down, so the client can fell
   * them rather than have them blink out.
   */
  async raze(map: string, userId: string): Promise<string[]> {
    const grid = await this.getPlot(map, userId);
    if (!grid || grid.placements.length === 0) return [];
    for (const p of grid.placements) {
      if ((p.kind ?? 'keep') === 'land') await this.releaseHold(map, p.gridX, p.gridZ, p.sessionId);
    }
    const razed = grid.placements.map((p) => p.sessionId);
    grid.placements = [];
    // Saved empty rather than deleted: the plot stays in the index, so the keep stays on the map.
    await this.savePlot(map, grid);
    await this.invalidateBoard(map);
    return razed;
  },

  /** The keep flies its owner's current colour. */
  async recolourKeep(
    map: string,
    userId: string,
    username: string,
    faction: FactionId
  ): Promise<void> {
    const region = await this.getRegion(map, userId);
    if (!region) return;
    await this.writeKeep(map, userId, username, region, faction);
    await this.invalidateBoard(map);
  },

  /** Who held how much at the end of a day, for the closing line. */
  async standings(map: string): Promise<{
    ranked: Array<{ faction: FactionId; cells: number }>;
    builders: number;
    towers: number;
  }> {
    const { towers, keeps } = await this.board(map);
    const counts = landCountByFaction({ keeps, land: await this.landHolds(map) });
    const ranked = [...counts.entries()]
      .map(([faction, cells]) => ({ faction, cells }))
      .sort((a, b) => b.cells - a.cells);
    const builders = new Set(towers.map((t) => t.userId)).size;
    return { ranked, builders, towers: towers.length };
  },

  // --- The board ----------------------------------------------------------------------------

  /** Mark the board stale. The next read rebuilds it; readers never write. */
  async invalidateBoard(map: string): Promise<void> {
    const meta = boardMetaKey(map);
    await redis.hSet(meta, { stale: '1' });
    await redis.expire(meta, ttlSeconds(map));
  },

  async isBoardFresh(map: string): Promise<boolean> {
    const meta = (await redis.hGetAll(boardMetaKey(map))) ?? {};
    return meta.stale === '0' && !!meta.pages;
  },

  /**
   * The shared board: every tower the caps allow, plus the keeps.
   *
   * Rebuilt only when a placement changed it, and then served from pages.
   */
  async board(map: string): Promise<{ towers: TowerMapEntry[]; keeps: KeepRecord[] }> {
    const meta = (await redis.hGetAll(boardMetaKey(map))) ?? {};
    if (meta.stale !== '0' || !meta.pages) return this.rebuildBoard(map);

    const pages = Math.max(0, Number(meta.pages));
    const keys: string[] = [];
    for (let i = 0; i < pages; i++) keys.push(boardPageKey(map, i));
    keys.push(boardKeepsKey(map));
    const rows = await readMany<TowerMapEntry[] | KeepRecord[]>(keys);
    const towers: TowerMapEntry[] = [];
    for (let i = 0; i < pages; i++) {
      const page = rows[i] as TowerMapEntry[] | null;
      if (!page) return this.rebuildBoard(map);
      towers.push(...page);
    }
    return { towers, keeps: (rows[pages] as KeepRecord[] | null) ?? [] };
  },

  async rebuildBoard(map: string): Promise<{ towers: TowerMapEntry[]; keeps: KeepRecord[] }> {
    const towers: TowerMapEntry[] = [];
    let blocks = 0;
    const seen = new Set<string>();
    const expiration = mapExpiry(map);

    // Land first: a hold is what the map is about, and a claim at the edge of the world must
    // show up however many keep stacks are competing for the budget.
    const holds = await this.landHolds(map);
    const holdRuns = await Runs.getMany(holds.map((h) => h.sessionId));
    const orphaned: LandHold[] = [];
    holds.forEach((h, i) => {
      const run = holdRuns[i];
      if (!run) {
        orphaned.push(h);
        return;
      }
      if (towers.length >= BOARD_MAX_TOWERS) return;
      const withGeometry = blocks + run.towerBlocks.length <= BOARD_MAX_BLOCKS;
      if (withGeometry) blocks += run.towerBlocks.length;
      towers.push(entryFromRun(run, { gridX: h.x, gridZ: h.z }, 0, withGeometry));
      seen.add(run.sessionId);
    });
    if (orphaned.length) {
      await redis.zRem(
        landIndexKey(map),
        orphaned.map((h) => `${h.x},${h.z}`)
      );
      await redis.del(...orphaned.map((h) => cellKey(map, h.x, h.z)));
    }

    // Then keeps, newest plots first, until the caps.
    const rows = await redis.zRange(plotIndexKey(map), 0, PLOT_INDEX_LIMIT - 1, {
      by: 'rank',
      reverse: true,
    });
    const users = (rows ?? []).map((r) => r.member);
    const plots = await readMany<PlayerGrid>(users.map((u) => plotKey(map, u)));
    const keepRows = await readMany<KeepRecord>(users.map((u) => keepKey(map, u)));
    const keeps = keepRows.filter((k): k is KeepRecord => !!k && Number.isInteger(k.rx));

    // Gather keep placements, newest plots first, until the cap is in sight, then read every
    // run in one batch rather than one batch per plot.
    const keepPlacements: Array<{ plot: number; p: GridPlacement }> = [];
    plots.forEach((grid, plot) => {
      if (!grid || !Array.isArray(grid.placements)) return;
      if (keepPlacements.length >= BOARD_MAX_TOWERS) return;
      for (const p of grid.placements) {
        if ((p.kind ?? 'keep') === 'keep' && !seen.has(p.sessionId))
          keepPlacements.push({ plot, p });
      }
    });
    const keepRuns = await Runs.getMany(keepPlacements.map((k) => k.p.sessionId));
    const byCell = new Map<string, Array<{ p: GridPlacement; run: StoredRun }>>();
    const cellOrder: string[] = [];
    keepPlacements.forEach(({ plot, p }, i) => {
      const run = keepRuns[i];
      if (!run) return;
      const k = `${plot}:${cellName(p.gridX, p.gridZ)}`;
      const list = byCell.get(k);
      if (list) list.push({ p, run });
      else {
        byCell.set(k, [{ p, run }]);
        cellOrder.push(k);
      }
    });
    for (const k of cellOrder) {
      if (towers.length >= BOARD_MAX_TOWERS) break;
      const list = byCell.get(k)!;
      list.sort((a, b) => a.p.stackIndex - b.p.stackIndex);
      let base = 0;
      for (const { p, run } of list) {
        if (towers.length >= BOARD_MAX_TOWERS) break;
        const withGeometry = blocks + run.towerBlocks.length <= BOARD_MAX_BLOCKS;
        if (withGeometry) blocks += run.towerBlocks.length;
        towers.push(entryFromRun(run, p, base, withGeometry));
        seen.add(run.sessionId);
        base += p.height;
      }
    }

    const pages = Math.ceil(towers.length / BOARD_PAGE_SIZE);
    for (let i = 0; i < pages; i++) {
      await redis.set(
        boardPageKey(map, i),
        JSON.stringify(towers.slice(i * BOARD_PAGE_SIZE, (i + 1) * BOARD_PAGE_SIZE)),
        { expiration }
      );
    }
    // Clear the page that used to be last, so a shrinking board cannot serve a stale tail.
    const metaKey = boardMetaKey(map);
    const before = Number((await redis.hGetAll(metaKey))?.pages ?? 0);
    for (let i = pages; i < before; i++) await redis.del(boardPageKey(map, i));
    await redis.set(boardKeepsKey(map), JSON.stringify(keeps), { expiration });

    await redis.hSet(metaKey, {
      stale: '0',
      pages: String(pages),
      towers: String(towers.length),
      builtAt: String(Date.now()),
    });
    await redis.expire(metaKey, ttlSeconds(map));
    return { towers, keeps };
  },
};
