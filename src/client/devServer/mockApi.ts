import type { Connect, Plugin } from 'vite';
import type {
  GridPlacement,
  PlayerGrid,
  PlayerRegion,
  TowerMapEntry,
} from '../../shared/types/api';
import {
  cellToWorld,
  isCellInRegion,
  REGION_RADIUS,
  regionCenterCell,
  regionCoordForIndex,
} from '../../shared/types/worldGrid';
import { MAX_STACK_PER_CELL } from '../../shared/types/towerPlacement';
import { MAX_PLACEMENTS_PER_PLAYER } from '../../shared/constants/towers';

/**
 * In-memory stand-in for the Devvit server, so the real client can be played in a browser.
 *
 * The point is to be able to *see* a change work. Every failure this codebase hit recently
 * shared a shape: the code compiled, type-checked, passed tests and was fully reachable, and
 * still did nothing visible, because verifying a build is not the same as verifying the app.
 * Playtesting through Devvit needs auth, an upload and a subreddit; this needs a browser tab.
 *
 * It deliberately reuses the *real* rules from `shared/` -- region bounds, stack caps,
 * coordinate conversion -- so behaviour here matches production. Only storage and identity are
 * faked. If a placement is legal in the harness it is legal on the server, and vice versa.
 *
 * What is NOT real: data lives in memory and resets when the dev server restarts, everyone is
 * the same fake user, and Reddit itself is absent. This is for reviewing gameplay and flow, not
 * for validating persistence or auth.
 */

interface MockTower extends TowerMapEntry {}

interface MockPlayer {
  userId: string;
  username: string;
  regionIndex: number;
  placements: GridPlacement[];
}

const SEEDED_PLAYERS = 6;

/** In-memory store. Reset by restarting the dev server. */
class MockStore {
  private towers = new Map<string, MockTower>();
  private players = new Map<string, MockPlayer>();
  private nextRegion = 0;
  private nextSession = 1;

  /** The person playing. Fixed, since there is no auth here. */
  readonly me = 'local-player';

  constructor() {
    this.player(this.me, 'you');
    this.seedNeighbours();
  }

  player(userId: string, username: string): MockPlayer {
    let p = this.players.get(userId);
    if (!p) {
      p = { userId, username, regionIndex: this.nextRegion++, placements: [] };
      this.players.set(userId, p);
    }
    return p;
  }

