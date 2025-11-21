import { useRef, useEffect } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';

interface BlockBounds {
  minY: number;
  maxY: number;
}

/**
 * Hook to perform frustum culling on blocks based on their Y position
 * Returns a Set of visible block indices that should be rendered
 */
export const useFrustumCulling = (
  blocks: readonly any[],
  convertPosition: (val: number) => number
) => {
  const { camera } = useThree();
  const frustum = useRef(new THREE.Frustum());
  const projScreenMatrix = useRef(new THREE.Matrix4());
  const visibleIndices = useRef(new Set<number>());
  const boundsCache = useRef(new Map<number, BlockBounds>());

  useFrame(() => {
    if (!blocks || blocks.length === 0) {
      visibleIndices.current.clear();
      return;
    }

    // Update frustum from camera
    camera.updateMatrixWorld();
    projScreenMatrix.current.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    frustum.current.setFromProjectionMatrix(projScreenMatrix.current);

    // Clear previous visible set
    const newVisibleIndices = new Set<number>();

    // Check each block
    for (let i = 0; i < blocks.length; i++) {
      const block = blocks[i];
      if (!block) continue;

      // Get or compute block bounds
      let bounds = boundsCache.current.get(i);
      if (!bounds) {
        const centerY = convertPosition(block.y);
        const height = convertPosition(block.height);
        bounds = {
          minY: centerY - height / 2,
          maxY: centerY + height / 2,
        };
        boundsCache.current.set(i, bounds);
      }

      // Create a bounding box for frustum test
      const centerX = convertPosition(block.x);
      const centerZ = convertPosition(block.z);
      const width = convertPosition(block.width);
      const depth = convertPosition(block.depth);

      const min = new THREE.Vector3(centerX - width / 2, bounds.minY, centerZ - depth / 2);
      const max = new THREE.Vector3(centerX + width / 2, bounds.maxY, centerZ + depth / 2);

      const box = new THREE.Box3(min, max);

      // Test if box intersects frustum
      if (frustum.current.intersectsBox(box)) {
        newVisibleIndices.add(i);
      }
    }

    visibleIndices.current = newVisibleIndices;

    // Log culling stats every 60 frames (~1 second at 60fps)
    if (frameCount.current % 60 === 0 && blocks.length > 0) {
      const culledCount = blocks.length - newVisibleIndices.size;
      const culledPercent = ((culledCount / blocks.length) * 100).toFixed(1);
      // console.log(
      //   `🔍 Frustum Culling: ${newVisibleIndices.size}/${blocks.length} visible (${culledPercent}% culled)`
      // );
    }
    frameCount.current++;
  });

  const frameCount = useRef(0);

  // Clear cache when blocks array changes
  useEffect(() => {
    boundsCache.current.clear();
    frameCount.current = 0;
  }, [blocks.length]);

  return visibleIndices;
};
