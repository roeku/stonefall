import { redis } from '@devvit/web/server';
import type {
  GridPlacement,
  PlayerGrid,
  PlayerRegion,
  TowerBlock,
  TowerMapEntry,
} from '../../shared/types/api';
import { MAX_PLACEMENTS_PER_PLAYER } from '../../shared/constants/towers';
import { MAX_STACK_PER_CELL } from '../../shared/types/towerPlacement';
import {
  isCellInRegion,
  REGION_RADIUS,
  regionCenterCell,
  regionCoordForIndex,
  type RegionCoord,
} from '../../shared/types/worldGrid';

/**
 * A player's home grid: where they've chosen to put the towers they've built.
 *
 * Stored as a placement list, never as geometry. Each entry references a tower that already
 * lives under `tower:{sessionId}`, so a full grid is a few kilobytes at most no matter how big
 * the towers are. This is the shape that keeps Redis proportional to the number of players
 * rather than the number of games played.
 *
 * All placement rules are enforced here rather than on the client. The client mirrors them for
 * responsiveness, but this is the authority -- a hand-rolled request cannot place a tower it
 * doesn't own, exceed the stack cap, or drop something outside the grid.
 */
export class PlayerGridService {
  private static readonly KEYS = {
    grid: (userId: string) => `grid:${userId}`,
    /** The region index this player owns, allocated once and never reused. */
    region: (userId: string) => `user:${userId}:region`,
    /** Monotonic allocator. Its value is the next unclaimed region index. */
    nextRegion: 'counters:next_region',
  };

  /**
   * The region a player builds in, allocating one on first use.
   *
   * Allocation is a Redis INCR rather than a hash of the user id: hashing would eventually
   * hand two players the same patch and silently interleave their builds. INCR gives each
   * caller a distinct index even under concurrent first-placements, and the spiral packing
   * turns that index into a position that keeps the built area dense.
   *
   * Once assigned the index is permanent -- a player's region is where their structure lives,
   * and moving it would break every coordinate anyone has shared.
   */
  static async getOrAssignRegion(userId: string): Promise<RegionCoord> {
    const existing = await redis.get(this.KEYS.region(userId));
    if (existing !== null && existing !== undefined && existing !== '') {
      const index = parseInt(existing, 10);
      if (Number.isInteger(index) && index >= 0) {
        return regionCoordForIndex(index);
      }
    }

    // incrBy returns the value *after* incrementing, so the first caller gets 1. Subtracting
    // one keeps index 0 (the centre region) in use rather than stranding it.
    const next = (await redis.incrBy(this.KEYS.nextRegion, 1)) - 1;
    await redis.set(this.KEYS.region(userId), next.toString());
    return regionCoordForIndex(next);
  }

  /**
   * Region in the shape the client needs: where it sits in global cells and how far it extends.
   *
   * The client uses this both to frame the camera on "my area" and to grey out cells it must
   * not offer, so it mirrors the same bounds the server enforces on placement.
   */
  static describeRegion(region: RegionCoord): PlayerRegion {
    const center = regionCenterCell(region);
    return {
      rx: region.rx,
      rz: region.rz,
      centerX: center.x,
      centerZ: center.z,
      radius: REGION_RADIUS,
    };
  }

  /** Read a player's region without allocating one. Null when they have never placed. */
  static async getRegion(userId: string): Promise<RegionCoord | null> {
    const existing = await redis.get(this.KEYS.region(userId));
    if (!existing) return null;
    const index = parseInt(existing, 10);
    return Number.isInteger(index) && index >= 0 ? regionCoordForIndex(index) : null;
  }

  /** Cell key used for stack grouping. */
  private static cellKey(gridX: number, gridZ: number): string {
    return `${gridX},${gridZ}`;
  }

