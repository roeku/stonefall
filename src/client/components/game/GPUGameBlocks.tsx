/**
 * GPU Instanced Game Blocks System
 * 
 * High-performance block rendering during active gameplay using GPU instancing.
 * Dramatically reduces draw calls from N blocks to 2-3 draw calls total.
 * 
 * Features:
 * - Single draw call for all stacked blocks
 * - Single draw call for all block edges
 * - Active block rendered separately for animation
 * - Per-instance colors for visual variety
 * - Perfect streak effects and cascading edge glows
 */

import React, { useRef, useMemo, useEffect } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { Block } from '../../shared/simulation/types';

export interface PerfectEdgeCascadeEvent {
  key: number;
  start: number;
  tier: number;
  totalBlocks: number;
}

interface GPUGameBlocksProps {
  blocks: readonly Block[]; // Allow readonly arrays from gameState
  activeBlock?: Block | null;
  blockColors?: string[]; // Per-block colors from gradient system
  combo?: number; // Current combo streak
  lastPlacement?: {
    readonly isPositionPerfect: boolean;
    readonly noTrim: boolean;
    readonly comboAfter: number;
  } | null | undefined; // Allow undefined for optional prop
  perfectEdgeEvent?: PerfectEdgeCascadeEvent | null;
  enableDebugWireframe?: boolean;
  spawnFrom?: { x: number; y: number; z: number } | null; // For newest block spawn animation
  convertPosition: (fixedValue: number) => number; // Fixed-point to float conversion
  isGhost?: boolean;
}

interface BlockInstanceData {
  position: THREE.Vector3;
  rotation: number;
  scale: THREE.Vector3;
  color: THREE.Color;
  edgeColor: THREE.Color;
  isPerfect?: boolean;
}

/**
 * Main GPU instanced game blocks component
 */
