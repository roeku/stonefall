import { redis } from '@devvit/web/server';
import type { GridPlacement, PlayerGrid, PlayerRegion, TowerMapEntry } from '../../shared/types/api';
import { MAX_PLACEMENTS_PER_PLAYER } from '../../shared/constants/towers';
import { MAX_STACK_PER_CELL } from '../../shared/types/towerPlacement';
import {
  cellToWorld,
  isCellInRegion,
  REGION_RADIUS,
  regionCenterCell,
  regionCoordForIndex,
  type RegionCoord,
} from '../../shared/types/worldGrid';
import {
  BOARD_MAX_BLOCKS,
  BOARD_MAX_TOWERS,
  BOARD_META,
  BOARD_PAGE_SIZE,
  NEXT_REGION,
  PLOT_INDEX,
  PLOT_INDEX_LIMIT,
  boardPageKey,
  plotKey,
  regionKey,
} from './keys';
import { Runs } from './runs';

/**
 * Plots: where each player's towers stand, and the board everyone sees.
 *
 * The placement rules here are unchanged and were never the problem: a placement list that
 * references runs by id keeps Redis proportional to the number of players rather than the number
 * of games played, and ownership, bounds and the stack cap are all enforced server-side.
 *
 * What is new is how the board is read. It used to be assembled per request: fetch four hundred
 * player ids, resolve each player's plot in a serial loop, and inside that issue one hash read
 * per placement -- up to twenty thousand sequential Redis calls, every player's full block
 * geometry in a single response, for every viewer who opened the post. It also wrote back to
 * Redis during that read, so concurrent viewers raced each other over the same rows, and its
 * index range was not reversed, which meant that past four hundred players it returned the four
 * hundred *stalest* plots and nobody new ever appeared on the board.
 *
 * The board is now built when it changes and read as a few fixed pages. A viewer costs the same
 * handful of reads whether there are ten players or ten thousand, reads never write, and the
 * pages are capped by block count as well as tower count so a response cannot outgrow its limit.
 */

const cellKey = (x: number, z: number): string => `${x},${z}`;

const emptyGrid = (userId: string, username: string): PlayerGrid => ({
  userId,
  username,
  placements: [],
  updatedAt: Date.now(),
});