  regionOf(userId: string): PlayerRegion {
    const p = this.player(userId, userId);
    const region = regionCoordForIndex(p.regionIndex);
    const center = regionCenterCell(region);
    return { rx: region.rx, rz: region.rz, centerX: center.x, centerZ: center.z, radius: REGION_RADIUS };
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

  /**
   * Resolve placements to positioned towers.
   *
   * Mirrors the server: sets worldX/worldZ (the renderer positions from world coordinates, not
   * cells) and stackBaseY from what sits below in the same cell.
   */
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

  community(): MockTower[] {
    return [...this.players.keys()].flatMap((userId) => this.resolve(userId));
  }

  place(
    userId: string,
    sessionId: string,
    gridX: number,
    gridZ: number
  ): { ok: true } | { ok: false; message: string } {
    const p = this.player(userId, userId);
    const tower = this.towers.get(sessionId);

    // Same checks the server makes, in the same order, so a rejection here is a rejection there.
    if (!tower) return { ok: false, message: 'That tower no longer exists.' };
    if (tower.userId !== userId) return { ok: false, message: 'You can only place your own towers.' };
    if (p.placements.some((x) => x.sessionId === sessionId))
      return { ok: false, message: 'That tower is already on your grid.' };
    if (p.placements.length >= MAX_PLACEMENTS_PER_PLAYER)
      return { ok: false, message: `Your grid is full (${MAX_PLACEMENTS_PER_PLAYER} towers).` };

    const region = regionCoordForIndex(p.regionIndex);
    if (!isCellInRegion(region, gridX, gridZ))
      return { ok: false, message: 'That cell is outside your area.' };

    const inCell = p.placements.filter((x) => x.gridX === gridX && x.gridZ === gridZ);
    if (inCell.length >= MAX_STACK_PER_CELL)
      return { ok: false, message: `You can stack at most ${MAX_STACK_PER_CELL} towers here.` };

    p.placements.push({
      sessionId,
      gridX,
      gridZ,
      stackIndex: inCell.length,
      height: measureHeight(tower.towerBlocks),
      placedAt: Date.now(),
    });
    return { ok: true };
  }

  remove(userId: string, sessionId: string): boolean {
    const p = this.players.get(userId);
    if (!p) return false;
    const before = p.placements.length;
    p.placements = p.placements.filter((x) => x.sessionId !== sessionId);
    return p.placements.length !== before;
  }

  /**
   * A few neighbouring players with towers, so the grid isn't empty on first load.
   *
   * Without these the harness opens on a blank plane and there is no way to tell "rendering is
   * broken" from "nobody has built anything yet" -- a distinction that matters right now,
   * because the real grid legitimately starts empty.
   */
  private seedNeighbours(): void {
    for (let i = 1; i <= SEEDED_PLAYERS; i++) {
      const userId = `neighbour-${i}`;
      const p = this.player(userId, `player${i}`);
      const towerCount = 1 + (i % 3);

      for (let t = 0; t < towerCount; t++) {
        const blocks = generateTowerBlocks(6 + ((i * 3 + t * 5) % 14));
        const sessionId = this.addTower(userId, p.username, {
          userId,
          username: p.username,
          score: 400 + i * 137 + t * 61,
          blockCount: blocks.length,
          perfectStreak: (i + t) % 5,
          gameMode: 'rotating_block',
          timestamp: Date.now() - i * 60_000,
          towerBlocks: blocks,
          playerColorChoice: i % 2 === 0 ? 'blue' : 'orange',
        } as Omit<MockTower, 'sessionId'>);

        // Spread towers across the region, except the third one, which is deliberately placed
        // on top of the second. Stacked rendering is one of the things worth reviewing, and it
        // should be visible on load rather than only after building two towers by hand.
        const stacksOntoPrevious = t === 2;
        const localX = stacksOntoPrevious ? 0 : (t % 3) - 1;
        const localZ = stacksOntoPrevious ? (i % 3) - 1 : (i % 3) - 1;
        const region = regionCoordForIndex(p.regionIndex);
        const center = regionCenterCell(region);
        this.place(userId, sessionId, center.x + localX, center.z + localZ);
      }
    }
  }
}

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

/** Plausible stacked-tower geometry, in the fixed-point scale the renderer expects. */
const generateTowerBlocks = (count: number) => {
  const blocks = [];
  let width = 10_000;
  let x = 0;
  let z = 0;
  for (let i = 0; i < count; i++) {
    // Taper and drift a little so towers read as hand-stacked rather than a perfect column.
    width = Math.max(3_000, width - ((i * 7) % 900));
    x += (((i * 13) % 5) - 2) * 120;
    z += (((i * 29) % 5) - 2) * 120;
    blocks.push({
      x,
      y: i * 2_000,
      z,
      width,
      depth: width,
      height: 2_000,
      rotation: 0,
    });
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
 *
 * Kept as middleware rather than a separate process so `npm run play` is one command and there
 * is no port juggling or proxy config to get wrong.
 */
export const mockApiPlugin = (): Plugin => {
  const store = new MockStore();

  return {
    name: 'stonefall-mock-api',
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        const url = req.url ?? '';
        if (!url.startsWith('/api/')) return next();

        const send = (body: unknown, status = 200) => {
          res.statusCode = status;
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify(body));
        };

        const path = url.split('?')[0] ?? '';

        try {
          // Client logs surface in the terminal running the dev server, which is where you are
          // already looking.
          if (path === '/api/log') {
            const { logs } = await readJson(req);
            for (const log of logs ?? []) {
              console.log(`[client:${log.level ?? 'log'}] ${log.message}`);
            }
            return send({ success: true });
          }

          if (path === '/api/grid/community') {
            const towers = store.community();
            return send({ type: 'community_grid', towers, totalCount: towers.length });
          }

          if (path === '/api/grid/mine') {
            return send({
              type: 'player_grid',
              grid: store.gridOf(store.me),
              region: store.regionOf(store.me),
            });
          }

          if (path === '/api/grid/mine/towers') {
            return send({
              type: 'player_grid_towers',
              grid: store.gridOf(store.me),
              towers: store.resolve(store.me),
              region: store.regionOf(store.me),
            });
          }

          if (path === '/api/grid/place') {
            const { sessionId, gridX, gridZ } = await readJson(req);
            const result = store.place(store.me, sessionId, Number(gridX), Number(gridZ));
            if (!result.ok) {
              return send({ type: 'place_tower', success: false, message: result.message }, 400);
            }
            return send({ type: 'place_tower', success: true, grid: store.gridOf(store.me) });
          }

          if (path === '/api/grid/remove') {
            const { sessionId } = await readJson(req);
            const removed = store.remove(store.me, sessionId);
            return send(
              {
                type: 'remove_placement',
                success: removed,
                ...(removed ? { grid: store.gridOf(store.me) } : { message: 'Not on your grid.' }),
              },
              removed ? 200 : 400
            );
          }

          if (path === '/api/game/save-session') {
            const { sessionData } = await readJson(req);
            const sessionId = store.addTower(store.me, 'you', {
              userId: store.me,
              username: 'you',
              score: sessionData?.finalScore ?? 0,
              blockCount: sessionData?.blockCount ?? 0,
              perfectStreak: sessionData?.perfectStreakCount ?? 0,
              gameMode: sessionData?.gameMode ?? 'rotating_block',
              timestamp: Date.now(),
              towerBlocks: sessionData?.towerBlocks ?? [],
              playerColorChoice: sessionData?.playerColorChoice ?? null,
            } as Omit<MockTower, 'sessionId'>);

            console.log(
              `[mock] Saved run: ${sessionData?.finalScore ?? 0} pts, ` +
                `${sessionData?.blockCount ?? 0} blocks -> ${sessionId}`
            );
            return send({
              type: 'save_session',
              sessionId,
              success: true,
              totalPlayers: SEEDED_PLAYERS + 1,
              madeTheGrid: true,
            });
          }

          if (path === '/api/game/tower-stats') {
            return send({
              type: 'tower_color_stats',
              totalCount: store.community().length,
              colorTotals: {
                blue: { count: 3, percentage: 50 },
                orange: { count: 3, percentage: 50 },
                unknown: { count: 0, percentage: 0 },
              },
              leadingColor: 'tie',
            });
          }

          // An unmocked endpoint is worth shouting about: it means the client depends on
          // something the harness doesn't model, and any review of that path is meaningless.
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
