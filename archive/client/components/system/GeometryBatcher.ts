import * as THREE from 'three';

/**
 * Geometry batching system for efficient rendering of multiple energy segments
 * Reduces draw calls by batching similar geometries together
 */

interface BatchedSegment {
  geometry: THREE.TubeGeometry;
  material: THREE.MeshBasicMaterial;
  matrix: THREE.Matrix4;
  pathType: string;
  segmentIndex: number;
}

interface GeometryBatch {
  instancedMesh: THREE.InstancedMesh;
  count: number;
  maxCount: number;
  pathType: string;
  lastUsed: number;
}

export class GeometryBatcher {
  private static instance: GeometryBatcher;
  private batches = new Map<string, GeometryBatch>();
  private pendingSegments: BatchedSegment[] = [];
  private readonly MAX_INSTANCES_PER_BATCH = 100;
  private readonly BATCH_UPDATE_INTERVAL = 16; // ~60fps
  private lastBatchUpdate = 0;

  static getInstance(): GeometryBatcher {
    if (!GeometryBatcher.instance) {
      GeometryBatcher.instance = new GeometryBatcher();
    }
    return GeometryBatcher.instance;
  }

  /**
   * Add a segment to be batched for efficient rendering
   */
  addSegment(
    geometry: THREE.TubeGeometry,
    material: THREE.MeshBasicMaterial,
    position: THREE.Vector3,
    rotation: THREE.Euler,
    scale: THREE.Vector3,
    pathType: string,
    segmentIndex: number
  ): void {
    const matrix = new THREE.Matrix4();
    matrix.compose(position, new THREE.Quaternion().setFromEuler(rotation), scale);

    this.pendingSegments.push({
      geometry,
      material,
      matrix,
      pathType,
      segmentIndex,
    });
  }

  /**
   * Process pending segments and update batches
   */
  updateBatches(currentTime: number): THREE.Object3D[] {
    // Only update batches at specified intervals for performance
    if (currentTime - this.lastBatchUpdate < this.BATCH_UPDATE_INTERVAL) {
      return this.getCurrentBatchObjects();
    }

    this.lastBatchUpdate = currentTime;

    // Group pending segments by material and geometry characteristics
    const segmentGroups = this.groupSegmentsByCharacteristics();

    // Update or create batches for each group
    segmentGroups.forEach((segments, groupKey) => {
      this.updateBatchForGroup(groupKey, segments, currentTime);
    });

    // Clear pending segments
    this.pendingSegments = [];

    // Clean up unused batches
    this.cleanupUnusedBatches(currentTime);

    return this.getCurrentBatchObjects();
  }

  /**
   * Get current batch objects for rendering
   */
  private getCurrentBatchObjects(): THREE.Object3D[] {
    return Array.from(this.batches.values()).map((batch) => batch.instancedMesh);
  }

  /**
   * Group segments by material and geometry characteristics for efficient batching
   */
  private groupSegmentsByCharacteristics(): Map<string, BatchedSegment[]> {
    const groups = new Map<string, BatchedSegment[]>();

    this.pendingSegments.forEach((segment) => {
      // Create a key based on material properties and geometry characteristics
      const materialKey = this.getMaterialKey(segment.material);
      const geometryKey = this.getGeometryKey(segment.geometry);
      const groupKey = `${materialKey}-${geometryKey}-${segment.pathType}`;

      if (!groups.has(groupKey)) {
        groups.set(groupKey, []);
      }
      groups.get(groupKey)!.push(segment);
    });

    return groups;
  }

  /**
   * Update or create a batch for a specific group of segments
   */
  private updateBatchForGroup(
    groupKey: string,
    segments: BatchedSegment[],
    currentTime: number
  ): void {
    let batch = this.batches.get(groupKey);

    // Create new batch if it doesn't exist
    if (!batch) {
      const firstSegment = segments[0];
      if (!firstSegment) return;

      const instancedMesh = new THREE.InstancedMesh(
        firstSegment.geometry,
        firstSegment.material,
        this.MAX_INSTANCES_PER_BATCH
      );

      batch = {
        instancedMesh,
        count: 0,
        maxCount: this.MAX_INSTANCES_PER_BATCH,
        pathType: firstSegment.pathType,
        lastUsed: currentTime,
      };

      this.batches.set(groupKey, batch);
    }

    // Update batch with new segments
    batch.lastUsed = currentTime;
    batch.count = Math.min(segments.length, batch.maxCount);

    // Update instance matrices
    segments.slice(0, batch.count).forEach((segment, index) => {
      batch!.instancedMesh.setMatrixAt(index, segment.matrix);
    });

    // Update instance count and mark for GPU update
    batch.instancedMesh.count = batch.count;
    batch.instancedMesh.instanceMatrix.needsUpdate = true;
  }

  /**
   * Clean up batches that haven't been used recently
   */
  private cleanupUnusedBatches(currentTime: number): void {
    const maxAge = 5000; // 5 seconds

    for (const [key, batch] of this.batches.entries()) {
      if (currentTime - batch.lastUsed > maxAge) {
        // Dispose of geometry and material if they're not shared
        batch.instancedMesh.geometry.dispose();
        if (Array.isArray(batch.instancedMesh.material)) {
          batch.instancedMesh.material.forEach((mat) => mat.dispose());
        } else {
          batch.instancedMesh.material.dispose();
        }

        this.batches.delete(key);
      }
    }
  }

  /**
   * Create a key for material characteristics
   */
  private getMaterialKey(material: THREE.MeshBasicMaterial): string {
    return [
      material.color.getHex().toString(16),
      Math.round(material.opacity * 100),
      material.blending,
      material.transparent ? 1 : 0,
    ].join('-');
  }

  /**
   * Create a key for geometry characteristics
   */
  private getGeometryKey(geometry: THREE.TubeGeometry): string {
    const params = geometry.parameters;
    return [
      Math.round((params.radius || 0) * 1000),
      params.tubularSegments || 0,
      params.radialSegments || 0,
    ].join('-');
  }

  /**
   * Get batching statistics for performance monitoring
   */
  getBatchingStats(): {
    activeBatches: number;
    totalInstances: number;
    pendingSegments: number;
    memoryUsage: number;
  } {
    let totalInstances = 0;
    let memoryUsage = 0;

    for (const batch of this.batches.values()) {
      totalInstances += batch.count;
      // Rough memory estimation (geometry + material + instance data)
      memoryUsage += batch.count * 1024; // Approximate bytes per instance
    }

    return {
      activeBatches: this.batches.size,
      totalInstances,
      pendingSegments: this.pendingSegments.length,
      memoryUsage,
    };
  }

  /**
   * Clear all batches and reset state
   */
  reset(): void {
    // Dispose of all batch resources
    for (const batch of this.batches.values()) {
      batch.instancedMesh.geometry.dispose();
      if (Array.isArray(batch.instancedMesh.material)) {
        batch.instancedMesh.material.forEach((mat) => mat.dispose());
      } else {
        batch.instancedMesh.material.dispose();
      }
    }

    this.batches.clear();
    this.pendingSegments = [];
  }
}
