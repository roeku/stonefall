import { useRef, useEffect, useState } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';

/** How far each box is grown past its block, in world units, so nothing pops at the frame edge. */
const MARGIN = 0.5;

/**
 * Hook to perform frustum culling on blocks while minimizing per-frame allocations.
 * Returns a Set of visible block indices that should be rendered.
 *
 * Blocks are in simulation space, but the run is drawn moved onto the player's plot (the scene
 * wraps them in a group at `originX, originZ`), and the camera looks at them there. The boxes
 * have to be tested where the blocks are drawn: tested at the simulation origin, every placed
 * block was culled whenever the plot was away from the middle of the map, and a run showed only
 * the moving block and the offcuts on the floor.
 *
 * The set is filled per frame, after the scene has rendered, so a change to it re-renders the
 * scene. A run re-renders every frame anyway, but a tower nobody is building on (a relay that has
 * topped out, or is waiting for a crew) does not, and its first render, made before any frame had
 * filled the set, left it invisible.
 */
export const useFrustumCulling = (
  blocks: readonly any[],
  convertPosition: (val: number) => number,
  originX = 0,
  originZ = 0
) => {
  const { camera } = useThree();
  const frustum = useRef(new THREE.Frustum());
  const projScreenMatrix = useRef(new THREE.Matrix4());
  const visibleIndices = useRef(new Set<number>());
  const frameCount = useRef(0);
  /** What was visible last frame, as a count and a hash of the indices. */
  const seen = useRef({ count: -1, hash: 0 });
  const [, rerender] = useState(0);

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

      const centerX = convertPosition(block.x) + originX;
      const centerZ = convertPosition(block.z ?? 0) + originZ;
      const width = convertPosition(block.width);
      const depth = convertPosition(block.depth ?? block.width);
      // A block's y is its foot: the scene draws it centred half its height above that.
      const bottom = convertPosition(block.y);
      const height = convertPosition(block.height);

      const halfW = width * 0.5 + MARGIN;
      const halfD = depth * 0.5 + MARGIN;

      const box = nextCache[i] || new THREE.Box3();
      box.min.set(centerX - halfW, bottom - MARGIN, centerZ - halfD);
      box.max.set(centerX + halfW, bottom + height + MARGIN, centerZ + halfD);
      nextCache[i] = box;
    }

    boxCache.current = nextCache;
    frameCount.current = 0;
  }, [blocks.length, convertPosition, originX, originZ]);

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

    let hash = 0;
    for (let i = 0; i < cachedBoxes.length; i++) {
      const box = cachedBoxes[i];
      if (box && frustum.current.intersectsBox(box)) {
        currentVisible.add(i);
        hash = (Math.imul(hash, 31) + i + 1) | 0;
      }
    }
    if (currentVisible.size !== seen.current.count || hash !== seen.current.hash) {
      seen.current = { count: currentVisible.size, hash };
      rerender((n) => n + 1);
    }

    frameCount.current++;
  });

  return visibleIndices;
};
