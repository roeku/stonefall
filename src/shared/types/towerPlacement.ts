// Tower placement coordinate system
import {
  computeGridRadiusForCapacity,
  DEFAULT_TOWER_GRID_DENSITY,
  MAX_VISIBLE_TOWERS,
} from '../constants/towers';

/**
 * One tower within a cell's stack.
 *
 * `height` is what the tower contributes vertically, and is what lets a cell compute base
 * offsets without knowing anything about block geometry.
 *
 * UNITS: fixed-point, the same scale as TowerBlock coordinates (1000 = one world unit, see
 * FixedMath). Renderers already divide block positions by 1000 and must do the same with any
 * offset derived from here. Mixing the two silently produces towers floating 1000x too high.
 *
 * Zero is allowed and means "unknown" -- towers placed before heights were tracked stack at
 * the same base rather than being dropped.
 */
export interface StackedTower {
  towerId: string;
  height: number;
}

export interface TowerCoordinate {
  x: number; // Grid X coordinate
  z: number; // Grid Z coordinate
  worldX: number; // World position X
  worldZ: number; // World position Z
  /** Derived from `stack`: true when anything occupies this cell. */
  isOccupied: boolean;
  /** Derived from `stack`: the topmost tower, or undefined when empty. */
  towerId?: string | undefined;
  /** Bottom-to-top contents of this cell. A plain unstacked cell holds a single entry. */
  stack: StackedTower[];
}

/**
 * Cap on how many towers can share a cell.
 *
 * Exists to stop a single column growing tall enough to wreck the camera framing and dominate
 * the community view. Tune with the renderer, not in isolation.
 */
export const MAX_STACK_PER_CELL = 8;

export interface TowerPlacementGrid {
  gridSize: number;
  gridOffsetX: number;
  gridOffsetZ: number;
  coordinates: TowerCoordinate[];
}

/**
 * Width of one grid cell, in world units. Exactly one tower footprint.
 *
 * A tower's base block is `TOWER_WIDTH * 2` = 8 units (see `createBaseBlock` in the simulation),
 * and every later block inherits the width of the block below it, trimmed to their overlap. So 8
 * units is the whole envelope of a tower and nothing ever leaves it. A cell the same width means
 * a tower fills its cell exactly and every block edge lands on a floor grid line.
 *
 * This was 4 for a while, on the belief that the base was `TOWER_WIDTH` wide. It is not, and the
 * result was every tower overhanging its cell by half a cell on each side and colliding with its
 * neighbours -- the whole board read as unaligned, which on a grid that is the entire look.
 */
export const DEFAULT_TOWER_GRID_SIZE = 8;
export const DEFAULT_TOWER_GRID_OFFSET = 0;
export const DEFAULT_TOWER_GRID_RADIUS = computeGridRadiusForCapacity(
  MAX_VISIBLE_TOWERS,
  DEFAULT_TOWER_GRID_DENSITY
);

export class TowerPlacementSystem {
  private gridSize: number;
  private gridOffsetX: number;
  private gridOffsetZ: number;
  private coordinates: Map<string, TowerCoordinate>;
  private gridRadius: number;
  private ringBuckets: Map<number, string[]>;
  private ringCursor: Map<number, number>;
  private maxRing: number;

  constructor(
    gridSize: number = DEFAULT_TOWER_GRID_SIZE,
    gridOffsetX: number = DEFAULT_TOWER_GRID_OFFSET,
    gridOffsetZ: number = DEFAULT_TOWER_GRID_OFFSET,
    gridRadius: number = DEFAULT_TOWER_GRID_RADIUS
  ) {
    this.gridSize = gridSize;
    this.gridOffsetX = gridOffsetX;
    this.gridOffsetZ = gridOffsetZ;
    this.coordinates = new Map();
    this.gridRadius = Math.max(1, Math.floor(gridRadius));
    this.ringBuckets = new Map();
    this.ringCursor = new Map();
    this.maxRing = 0;
    this.initializeGrid();
  }

