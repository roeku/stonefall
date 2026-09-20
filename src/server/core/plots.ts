import { redis } from '@devvit/web/server';
import type {
  GridPlacement,
  PlayerGrid,
  PlayerRegion,
  RaiseKind,
  TowerMapEntry,
} from '../../shared/types/api';
import type { FactionId } from '../../shared/types/factions';
import { MAX_PLACEMENTS_PER_PLAYER } from '../../shared/constants/towers';
import { MAX_STACK_PER_CELL } from '../../shared/types/towerPlacement';
import {
  cellKey as cellName,
  cellKind,
  judgePlacement,
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
  BOARD_KEEPS,
  BOARD_MAX_BLOCKS,
  BOARD_MAX_TOWERS,
  BOARD_META,
  BOARD_PAGE_SIZE,
  LAND_INDEX,
  LAND_INDEX_LIMIT,
  NEXT_REGION,
  PLOT_INDEX,
  PLOT_INDEX_LIMIT,
  boardPageKey,
  cellKey,
  keepKey,
  plotKey,
  regionKey,
  regionOwnerKey,
} from './keys';
import { Runs, type StoredRun } from './runs';
import { Users } from './users';

/**
 * Plots: where each player's towers stand, who holds which cell, and the board everyone sees.
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
   * The region a player builds in, allocating one on first use.
   *
   * An INCR allocator rather than a hash of the user id: hashing would eventually hand two
   * players the same patch and interleave their builds. Once assigned it is permanent, because
   * a player's keep is where their structure lives. Assigned when a run starts, not when the
   * post is opened, so the map is packed with people who play rather than people who looked.
   */
  async getOrAssignRegion(userId: string, username: string): Promise<RegionCoord> {
    const existing = await this.getRegion(userId);
    if (existing) {
      // A keep row is what puts the keep on the map; make sure one exists for older regions.
      if (!(await redis.get(keepKey(userId)))) await this.writeKeep(userId, username, existing);
      return existing;
    }
    // incrBy returns the value after incrementing, so subtracting one keeps index 0 in use.
    const next = (await redis.incrBy(NEXT_REGION, 1)) - 1;
    const region = regionCoordForIndex(next);
    await redis.set(regionKey(userId), String(next));
    await redis.set(regionOwnerKey(region.rx, region.rz), userId);
    await this.writeKeep(userId, username, region);
    return region;
  },

  async writeKeep(userId: string, username: string, region: RegionCoord): Promise<KeepRecord> {
    const center = regionCenterCell(region);
    const keep: KeepRecord = {
      userId,
      username,
      faction: await Users.faction(userId),
      rx: region.rx,
      rz: region.rz,
      centerX: center.x,
      centerZ: center.z,
    };
    await redis.set(keepKey(userId), JSON.stringify(keep));
    return keep;
  },

  async getRegion(userId: string): Promise<RegionCoord | null> {
    const existing = await redis.get(regionKey(userId));
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

  async getPlot(userId: string): Promise<PlayerGrid | null> {
    const parsed = parse<PlayerGrid>(await redis.get(plotKey(userId)));
    return parsed && Array.isArray(parsed.placements) ? parsed : null;
  },

  async savePlot(grid: PlayerGrid): Promise<void> {
    grid.updatedAt = Date.now();
    await redis.set(plotKey(grid.userId), JSON.stringify(grid));
    await redis.zAdd(PLOT_INDEX, { member: grid.userId, score: grid.updatedAt });
    await redis.zRemRangeByRank(PLOT_INDEX, 0, -(PLOT_INDEX_LIMIT + 1));
  },

  // --- Holds --------------------------------------------------------------------------------

  async getHold(x: number, z: number): Promise<LandHold | null> {
    return parse<LandHold>(await redis.get(cellKey(x, z)));
  },

  /** Every held land cell, newest first. Stale index rows are dropped as they are found. */
  async landHolds(): Promise<LandHold[]> {
    const rows = await redis.zRange(LAND_INDEX, 0, LAND_INDEX_LIMIT - 1, {
      by: 'rank',
      reverse: true,
    });
    const members = (rows ?? []).map((r) => r.member);
    const keys = members.map((m) => `cell:${m}`);
    const holds = await readMany<LandHold>(keys);
    const out: LandHold[] = [];
    const stale: string[] = [];
    holds.forEach((h, i) => {
      if (h && Number.isInteger(h.x) && Number.isInteger(h.z)) out.push(h);
      else stale.push(members[i]!);
    });
    if (stale.length) await redis.zRem(LAND_INDEX, stale);
    return out;
  },

  /** Keeps of everyone who has raised anything, newest plot first. */
  async keeps(): Promise<KeepRecord[]> {
    const rows = await redis.zRange(PLOT_INDEX, 0, PLOT_INDEX_LIMIT - 1, {
      by: 'rank',
      reverse: true,
    });
    const users = (rows ?? []).map((r) => r.member);
    const keeps = await readMany<KeepRecord>(users.map(keepKey));
    return keeps.filter((k): k is KeepRecord => !!k && Number.isInteger(k.rx));
  },

  /** What the reach rule is judged against: cached keeps, fresh holds. */
  async holdings(): Promise<Holdings> {
    const cached = parse<KeepRecord[]>(await redis.get(BOARD_KEEPS));
    const keeps = cached && (await this.isBoardFresh()) ? cached : await this.keeps();
    return { keeps, land: await this.landHolds() };
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

    const region = await this.getOrAssignRegion(userId, username);
    const faction = await Users.faction(userId);
    const grid = (await this.getPlot(userId)) ?? emptyGrid(userId, username);
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
    const holdings: Holdings = kind === 'land' ? await this.holdings() : { keeps: [], land: [] };
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
      await this.savePlot(grid);
      await this.invalidateBoard();
      return { ok: true, grid, kind: 'keep' };
    }

    // Land. Take the cell under WATCH, then settle the plots.
    const key = cellKey(gridX, gridZ);
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
        await tx.set(key, JSON.stringify(hold));
        await tx.zAdd(LAND_INDEX, { member: `${gridX},${gridZ}`, score: now });
        await tx.exec();
      } catch {
        // A failed exec is a lost race; the re-read below decides.
      }
      const after = parse<LandHold>(await redis.get(key));
      won = after?.sessionId === sessionId;
    }
    if (!won) {
      const after = await this.getHold(gridX, gridZ);
      return {
        ok: false,
        reason: after ? `u/${after.username} got there first.` : 'Try that again.',
        ...(after ? { bar: after.score } : {}),
      };
    }

    await redis.zRemRangeByRank(LAND_INDEX, 0, -(LAND_INDEX_LIMIT + 1));

    // The toppled tower comes off its owner's plot. When that owner is the raiser, it comes off
    // the same grid object before the new placement goes on.
    if (previous) {
      if (previous.userId === userId) {
        grid.placements = grid.placements.filter((p) => p.sessionId !== previous!.sessionId);
      } else {
        const theirs = await this.getPlot(previous.userId);
        if (theirs) {
          theirs.placements = theirs.placements.filter((p) => p.sessionId !== previous!.sessionId);
          await this.savePlot(theirs);
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
    await this.savePlot(grid);
    await this.invalidateBoard();

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
    userId: string,
    sessionId: string
  ): Promise<{ ok: true; grid: PlayerGrid } | { ok: false; reason: string }> {
    const grid = await this.getPlot(userId);
    if (!grid) return { ok: false, reason: 'Nothing standing yet.' };
    const removed = grid.placements.find((p) => p.sessionId === sessionId);
    if (!removed) return { ok: false, reason: 'That tower is not yours.' };
    grid.placements = grid.placements.filter((p) => p.sessionId !== sessionId);

    if ((removed.kind ?? 'keep') === 'land') {
      const hold = await this.getHold(removed.gridX, removed.gridZ);
      if (hold?.sessionId === sessionId) {
        await redis.del(cellKey(removed.gridX, removed.gridZ));
        await redis.zRem(LAND_INDEX, [`${removed.gridX},${removed.gridZ}`]);
      }
    } else {
      // Close the gap in the cell's stack, so nothing above it is left floating.
      const same = grid.placements
        .filter((p) => p.gridX === removed.gridX && p.gridZ === removed.gridZ)
        .sort((a, b) => a.stackIndex - b.stackIndex);
      same.forEach((p, i) => {
        p.stackIndex = i;
      });
    }

    await this.savePlot(grid);
    await this.invalidateBoard();
    return { ok: true, grid };
  },

  // --- The board ----------------------------------------------------------------------------

  /** Mark the board stale. The next read rebuilds it; readers never write. */
  async invalidateBoard(): Promise<void> {
    await redis.hSet(BOARD_META, { stale: '1' });
  },

  async isBoardFresh(): Promise<boolean> {
    const meta = (await redis.hGetAll(BOARD_META)) ?? {};
    return meta.stale === '0' && !!meta.pages;
  },

  /**
   * The shared board: every tower the caps allow, plus the keeps.
   *
   * Rebuilt only when a placement changed it, and then served from pages.
   */
  async board(): Promise<{ towers: TowerMapEntry[]; keeps: KeepRecord[] }> {
    const meta = (await redis.hGetAll(BOARD_META)) ?? {};
    if (meta.stale !== '0' || !meta.pages) return this.rebuildBoard();

    const pages = Math.max(0, Number(meta.pages));
    const keys: string[] = [];
    for (let i = 0; i < pages; i++) keys.push(boardPageKey(i));
    keys.push(BOARD_KEEPS);
    const rows = await readMany<TowerMapEntry[] | KeepRecord[]>(keys);
    const towers: TowerMapEntry[] = [];
    for (let i = 0; i < pages; i++) {
      const page = rows[i] as TowerMapEntry[] | null;
      if (!page) return this.rebuildBoard();
      towers.push(...page);
    }
    return { towers, keeps: (rows[pages] as KeepRecord[] | null) ?? [] };
  },

  async rebuildBoard(): Promise<{ towers: TowerMapEntry[]; keeps: KeepRecord[] }> {
    const towers: TowerMapEntry[] = [];
    let blocks = 0;
    const seen = new Set<string>();

    // Land first: a hold is what the map is about, and a claim at the edge of the world must
    // show up however many keep stacks are competing for the budget.
    const holds = await this.landHolds();
    const holdRuns = await Runs.getMany(holds.map((h) => h.sessionId));
    const orphaned: string[] = [];
    holds.forEach((h, i) => {
      const run = holdRuns[i];
      if (!run) {
        orphaned.push(`${h.x},${h.z}`);
        return;
      }
      if (towers.length >= BOARD_MAX_TOWERS) return;
      const withGeometry = blocks + run.towerBlocks.length <= BOARD_MAX_BLOCKS;
      if (withGeometry) blocks += run.towerBlocks.length;
      towers.push(entryFromRun(run, { gridX: h.x, gridZ: h.z }, 0, withGeometry));
      seen.add(run.sessionId);
    });
    if (orphaned.length) {
      await redis.zRem(LAND_INDEX, orphaned);
      await redis.del(...orphaned.map((m) => `cell:${m}`));
    }

    // Then keeps, newest plots first, until the caps.
    const rows = await redis.zRange(PLOT_INDEX, 0, PLOT_INDEX_LIMIT - 1, {
      by: 'rank',
      reverse: true,
    });
    const users = (rows ?? []).map((r) => r.member);
    const plots = await readMany<PlayerGrid>(users.map(plotKey));
    const keepRows = await readMany<KeepRecord>(users.map(keepKey));
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
        boardPageKey(i),
        JSON.stringify(towers.slice(i * BOARD_PAGE_SIZE, (i + 1) * BOARD_PAGE_SIZE))
      );
    }
    // Clear the page that used to be last, so a shrinking board cannot serve a stale tail.
    const before = Number((await redis.hGetAll(BOARD_META))?.pages ?? 0);
    for (let i = pages; i < before; i++) await redis.del(boardPageKey(i));
    await redis.set(BOARD_KEEPS, JSON.stringify(keeps));

    await redis.hSet(BOARD_META, {
      stale: '0',
      pages: String(pages),
      towers: String(towers.length),
      builtAt: String(Date.now()),
    });
    return { towers, keeps };
  },
};