export const Plots = {
  /**
   * The region a player builds in, allocating one on first use.
   *
   * An INCR allocator rather than a hash of the user id: hashing would eventually hand two
   * players the same patch and interleave their builds. Once assigned it is permanent, because a
   * player's region is where their structure lives.
   */
  async getOrAssignRegion(userId: string): Promise<RegionCoord> {
    const existing = await redis.get(regionKey(userId));
    if (existing) {
      const index = parseInt(existing, 10);
      if (Number.isInteger(index) && index >= 0) return regionCoordForIndex(index);
    }
    // incrBy returns the value after incrementing, so subtracting one keeps index 0 in use.
    const next = (await redis.incrBy(NEXT_REGION, 1)) - 1;
    await redis.set(regionKey(userId), String(next));
    return regionCoordForIndex(next);
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

  async getPlot(userId: string): Promise<PlayerGrid | null> {
    const raw = await redis.get(plotKey(userId));
    if (!raw) return null;
    try {
      const parsed = JSON.parse(raw) as PlayerGrid;
      return Array.isArray(parsed.placements) ? parsed : null;
    } catch {
      return null;
    }
  },

  async savePlot(grid: PlayerGrid): Promise<void> {
    grid.updatedAt = Date.now();
    await redis.set(plotKey(grid.userId), JSON.stringify(grid));
    await redis.zAdd(PLOT_INDEX, { member: grid.userId, score: grid.updatedAt });
    await redis.zRemRangeByRank(PLOT_INDEX, 0, -(PLOT_INDEX_LIMIT + 1));
  },

  /**
   * Put a run on the grid.
   *
   * Every rejection here is an expected gameplay outcome rather than an error, so each returns
   * a reason the client can show.
   */
  async place(
    userId: string,
    username: string,
    sessionId: string,
    gridX: number,
    gridZ: number
  ): Promise<{ ok: true; grid: PlayerGrid } | { ok: false; reason: string }> {
    if (!Number.isInteger(gridX) || !Number.isInteger(gridZ)) {
      return { ok: false, reason: 'That is not a cell.' };
    }

    const run = await Runs.get(sessionId);
    if (!run) return { ok: false, reason: 'That run has expired.' };
    if (run.userId !== userId) return { ok: false, reason: 'That is not your tower.' };

    const region = await this.getOrAssignRegion(userId);
    if (!isCellInRegion(region, gridX, gridZ)) {
      return { ok: false, reason: 'That cell belongs to someone else.' };
    }

    const grid = (await this.getPlot(userId)) ?? emptyGrid(userId, username);
    grid.username = username;

    if (grid.placements.some((p) => p.sessionId === sessionId)) {
      return { ok: false, reason: 'That tower is already standing.' };
    }
    if (grid.placements.length >= MAX_PLACEMENTS_PER_PLAYER) {
      return { ok: false, reason: 'Your plot is full. Remove one to place another.' };
    }

    const inCell = grid.placements.filter((p) => p.gridX === gridX && p.gridZ === gridZ);
    if (inCell.length >= MAX_STACK_PER_CELL) {
      return { ok: false, reason: `That cell is full (${MAX_STACK_PER_CELL} max).` };
    }

    grid.placements.push({
      sessionId,
      gridX,
      gridZ,
      stackIndex: inCell.length,
      height: run.height,
      placedAt: Date.now(),
    });

    await this.savePlot(grid);
    await Runs.countColor(run.colorChoice, 1);
    await this.invalidateBoard();
    return { ok: true, grid };
  },

  async remove(
    userId: string,
    sessionId: string
  ): Promise<{ ok: true; grid: PlayerGrid } | { ok: false; reason: string }> {
    const grid = await this.getPlot(userId);
    if (!grid) return { ok: false, reason: 'Nothing placed yet.' };
    const before = grid.placements.length;
    const removed = grid.placements.find((p) => p.sessionId === sessionId);
    grid.placements = grid.placements.filter((p) => p.sessionId !== sessionId);
    if (grid.placements.length === before) {
      return { ok: false, reason: 'That tower is not on your plot.' };
    }

    // Close the gap in the cell's stack, so nothing above it is left floating.
    if (removed) {
      const same = grid.placements
        .filter((p) => p.gridX === removed.gridX && p.gridZ === removed.gridZ)
        .sort((a, b) => a.stackIndex - b.stackIndex);
      same.forEach((p, i) => {
        p.stackIndex = i;
      });
      const run = await Runs.get(sessionId);
      await Runs.countColor(run?.colorChoice ?? null, -1);
    }

    await this.savePlot(grid);
    await this.invalidateBoard();
    return { ok: true, grid };
  },

  /**
   * Turn one player's placements into the entries the client draws.
   *
   * `stackBaseY` is the summed height of everything below a tower in its cell, so a stacked
   * tower sits on the one under it rather than through it.
   */
  async resolvePlot(grid: PlayerGrid): Promise<TowerMapEntry[]> {
    const byCell = new Map<string, GridPlacement[]>();
    for (const p of grid.placements) {
      const key = cellKey(p.gridX, p.gridZ);
      const list = byCell.get(key);
      if (list) list.push(p);
      else byCell.set(key, [p]);
    }

    const out: TowerMapEntry[] = [];
    for (const list of byCell.values()) {
      list.sort((a, b) => a.stackIndex - b.stackIndex);
      let base = 0;
      for (const p of list) {
        const run = await Runs.get(p.sessionId);
        if (!run) continue;
        out.push({
          sessionId: run.sessionId,
          userId: run.userId,
          username: run.username,
          score: run.score,
          blockCount: run.blockCount,
          perfectStreak: run.perfectCount,
          maxCombo: run.maxCombo,
          gameMode: run.gameMode,
          timestamp: run.createdAt,
          towerBlocks: run.towerBlocks,
          playerColorChoice: run.colorChoice,
          gridX: p.gridX,
          gridZ: p.gridZ,
          worldX: cellToWorld(p.gridX),
          worldZ: cellToWorld(p.gridZ),
          stackBaseY: base,
        });
        base += p.height;
      }
    }
    return out;
  },

  /** Mark the board stale. The next read rebuilds it; readers never write. */
  async invalidateBoard(): Promise<void> {
    await redis.hSet(BOARD_META, { stale: '1' });
  },

  /**
   * The community board.
   *
   * Rebuilt only when a placement changed it, and then served from pages. The rebuild is the
   * expensive walk the old code did on every request; doing it on write means the cost scales
   * with how often people place towers, not with how often anyone looks.
   */
  async board(): Promise<TowerMapEntry[]> {
    const meta = (await redis.hGetAll(BOARD_META)) ?? {};
    if (meta.stale !== '0' || !meta.pages) return this.rebuildBoard();

    const pages = Math.max(0, Number(meta.pages));
    const out: TowerMapEntry[] = [];
    for (let i = 0; i < pages; i++) {
      const raw = await redis.get(boardPageKey(i));
      if (!raw) return this.rebuildBoard();
      try {
        out.push(...(JSON.parse(raw) as TowerMapEntry[]));
      } catch {
        return this.rebuildBoard();
      }
    }
    return out;
  },

  async rebuildBoard(): Promise<TowerMapEntry[]> {
    // Newest plots first, and capped. The old range was ascending, so once there were more
    // players than the limit the board froze on the oldest of them.
    const rows = await redis.zRange(PLOT_INDEX, 0, PLOT_INDEX_LIMIT - 1, {
      by: 'rank',
      reverse: true,
    });

    const towers: TowerMapEntry[] = [];
    let blocks = 0;
    for (const row of rows ?? []) {
      if (towers.length >= BOARD_MAX_TOWERS || blocks >= BOARD_MAX_BLOCKS) break;
      const grid = await this.getPlot(row.member);
      if (!grid) continue;
      for (const entry of await this.resolvePlot(grid)) {
        if (towers.length >= BOARD_MAX_TOWERS || blocks >= BOARD_MAX_BLOCKS) break;
        towers.push(entry);
        blocks += entry.towerBlocks.length;
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

    await redis.hSet(BOARD_META, {
      stale: '0',
      pages: String(pages),
      towers: String(towers.length),
      builtAt: String(Date.now()),
    });
    return towers;
  },
};