  private initializeGrid(): void {
    // Create a large grid for infinite placement
    this.coordinates.clear();
    this.ringBuckets.clear();
    this.ringCursor.clear();

    const bucketEntries = new Map<number, Array<{ key: string; angle: number }>>();
    let maxRing = 0;

    for (let x = -this.gridRadius; x <= this.gridRadius; x++) {
      for (let z = -this.gridRadius; z <= this.gridRadius; z++) {
        const distanceFromCenter = Math.hypot(x, z);
        if (distanceFromCenter > this.gridRadius) {
          continue;
        }

        // Position towers at the CENTER of each grid cell, not at intersections (keeps them aligned to grid)
        const worldX = this.gridOffsetX + x * this.gridSize + this.gridSize / 2;
        const worldZ = this.gridOffsetZ + z * this.gridSize + this.gridSize / 2;

        const coordinate: TowerCoordinate = {
          x,
          z,
          worldX,
          worldZ,
          isOccupied: false, // Don't pre-occupy any coordinates
          towerId: undefined,
          stack: [],
        };

        const key = this.makeKey(x, z);
        this.coordinates.set(key, coordinate);

        const ring = Math.max(0, Math.floor(distanceFromCenter));
        maxRing = Math.max(maxRing, ring);
        if (!bucketEntries.has(ring)) {
          bucketEntries.set(ring, []);
        }
        bucketEntries.get(ring)!.push({ key, angle: Math.atan2(z, x) });
      }
    }

    bucketEntries.forEach((entries, ring) => {
      const sorted = entries.sort((a, b) => a.angle - b.angle).map((entry) => entry.key);
      const rotation = sorted.length
        ? Math.floor(this.deterministicNoise(`ring-${ring}`) * sorted.length)
        : 0;
      const rotated =
        rotation === 0 ? sorted : [...sorted.slice(rotation), ...sorted.slice(0, rotation)];
      this.ringBuckets.set(ring, rotated);
      this.ringCursor.set(ring, 0);
    });

    this.maxRing = maxRing;
  }

  private makeKey(x: number, z: number): string {
    return `${x},${z}`;
  }

  // Deterministic pseudo-random value in [0, 1)
  private deterministicNoise(key: string): number {
    let hash = 0;
    for (let i = 0; i < key.length; i++) {
      hash = (hash << 5) - hash + key.charCodeAt(i);
      hash |= 0; // keep 32-bit
    }
    const s = Math.sin(hash * 12.9898) * 43758.5453;
    return s - Math.floor(s);
  }

  // Get coordinate by grid position
  getCoordinate(x: number, z: number): TowerCoordinate | null {
    return this.coordinates.get(this.makeKey(x, z)) || null;
  }

  // Get coordinate by world position (finds nearest grid cell)
  getCoordinateByWorldPos(worldX: number, worldZ: number): TowerCoordinate | null {
    // Account for the cell center offset when converting world position to grid coordinates
    const gridX = Math.round((worldX - this.gridOffsetX - this.gridSize / 2) / this.gridSize);
    const gridZ = Math.round((worldZ - this.gridOffsetZ - this.gridSize / 2) / this.gridSize);
    return this.getCoordinate(gridX, gridZ);
  }

  // Get all available coordinates (not occupied), sorted by distance from origin
  getAvailableCoordinates(): TowerCoordinate[] {
    const available: TowerCoordinate[] = [];
    for (let ring = 0; ring <= this.maxRing; ring++) {
      const keys = this.ringBuckets.get(ring);
      if (!keys) continue;
      for (const key of keys) {
        const coord = this.coordinates.get(key);
        if (coord && !coord.isOccupied) {
          available.push(coord);
        }
      }
    }
    return available;
  }

  // Get all occupied coordinates
  getOccupiedCoordinates(): TowerCoordinate[] {
    return Array.from(this.coordinates.values()).filter((coord) => coord.isOccupied);
  }