  /**
   * Vertical extent of a tower.
   *
   * Derived from the geometry rather than the block count: blocks vary in height and a trimmed
   * tower is shorter than its block count implies. Falls back to 0, which stacks the tower flush
   * with its neighbour rather than floating it.
   *
   * UNITS: returned in the same fixed-point scale as the block coordinates it reads (1000 = one
   * world unit). Renderers divide by 1000, as they already do for block positions.
   */
  static measureTowerHeight(blocks: readonly TowerBlock[] | undefined): number {
    if (!Array.isArray(blocks) || blocks.length === 0) {
      return 0;
    }
    let top = 0;
    for (const block of blocks) {
      const blockTop = (block?.y ?? 0) + (block?.height ?? 0);
      if (Number.isFinite(blockTop) && blockTop > top) {
        top = blockTop;
      }
    }
    return top;
  }

  static async getGrid(userId: string): Promise<PlayerGrid | null> {
    const raw = await redis.get(this.KEYS.grid(userId));
    if (!raw) return null;
    try {
      const grid = JSON.parse(raw) as PlayerGrid;
      if (!Array.isArray(grid.placements)) return null;
      return grid;
    } catch (e) {
      console.warn(`[grid] Unparseable grid for ${userId}:`, e);
      return null;
    }
  }

  private static async saveGrid(grid: PlayerGrid): Promise<void> {
    await redis.set(this.KEYS.grid(grid.userId), JSON.stringify(grid));
  }

  private static emptyGrid(userId: string, username: string): PlayerGrid {
    return { userId, username, placements: [], updatedAt: Date.now() };
  }

  /**
   * Load the tower behind a session id, confirming the caller owns it.
   *
   * Ownership is checked against the stored tower rather than trusted from the request, so a
   * player cannot place someone else's build on their grid.
   */
  private static async loadOwnedTower(
    sessionId: string,
    userId: string
  ): Promise<{ tower: TowerMapEntry } | { error: string }> {
    const raw = await redis.hGet(`tower:${sessionId}`, 'data');
    if (!raw) {
      return { error: 'That tower no longer exists.' };
    }

    let tower: TowerMapEntry;
    try {
      tower = JSON.parse(raw) as TowerMapEntry;
    } catch {
      return { error: 'That tower could not be read.' };
    }

    if (tower.userId !== userId) {
      return { error: 'You can only place your own towers.' };
    }

    return { tower };
  }

  /**
   * Place one of the player's towers at a cell, stacking on whatever is already there.
   *
   * Returns the updated grid so the client can re-render from the authoritative state instead
   * of guessing at the result.
   */
  static async placeTower(
    userId: string,
    username: string,
    sessionId: string,
    gridX: number,
    gridZ: number
  ): Promise<{ success: true; grid: PlayerGrid } | { success: false; message: string }> {
    if (!Number.isInteger(gridX) || !Number.isInteger(gridZ)) {
      return { success: false, message: 'Invalid cell coordinates.' };
    }

    // Coordinates are global now, so the bounds check is "inside the region you own" rather
    // than "inside a private grid". This is the only thing stopping a hand-rolled request from
    // dropping a tower in someone else's build, so it is enforced here and not just in the UI.
    const region = await this.getOrAssignRegion(userId);
    if (!isCellInRegion(region, gridX, gridZ)) {
      return { success: false, message: 'That cell is outside your area.' };
    }

    const owned = await this.loadOwnedTower(sessionId, userId);
    if ('error' in owned) {
      return { success: false, message: owned.error };
    }

    const grid = (await this.getGrid(userId)) ?? this.emptyGrid(userId, username);

    if (grid.placements.some((p) => p.sessionId === sessionId)) {
      return { success: false, message: 'That tower is already on your grid.' };
    }

    if (grid.placements.length >= MAX_PLACEMENTS_PER_PLAYER) {
      return {
        success: false,
        message: `Your grid is full (${MAX_PLACEMENTS_PER_PLAYER} towers). Remove one to place another.`,
      };
    }

    const cell = this.cellKey(gridX, gridZ);
    const inCell = grid.placements.filter((p) => this.cellKey(p.gridX, p.gridZ) === cell);
    if (inCell.length >= MAX_STACK_PER_CELL) {
      return { success: false, message: `You can stack at most ${MAX_STACK_PER_CELL} towers here.` };
    }

    const placement: GridPlacement = {
      sessionId,
      gridX,
      gridZ,
      // New towers land on top of the existing stack.
      stackIndex: inCell.length,
      height: this.measureTowerHeight(owned.tower.towerBlocks),
      placedAt: Date.now(),
    };

    grid.placements.push(placement);
    grid.username = username;
    grid.updatedAt = Date.now();
    await this.saveGrid(grid);

    return { success: true, grid };
  }

