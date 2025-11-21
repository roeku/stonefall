// Tower placement coordinate system
import {
  computeGridRadiusForCapacity,
  DEFAULT_TOWER_GRID_DENSITY,
  MAX_VISIBLE_TOWERS,
} from '../constants/towers';

export interface TowerCoordinate {
  x: number; // Grid X coordinate
  z: number; // Grid Z coordinate
  worldX: number; // World position X
  worldZ: number; // World position Z
  isOccupied: boolean;
  towerId?: string | undefined;
}

export interface TowerPlacementGrid {
  gridSize: number;
  gridOffsetX: number;
  gridOffsetZ: number;
  coordinates: TowerCoordinate[];
}

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

  // Place a tower at specific coordinates
  placeTower(x: number, z: number, towerId: string): boolean {
    const coordinate = this.getCoordinate(x, z);
    if (!coordinate || coordinate.isOccupied) {
      return false;
    }

    coordinate.isOccupied = true;
    coordinate.towerId = towerId;
    return true;
  }

  // Remove a tower from coordinates
  removeTower(x: number, z: number): boolean {
    const coordinate = this.getCoordinate(x, z);
    if (!coordinate || !coordinate.isOccupied || coordinate.towerId === 'player') {
      return false;
    }

    coordinate.isOccupied = false;
    coordinate.towerId = undefined;
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
      coordinate.isOccupied = false;
      coordinate.towerId = undefined;
    }
    for (const ring of this.ringCursor.keys()) {
      this.ringCursor.set(ring, 0);
    }
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