  /**
   * Keeps the derived `isOccupied` / `towerId` fields in step with `stack`.
   *
   * Both are retained so existing callers (auto-assignment, the renderers) keep working
   * unchanged; `towerId` reports the top of the stack.
   */
  private syncCell(coordinate: TowerCoordinate): void {
    const top = coordinate.stack[coordinate.stack.length - 1];
    coordinate.isOccupied = coordinate.stack.length > 0;
    coordinate.towerId = top ? top.towerId : undefined;
  }

  /**
   * Place a tower on an *empty* cell.
   *
   * Deliberately still fails on an occupied cell: auto-assignment relies on this to find free
   * ground, and silently stacking there would pile towers on top of each other. Player-chosen
   * stacking goes through stackTower().
   */
  placeTower(x: number, z: number, towerId: string, height: number = 0): boolean {
    const coordinate = this.getCoordinate(x, z);
    if (!coordinate || coordinate.isOccupied) {
      return false;
    }

    coordinate.stack = [{ towerId, height: Math.max(0, height) }];
    this.syncCell(coordinate);
    return true;
  }

  /**
   * Add a tower on top of whatever is already in a cell.
   *
   * This is the player-driven placement path: it succeeds on empty and occupied cells alike,
   * up to MAX_STACK_PER_CELL. Returns false when the cell doesn't exist, the stack is full, or
   * the tower is already in it.
   */
  stackTower(x: number, z: number, towerId: string, height: number = 0): boolean {
    const coordinate = this.getCoordinate(x, z);
    if (!coordinate || coordinate.stack.length >= MAX_STACK_PER_CELL) {
      return false;
    }
    if (coordinate.stack.some((entry) => entry.towerId === towerId)) {
      return false;
    }

    coordinate.stack.push({ towerId, height: Math.max(0, height) });
    this.syncCell(coordinate);
    return true;
  }

  /** Remove one tower from a cell, preserving the order of the rest. */
  unstackTower(x: number, z: number, towerId: string): boolean {
    const coordinate = this.getCoordinate(x, z);
    if (!coordinate) {
      return false;
    }

    const index = coordinate.stack.findIndex((entry) => entry.towerId === towerId);
    if (index === -1) {
      return false;
    }

    coordinate.stack.splice(index, 1);
    this.syncCell(coordinate);
    return true;
  }

  /** Contents of a cell, bottom to top. */
  getStack(x: number, z: number): StackedTower[] {
    return this.getCoordinate(x, z)?.stack ?? [];
  }

  /** Combined height of everything in a cell. */
  getStackHeight(x: number, z: number): number {
    return this.getStack(x, z).reduce((total, entry) => total + entry.height, 0);
  }

  /**
   * Vertical offset a given tower sits at: the summed height of everything beneath it.
   *
   * Returns 0 for the bottom tower and for towers not present in the cell, so a caller that
   * renders an unknown tower puts it on the ground rather than floating it.
   */
  getStackBaseY(x: number, z: number, towerId: string): number {
    const stack = this.getStack(x, z);
    let baseY = 0;
    for (const entry of stack) {
      if (entry.towerId === towerId) {
        return baseY;
      }
      baseY += entry.height;
    }
    return 0;
  }

  /** True when another tower can still be added to this cell. */
  canStack(x: number, z: number): boolean {
    const coordinate = this.getCoordinate(x, z);
    return !!coordinate && coordinate.stack.length < MAX_STACK_PER_CELL;
  }

  // Remove every tower from a cell
  removeTower(x: number, z: number): boolean {
    const coordinate = this.getCoordinate(x, z);
    if (!coordinate || !coordinate.isOccupied || coordinate.towerId === 'player') {
      return false;
    }

    coordinate.stack = [];
    this.syncCell(coordinate);
    return true;
  }

  // Get all coordinates as array
  getAllCoordinates(): TowerCoordinate[] {
    return Array.from(this.coordinates.values());
  }

