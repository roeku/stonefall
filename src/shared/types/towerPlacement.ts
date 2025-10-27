// Tower placement coordinate system
export interface TowerCoordinate {
  x: number; // Grid X coordinate
  z: number; // Grid Z coordinate
  worldX: number; // World position X
  worldZ: number; // World position Z
  isOccupied: boolean;
  towerId?: string;
}

export interface TowerPlacementGrid {
  gridSize: number;
  gridOffsetX: number;
  gridOffsetZ: number;
  coordinates: TowerCoordinate[];
}

export class TowerPlacementSystem {
  private gridSize: number;
  private gridOffsetX: number;
  private gridOffsetZ: number;
  private coordinates: Map<string, TowerCoordinate>;

  constructor(gridSize: number = 8, gridOffsetX: number = 0, gridOffsetZ: number = 0) {
    this.gridSize = gridSize;
    this.gridOffsetX = gridOffsetX;
    this.gridOffsetZ = gridOffsetZ;
    this.coordinates = new Map();
    this.initializeGrid();
  }

  private initializeGrid(): void {
    // Create a large grid for infinite placement
    const gridRadius = 50; // Creates 101x101 grid (-50 to +50) = 10,201 spots

    for (let x = -gridRadius; x <= gridRadius; x++) {
      for (let z = -gridRadius; z <= gridRadius; z++) {
        // Position towers at the CENTER of each grid cell, not at intersections
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

        this.coordinates.set(`${x},${z}`, coordinate);
      }
    }
  }

  // Get coordinate by grid position
  getCoordinate(x: number, z: number): TowerCoordinate | null {
    return this.coordinates.get(`${x},${z}`) || null;
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
    return Array.from(this.coordinates.values())
      .filter((coord) => !coord.isOccupied)
      .sort((a, b) => {
        // Sort by distance from origin (0,0)
        const distA = Math.sqrt(a.x * a.x + a.z * a.z);
        const distB = Math.sqrt(b.x * b.x + b.z * b.z);
        return distA - distB;
      });
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
  updateGrid(gridSize?: number, gridOffsetX?: number, gridOffsetZ?: number): void {
    if (gridSize !== undefined) this.gridSize = gridSize;
    if (gridOffsetX !== undefined) this.gridOffsetX = gridOffsetX;
    if (gridOffsetZ !== undefined) this.gridOffsetZ = gridOffsetZ;

    // Reinitialize grid with new parameters
    this.coordinates.clear();
    this.initializeGrid();
  }

  // Reset all tower placements
  reset(): void {
    for (const coordinate of this.coordinates.values()) {
      coordinate.isOccupied = false;
      coordinate.towerId = undefined;
    }
  }
}