  /**
   * Take a tower off the grid, closing the gap it leaves.
   *
   * Anything that was stacked above it drops down, so removing from the middle of a stack can't
   * leave floating towers.
   */
  static async removePlacement(
    userId: string,
    sessionId: string
  ): Promise<{ success: true; grid: PlayerGrid } | { success: false; message: string }> {
    const grid = await this.getGrid(userId);
    if (!grid) {
      return { success: false, message: 'You have no grid yet.' };
    }

    const target = grid.placements.find((p) => p.sessionId === sessionId);
    if (!target) {
      return { success: false, message: 'That tower is not on your grid.' };
    }

    const cell = this.cellKey(target.gridX, target.gridZ);
    grid.placements = grid.placements.filter((p) => p.sessionId !== sessionId);

    // Re-index the affected column so stackIndex stays contiguous from 0.
    grid.placements
      .filter((p) => this.cellKey(p.gridX, p.gridZ) === cell)
      .sort((a, b) => a.stackIndex - b.stackIndex)
      .forEach((p, index) => {
        p.stackIndex = index;
      });

    grid.updatedAt = Date.now();
    await this.saveGrid(grid);

    return { success: true, grid };
  }

  /**
   * Resolve a grid's placements into the towers they point at.
   *
   * Placements can outlive their towers -- a non-personal-best tower expires after the
   * retention window while the grid entry remains. Those are skipped and pruned, so a stale
   * entry self-heals rather than rendering a hole.
   */
  static async resolveGrid(
    userId: string
  ): Promise<{ grid: PlayerGrid | null; towers: TowerMapEntry[] }> {
    const grid = await this.getGrid(userId);
    if (!grid || grid.placements.length === 0) {
      return { grid, towers: [] };
    }

    const towers: TowerMapEntry[] = [];
    const live: GridPlacement[] = [];

    // Base offsets are computed from the surviving placements per cell, in stack order, so a
    // tower whose neighbour below has expired settles downward instead of hovering over a gap.
    const byCell = new Map<string, GridPlacement[]>();

    for (const placement of grid.placements) {
      const raw = await redis.hGet(`tower:${placement.sessionId}`, 'data');
      if (!raw) continue;
      try {
        const tower = JSON.parse(raw) as TowerMapEntry;
        tower.gridX = placement.gridX;
        tower.gridZ = placement.gridZ;
        towers.push(tower);
        live.push(placement);

        const cell = this.cellKey(placement.gridX, placement.gridZ);
        const bucket = byCell.get(cell);
        if (bucket) bucket.push(placement);
        else byCell.set(cell, [placement]);
      } catch {
        // Unreadable tower: drop the placement along with it.
      }
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

    for (const tower of towers) {
      const baseY = baseBySession.get(tower.sessionId) ?? 0;
      if (baseY > 0) {
        tower.stackBaseY = baseY;
      }
    }

    if (live.length !== grid.placements.length) {
      grid.placements = live;
      grid.updatedAt = Date.now();
      await this.saveGrid(grid);
    }

    return { grid, towers };
  }

  /** Remove a player's grid entirely. Used by the user-data deletion path. */
  static async deleteGrid(userId: string): Promise<void> {
    await redis.del(this.KEYS.grid(userId));
    // The region assignment goes too -- it is a record of where this user built. The index is
    // deliberately not returned to the allocator: reusing it would drop a new player into a
    // patch that other people's shared coordinates still point at.
    await redis.del(this.KEYS.region(userId));
  }
}