  // Update grid parameters
  updateGrid(
    gridSize?: number,
    gridOffsetX?: number,
    gridOffsetZ?: number,
    gridRadius?: number
  ): void {
    if (gridSize !== undefined) this.gridSize = gridSize;
    if (gridOffsetX !== undefined) this.gridOffsetX = gridOffsetX;
    if (gridOffsetZ !== undefined) this.gridOffsetZ = gridOffsetZ;
    if (gridRadius !== undefined) this.gridRadius = Math.max(1, Math.floor(gridRadius));

    // Reinitialize grid with new parameters
    this.initializeGrid();
  }

  // Reset all tower placements
  reset(): void {
    for (const coordinate of this.coordinates.values()) {
      coordinate.stack = [];
      coordinate.isOccupied = false;
      coordinate.towerId = undefined;
    }
    for (const ring of this.ringCursor.keys()) {
      this.ringCursor.set(ring, 0);
    }
  }

  getConfiguration(): {
    gridSize: number;
    gridOffsetX: number;
    gridOffsetZ: number;
    gridRadius: number;
  } {
    return {
      gridSize: this.gridSize,
      gridOffsetX: this.gridOffsetX,
      gridOffsetZ: this.gridOffsetZ,
      gridRadius: this.gridRadius,
    };
  }

  private getRingSearchOrder(preferredRing: number): number[] {
    const target = Math.max(0, Math.min(this.maxRing, preferredRing));
    const order: number[] = [target];
    for (let offset = 1; offset <= this.maxRing; offset++) {
      const forward = target + offset;
      const backward = target - offset;
      if (forward <= this.maxRing) {
        order.push(forward);
      }
      if (backward >= 0) {
        order.push(backward);
      }
    }
    return order;
  }

  private getNextAvailableInRing(ring: number): TowerCoordinate | null {
    const keys = this.ringBuckets.get(ring);
    if (!keys || keys.length === 0) {
      return null;
    }

    const startIndex = this.ringCursor.get(ring) ?? 0;
    for (let i = 0; i < keys.length; i++) {
      const index = (startIndex + i) % keys.length;
      const key = keys[index];
      if (!key) {
        continue;
      }
      const coord = this.coordinates.get(key);
      if (coord && !coord.isOccupied) {
        this.ringCursor.set(ring, (index + 1) % keys.length);
        return coord;
      }
    }

    return null;
  }

  getSpreadOutCoordinate(preferredRing: number = 0): TowerCoordinate | null {
    const ringOrder = this.getRingSearchOrder(preferredRing);
    for (const ring of ringOrder) {
      const coord = this.getNextAvailableInRing(ring);
      if (coord) {
        return coord;
      }
    }
    return null;
  }

  getNextCoordinateForRank(
    rank: number,
    options?: { preferCenter?: boolean }
  ): TowerCoordinate | null {
    const preferredRing = this.suggestRingForRank(rank, options);
    return this.getSpreadOutCoordinate(preferredRing);
  }

  suggestRingForRank(rank: number, options?: { preferCenter?: boolean }): number {
    if (options?.preferCenter) {
      return 0;
    }

    const safeRank = Math.max(0, rank);
    const innerSlots = 4; // keep top 4 near center for visibility

    if (safeRank < innerSlots) {
      return 1;
    }

    const adjustedRank = safeRank - innerSlots;
    const totalCoordinates = Math.max(1, this.coordinates.size - innerSlots);
    const fillRatio = Math.min(1, adjustedRank / totalCoordinates);
    const scaledRing = Math.sqrt(fillRatio) * this.maxRing;
    const baseRing = Math.max(1, Math.round(scaledRing));
    const bias = this.getRingBiasForRank(safeRank);
    return Math.min(this.maxRing, Math.max(1, baseRing + bias));
  }

  private getRingBiasForRank(rank: number): number {
    const noise = this.deterministicNoise(`rank-${rank}`);
    if (noise < 0.25) {
      return -1;
    }
    if (noise > 0.75) {
      return 2;
    }
    return 1;
  }
}
