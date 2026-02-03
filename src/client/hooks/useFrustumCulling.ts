import { useRef, useEffect } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';

/**
 * Hook to perform frustum culling on blocks while minimizing per-frame allocations.
 * Returns a Set of visible block indices that should be rendered.
 */
export const useFrustumCulling = (
  blocks: readonly any[],
  convertPosition: (val: number) => number
) => {
  const { camera } = useThree();
  const frustum = useRef(new THREE.Frustum());
  const projScreenMatrix = useRef(new THREE.Matrix4());
  const visibleIndices = useRef(new Set<number>());
  const frameCount = useRef(0);

  // Precomputed, reusable bounding boxes to avoid GC spikes each frame
  const boxCache = useRef<THREE.Box3[]>([]);

  useEffect(() => {
    if (!blocks || blocks.length === 0) {
      boxCache.current = [];
      visibleIndices.current.clear();
      return;
    }

    const nextCache: THREE.Box3[] = boxCache.current.slice(0, blocks.length);

    for (let i = 0; i < blocks.length; i++) {
      const block = blocks[i];
      if (!block) continue;

      const centerX = convertPosition(block.x);
      const centerZ = convertPosition(block.z ?? 0);
      const width = convertPosition(block.width);
      const depth = convertPosition(block.depth ?? block.width);
      const centerY = convertPosition(block.y);
      const height = convertPosition(block.height);

      const halfW = width * 0.5;
      const halfD = depth * 0.5;
      const halfH = height * 0.5;

      const box = nextCache[i] || new THREE.Box3();
      box.min.set(centerX - halfW, centerY - halfH, centerZ - halfD);
      box.max.set(centerX + halfW, centerY + halfH, centerZ + halfD);
      nextCache[i] = box;
    }

    boxCache.current = nextCache;
    frameCount.current = 0;
  }, [blocks.length, convertPosition]);

  useFrame(() => {
    const cachedBoxes = boxCache.current;
    if (!cachedBoxes.length) {
      visibleIndices.current.clear();
      return;
    }

    // Update frustum from camera
    camera.updateMatrixWorld();
    projScreenMatrix.current.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    frustum.current.setFromProjectionMatrix(projScreenMatrix.current);

    // Reuse the set instance to avoid churn
    const currentVisible = visibleIndices.current;
    currentVisible.clear();

    for (let i = 0; i < cachedBoxes.length; i++) {
      const box = cachedBoxes[i];
      if (box && frustum.current.intersectsBox(box)) {
        currentVisible.add(i);
      }
    }

    // Log culling stats every 60 frames (~1 second at 60fps)
    if (frameCount.current % 60 === 0) {
      const culledCount = blocks.length - currentVisible.size;
      const culledPercent =
        blocks.length === 0 ? '0.0' : ((culledCount / blocks.length) * 100).toFixed(1);
      // console.log(`🔍 Frustum Culling: ${currentVisible.size}/${blocks.length} visible (${culledPercent}% culled)`);
    }

    frameCount.current++;
  });

  return visibleIndices;
};
