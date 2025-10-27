// Dynamic chunk loading system for infinite tower world
import { TowerMapEntry } from '../../shared/types/api';

export interface WorldChunk {
  chunkX: number;
  chunkZ: number;
  towers: TowerMapEntry[];
  isLoaded: boolean;
  isLoading: boolean;
  lastAccessed: number;
}

export interface ChunkBounds {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
}

export class ChunkManager {
  private chunks = new Map<string, WorldChunk>();
  private chunkSize: number;
  private loadRadius: number;
  private unloadRadius: number;

  constructor(chunkSize = 50, loadRadius = 2, unloadRadius = 3) {
    this.chunkSize = chunkSize;
    this.loadRadius = loadRadius;
    this.unloadRadius = unloadRadius;
  }

  // Convert world position to chunk coordinates
  worldToChunk(worldX: number, worldZ: number): { chunkX: number; chunkZ: number } {
    return {
      chunkX: Math.floor(worldX / this.chunkSize),
      chunkZ: Math.floor(worldZ / this.chunkSize),
    };
  }

  // Get chunk key for map storage
  getChunkKey(chunkX: number, chunkZ: number): string {
    return `${chunkX},${chunkZ}`;
  }

  // Get chunks that should be loaded based on camera position
  getRequiredChunks(cameraX: number, cameraZ: number): { chunkX: number; chunkZ: number }[] {
    const centerChunk = this.worldToChunk(cameraX, cameraZ);
    const required: { chunkX: number; chunkZ: number }[] = [];

    for (
      let x = centerChunk.chunkX - this.loadRadius;
      x <= centerChunk.chunkX + this.loadRadius;
      x++
    ) {
      for (
        let z = centerChunk.chunkZ - this.loadRadius;
        z <= centerChunk.chunkZ + this.loadRadius;
        z++
      ) {
        required.push({ chunkX: x, chunkZ: z });
      }
    }

    return required;
  }

  // Get chunks that should be unloaded
  getChunksToUnload(cameraX: number, cameraZ: number): WorldChunk[] {
    const centerChunk = this.worldToChunk(cameraX, cameraZ);
    const toUnload: WorldChunk[] = [];

    this.chunks.forEach((chunk) => {
      const distance = Math.max(
        Math.abs(chunk.chunkX - centerChunk.chunkX),
        Math.abs(chunk.chunkZ - centerChunk.chunkZ)
      );

      if (distance > this.unloadRadius && chunk.isLoaded) {
        toUnload.push(chunk);
      }
    });

    return toUnload;
  }

  // Get chunk bounds in world coordinates
  getChunkBounds(chunkX: number, chunkZ: number): ChunkBounds {
    return {
      minX: chunkX * this.chunkSize,
      maxX: (chunkX + 1) * this.chunkSize,
      minZ: chunkZ * this.chunkSize,
      maxZ: (chunkZ + 1) * this.chunkSize,
    };
  }

  // Add or update chunk
  setChunk(chunkX: number, chunkZ: number, towers: TowerMapEntry[]): void {
    const key = this.getChunkKey(chunkX, chunkZ);
    this.chunks.set(key, {
      chunkX,
      chunkZ,
      towers,
      isLoaded: true,
      isLoading: false,
      lastAccessed: Date.now(),
    });
  }

  // Get chunk if it exists
  getChunk(chunkX: number, chunkZ: number): WorldChunk | undefined {
    const key = this.getChunkKey(chunkX, chunkZ);
    const chunk = this.chunks.get(key);
    if (chunk) {
      chunk.lastAccessed = Date.now();
    }
    return chunk;
  }

  // Mark chunk as loading
  markChunkLoading(chunkX: number, chunkZ: number): void {
    const key = this.getChunkKey(chunkX, chunkZ);
    const existing = this.chunks.get(key);
    if (existing) {
      existing.isLoading = true;
    } else {
      this.chunks.set(key, {
        chunkX,
        chunkZ,
        towers: [],
        isLoaded: false,
        isLoading: true,
        lastAccessed: Date.now(),
      });
    }
  }

  // Unload chunk
  unloadChunk(chunkX: number, chunkZ: number): void {
    const key = this.getChunkKey(chunkX, chunkZ);
    this.chunks.delete(key);
  }

  // Get all loaded towers
  getAllLoadedTowers(): TowerMapEntry[] {
    const towers: TowerMapEntry[] = [];
    this.chunks.forEach((chunk) => {
      if (chunk.isLoaded) {
        towers.push(...chunk.towers);
      }
    });
    return towers;
  }

  // Clean up old chunks (memory management)
  cleanupOldChunks(maxAge = 300000): void {
    // 5 minutes
    const now = Date.now();
    const toDelete: string[] = [];

    this.chunks.forEach((chunk, key) => {
      if (now - chunk.lastAccessed > maxAge && !chunk.isLoaded) {
        toDelete.push(key);
      }
    });

    toDelete.forEach((key) => this.chunks.delete(key));
  }
}