export const GPUGameBlocks: React.FC<GPUGameBlocksProps> = ({
  blocks,
  activeBlock,
  blockColors = [],
  combo: _combo = 0, // Reserved for future perfect streak glow intensity
  lastPlacement: _lastPlacement = null, // Reserved for future perfect placement colors
  perfectEdgeEvent = null,
  enableDebugWireframe: _enableDebugWireframe = false, // Reserved for future debug wireframe mode
  spawnFrom: _spawnFrom = null, // Reserved for future spawn animation
  convertPosition,
  isGhost = false,
}) => {
  const stackedBlocksRef = useRef<THREE.InstancedMesh>(null);
  const stackedEdgesRef = useRef<THREE.InstancedMesh>(null);
  const activeBlockRef = useRef<THREE.Group>(null);

  // Track cascade animation state per block
  const cascadeStateRef = useRef<Map<number, {
    startSeconds: number;
    delay: number;
    duration: number;
    tier: number;
  }>>(new Map());

  // TODO: Implement additional features from GameBlock:
  // - hasPerfectStreak for enhanced edge glow (combo + lastPlacement)
  // - spawnFrom animation for newest block spawning from active position
  // - enableDebugWireframe mode for development
  // - Per-instance emissive intensity based on cascade effects

  // Setup cascade effects when perfectEdgeEvent changes
  useEffect(() => {
    if (!perfectEdgeEvent || !perfectEdgeEvent.totalBlocks) return;

    const delayPerBlock = 0.06;
    const durationBase = 0.9;
    const durationPerBlock = 0.05;
    const startSeconds = perfectEdgeEvent.start / 1000;

    // Setup cascade state for all blocks
    const newCascadeState = new Map<number, {
      startSeconds: number;
      delay: number;
      duration: number;
      tier: number;
    }>();

    for (let blockIndex = 0; blockIndex < blocks.length; blockIndex++) {
      const stepsFromTop = (perfectEdgeEvent.totalBlocks - 1) - blockIndex;
      if (stepsFromTop < 0) continue;

      newCascadeState.set(blockIndex, {
        startSeconds,
        delay: stepsFromTop * delayPerBlock,
        duration: durationBase + stepsFromTop * durationPerBlock,
        tier: perfectEdgeEvent.tier ?? 0
      });
    }

    cascadeStateRef.current = newCascadeState;
  }, [perfectEdgeEvent, blocks.length]);

  // Convert fixed-point blocks to floating point instance data
  const stackedBlockData = useMemo(() => {
    const instances: BlockInstanceData[] = [];

    blocks.forEach((block, index) => {
      const x = convertPosition(block.x);
      const y = convertPosition(block.y);
      const z = convertPosition(block.z ?? 0);
      const width = convertPosition(block.width);
      const height = convertPosition(block.height);
      const depth = convertPosition(block.depth ?? block.width);
      const rotation = ((block.rotation || 0) / 1000) * (Math.PI / 180);

      // Use provided color or default TRON colors
      const blockColor = blockColors[index];
      let baseColor = blockColor
        ? new THREE.Color(blockColor)
        : new THREE.Color('#2a2a4e');

      // Cyan edges for all blocks
      let edgeColor = new THREE.Color('#00f2fe');

      if (isGhost) {
        // Ghost appearance: Holographic/Ethereal
        baseColor = new THREE.Color('#aaddff');
        edgeColor = new THREE.Color('#ffffff');
      }

      instances.push({
        position: new THREE.Vector3(x, y + height / 2, z),
        rotation,
        scale: new THREE.Vector3(width, height, depth),
        color: baseColor,
        edgeColor,
      });
    });

    return instances;
  }, [blocks, isGhost, blockColors, convertPosition]);

  // Update stacked block instances
  useEffect(() => {
    const mesh = stackedBlocksRef.current;
    if (!mesh || stackedBlockData.length === 0) return;

    const tempMatrix = new THREE.Matrix4();
    const tempQuaternion = new THREE.Quaternion();
    const tempEuler = new THREE.Euler();

    stackedBlockData.forEach((block, i) => {
      tempEuler.set(0, block.rotation, 0);
      tempQuaternion.setFromEuler(tempEuler);
      tempMatrix.compose(block.position, tempQuaternion, block.scale);

      mesh.setMatrixAt(i, tempMatrix);
      mesh.setColorAt(i, block.color);
    });

    mesh.count = stackedBlockData.length;
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) {
      mesh.instanceColor.needsUpdate = true;
    }

    mesh.visible = true;
    mesh.frustumCulled = false;
  }, [stackedBlockData]);

  // Update stacked edge instances
  useEffect(() => {
    const mesh = stackedEdgesRef.current;
    if (!mesh || stackedBlockData.length === 0) return;

    const tempMatrix = new THREE.Matrix4();
    const tempQuaternion = new THREE.Quaternion();
    const tempEuler = new THREE.Euler();

    stackedBlockData.forEach((block, i) => {
      tempEuler.set(0, block.rotation, 0);
      tempQuaternion.setFromEuler(tempEuler);
      // Slightly larger for edges
      const edgeScale = new THREE.Vector3(
        block.scale.x * 1.01,
        block.scale.y * 1.01,
        block.scale.z * 1.01
      );
      tempMatrix.compose(block.position, tempQuaternion, edgeScale);

      mesh.setMatrixAt(i, tempMatrix);
      mesh.setColorAt(i, block.edgeColor);
    });

    mesh.count = stackedBlockData.length;
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) {
      mesh.instanceColor.needsUpdate = true;
    }

    mesh.visible = true;
    mesh.frustumCulled = false;
  }, [stackedBlockData]);

  // Animate active block and perfect drop effect
  useFrame(() => {
    const edgesMesh = stackedEdgesRef.current;
    if (edgesMesh) {
      // Subtle pulsing animation on edges
      const time = Date.now() * 0.001;
      const edgeMaterial = edgesMesh.material as THREE.MeshBasicMaterial;
      edgeMaterial.opacity = 0.6 + Math.sin(time * 2) * 0.2;
    }

    // Animate active block if present
    if (!activeBlock || !activeBlockRef.current) return;

    const activeGroup = activeBlockRef.current;

    // Position active block
    const x = activeBlock.x / 1000;
    const y = activeBlock.y / 1000;
    const z = (activeBlock.z || 0) / 1000;
    const height = activeBlock.height / 1000;

    activeGroup.position.set(x, y + height / 2, z);

    // Update cascade glow effects on edges
    const cascadeActive = cascadeStateRef.current.size > 0;
    if (cascadeActive) {
      const nowSeconds = (typeof performance !== 'undefined' ? performance.now() : Date.now()) / 1000;

      // Animate each block's cascade effect
      cascadeStateRef.current.forEach((cascade, _blockIndex) => {
        const localTime = nowSeconds - cascade.startSeconds - cascade.delay;

        if (localTime >= 0 && localTime < cascade.duration) {
          const progress = Math.max(0, Math.min(1, localTime / cascade.duration));
          const strength = Math.sin(progress * Math.PI);
          const tierBoost = Math.min(0.9, cascade.tier * 0.05);
          // Calculate glow for potential future use with instance attributes
          const glowIntensity = (1 - progress) * (1.3 + tierBoost) * strength;
          // TODO: Apply glowIntensity to instance emissive or edge opacity
          void glowIntensity; // Suppress unused variable warning
        }
      });

      // Clean up completed cascades
      cascadeStateRef.current.forEach((cascade, blockIndex) => {
        const nowSeconds = (typeof performance !== 'undefined' ? performance.now() : Date.now()) / 1000;
        const localTime = nowSeconds - cascade.startSeconds - cascade.delay;
        if (localTime >= cascade.duration) {
          cascadeStateRef.current.delete(blockIndex);
        }
      });
    }
  });

  const maxBlocks = Math.max(100, stackedBlockData.length);

  return (
    <group name="gpu-game-blocks">
      {/* Instanced stacked blocks - SINGLE DRAW CALL */}
      {stackedBlockData.length > 0 && (
        <instancedMesh
          ref={stackedBlocksRef}
          args={[undefined, undefined, maxBlocks]}
          frustumCulled={false}
          castShadow={false}
          receiveShadow={false}
        >
          <boxGeometry args={[1, 1, 1]} />
          <meshStandardMaterial
            color="#3a3a5e"
            roughness={0.3}
            metalness={0.7}
            emissive={isGhost ? "#aaddff" : "#00f2fe"}
            emissiveIntensity={isGhost ? 0.5 : 0.2}
            toneMapped={false}
            vertexColors={true}
            transparent={isGhost}
            opacity={isGhost ? 0.25 : 1.0}
            depthWrite={!isGhost}
          />
        </instancedMesh>
      )}

      {/* Instanced stacked edges - SINGLE DRAW CALL */}
      {stackedBlockData.length > 0 && (
        <instancedMesh
          ref={stackedEdgesRef}
          args={[undefined, undefined, maxBlocks]}
          frustumCulled={false}
          renderOrder={1}
        >
          <boxGeometry args={[1.01, 1.01, 1.01]} />
          <meshBasicMaterial
            color="#00f2fe"
            transparent={true}
            opacity={0.6}
            toneMapped={false}
            vertexColors={true}
            wireframe={true}
            depthTest={true}
            depthWrite={false}
          />
        </instancedMesh>
      )}

      {/* Active moving block - individual mesh for animation */}
      {activeBlock && (
        <group ref={activeBlockRef}>
          <mesh castShadow={false} receiveShadow={false}>
            <boxGeometry args={[
              activeBlock.width / 1000,
              activeBlock.height / 1000,
              (activeBlock.depth || activeBlock.width) / 1000
            ]} />
            <meshStandardMaterial
              color="#3a3a5e"
              roughness={0.3}
              metalness={0.7}
              emissive="#00f2fe"
              emissiveIntensity={0.3}
              toneMapped={false}
            />
          </mesh>

          <lineSegments>
            <edgesGeometry attach="geometry" args={[
              new THREE.BoxGeometry(
                activeBlock.width / 1000,
                activeBlock.height / 1000,
                (activeBlock.depth || activeBlock.width) / 1000
              )
            ]} />
            <lineBasicMaterial
              attach="material"
              color="#00f2fe"
              opacity={1.0}
              transparent={false}
              toneMapped={false}
            />
          </lineSegments>
        </group>
      )}
    </group>
  );
};

/**
 * GPU Instanced Trim Effects
 * For rendering falling/trimmed block pieces efficiently
 */
interface GPUTrimEffectsProps {
  trimEffects: Array<{
    blocks: Block[];
    startTime: number;
  }>;
  currentTime: number;
}

export const GPUTrimEffects: React.FC<GPUTrimEffectsProps> = ({
  trimEffects,
  currentTime,
}) => {
  const trimBlocksRef = useRef<THREE.InstancedMesh>(null);

  const activeTrimData = useMemo(() => {
    const instances: BlockInstanceData[] = [];
    const fallDuration = 2000; // 2 seconds to fall

    trimEffects.forEach((effect) => {
      const elapsed = currentTime - effect.startTime;
      if (elapsed > fallDuration) return; // Skip completed effects

      const fallProgress = elapsed / fallDuration;
      const fallDistance = fallProgress * 20; // Fall 20 units

      effect.blocks.forEach((block) => {
        const x = block.x / 1000;
        const y = block.y / 1000 - fallDistance;
        const z = (block.z || 0) / 1000;
        const width = block.width / 1000;
        const height = block.height / 1000;
        const depth = (block.depth || block.width) / 1000;
        const rotation = ((block.rotation || 0) / 1000) * (Math.PI / 180);

        // Fade out as falling
        const opacity = 1 - fallProgress;

        instances.push({
          position: new THREE.Vector3(x, y + height / 2, z),
          rotation,
          scale: new THREE.Vector3(width, height, depth),
          color: new THREE.Color('#ff6b35').multiplyScalar(opacity),
          edgeColor: new THREE.Color('#ff8c42'),
        });
      });
    });

    return instances;
  }, [trimEffects, currentTime]);

  useEffect(() => {
    const mesh = trimBlocksRef.current;
    if (!mesh || activeTrimData.length === 0) {
      if (mesh) mesh.count = 0;
      return;
    }

    const tempMatrix = new THREE.Matrix4();
    const tempQuaternion = new THREE.Quaternion();
    const tempEuler = new THREE.Euler();

    activeTrimData.forEach((block, i) => {
      tempEuler.set(0, block.rotation, 0);
      tempQuaternion.setFromEuler(tempEuler);
      tempMatrix.compose(block.position, tempQuaternion, block.scale);

      mesh.setMatrixAt(i, tempMatrix);
      mesh.setColorAt(i, block.color);
    });

    mesh.count = activeTrimData.length;
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) {
      mesh.instanceColor.needsUpdate = true;
    }
  }, [activeTrimData]);

  const maxTrimBlocks = 50;

  return (
    <instancedMesh
      ref={trimBlocksRef}
      args={[undefined, undefined, maxTrimBlocks]}
      frustumCulled={false}
    >
      <boxGeometry args={[1, 1, 1]} />
      <meshBasicMaterial
        color="#ff6b35"
        transparent={true}
        opacity={0.8}
        toneMapped={false}
        vertexColors={true}
      />
    </instancedMesh>
  );
};
