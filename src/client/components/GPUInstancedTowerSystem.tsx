/**
 * GPU Instanced Tower System
 * 
 * Ultra high-performance tower rendering using GPU instancing.
 * Reduces draw calls from ~7,500 to ~10-50.
 * 
 * Performance improvements:
 * - Single draw call for all tower blocks
 * - Single draw call for all edges
 * - GPU-based transformations
 * - Minimal CPU overhead
 */

import React, { useRef, useMemo, useEffect, useState, useCallback } from 'react';
import { useFrame } from '@react-three/fiber';
import { Text } from '@react-three/drei';
import * as THREE from 'three';
import { TowerMapEntry } from '../../shared/types/api';
import { MAX_VISIBLE_TOWERS } from '../../shared/constants/towers';

interface GPUInstancedTowerSystemProps {
  isGameOver: boolean;
  playerTower?: TowerMapEntry | null;
  selectedTower?: TowerMapEntry | null;
  onTowerClick?: (tower: TowerMapEntry, position: [number, number, number], rank?: number) => void;
  preAssignedTowers?: TowerMapEntry[] | null | undefined;
  onTowersLoaded?: (towers: TowerMapEntry[]) => void;
}

interface TowerInstancingSnapshot {
  identifier: string;
  sessionId: string | undefined;
  username: string | undefined;
  rank: number;
  blockCount: number;
  worldX: number;
  worldZ: number;
  isPlayerTower: boolean;
  estimatedVertices: number;
}

type TowerBlockSource = TowerMapEntry['towerBlocks'] extends (infer U)[] ? U : never;

interface TowerStreamingBlueprint {
  snapshot: TowerInstancingSnapshot;
  blocks: TowerBlockSource[];
  towerWorldX: number;
  towerWorldZ: number;
  isTopFive: boolean;
  beacon: Array<{ position: THREE.Vector3; color: THREE.Color }>;
}

interface TowerStreamingState extends TowerStreamingBlueprint {
  nextBlockIndex: number;
  beaconEmitted: boolean;
}

interface TowerBlockData {
  // Transform
  position: THREE.Vector3;
  rotation: number;
  scale: THREE.Vector3;

  // Visual properties
  baseColor: THREE.Color;
  edgeColor: THREE.Color;
  emissiveIntensity: number;

  // Metadata
  towerSessionId: string;
  towerIndex: number;
  blockIndex: number;
  isPlayerTower: boolean;
  isSelected: boolean;
  isTopFive: boolean;
  showEdges: boolean;
}

const ENABLE_TOWER_LABELS = false; // Toggle for Drei-based text meshes while perf/CSP fixes are pending

const STREAMING_CONFIG = {
  blocksPerStep: 30,
  msBetweenSteps: 20,
  frameBudgetMs: 5,
} as const;

const TOWER_BATCH_CONFIG = {
  maxVisibleTowers: MAX_VISIBLE_TOWERS,
  initialBatchSize: 20,
  incrementalBatchSize: 40,
  batchCooldownMs: 20,
} as const;

const EDGE_COLORS = {
  default: '#ffa3ff',
  player: '#00f2fe',
  topFive: '#7bff4b',
  selected: '#ffffff',
} as const;

const TRON_VARIANT_COLORS = [
  '#00b4ff', // blue 1
  // '#00f2fe', // blue 2 (lighter / cyan)
  // '#ff7a18', // orange 1
  '#ff4500', // orange 2
] as const;

const getTronVariantForIdentifier = (
  identifier?: string | null
): { colorHex: string; emissiveIntensity: number } => {
  if (!identifier) {
    return { colorHex: EDGE_COLORS.default, emissiveIntensity: 0.12 };
  }

  let hash = 0;
  for (let i = 0; i < identifier.length; i += 1) {
    hash = (hash * 31 + identifier.charCodeAt(i)) >>> 0;
  }

  const colorHex =
    TRON_VARIANT_COLORS[hash % TRON_VARIANT_COLORS.length] ?? EDGE_COLORS.default;
  const intensityVariant = (hash >> 3) % 3;
  const emissiveIntensity = 0.12 + intensityVariant * 0.02;
  return { colorHex, emissiveIntensity };
};

const getEdgeVisualProfile = (params: {
  isPlayerTower: boolean;
  isTopFive: boolean;
  isSelected: boolean;
  identifier?: string | null;
}): { colorHex: string; emissiveIntensity: number } => {
  if (params.isSelected) {
    return { colorHex: EDGE_COLORS.selected, emissiveIntensity: 0.35 };
  }
  if (params.isPlayerTower) {
    return { colorHex: EDGE_COLORS.player, emissiveIntensity: 0.3 };
  }
  if (params.isTopFive) {
    return { colorHex: EDGE_COLORS.topFive, emissiveIntensity: 0.25 };
  }

  return getTronVariantForIdentifier(params.identifier);
};

const getTowerIdentifier = (tower: TowerMapEntry, fallbackIndex: number): string => {
  if (tower.sessionId) {
    return tower.sessionId;
  }

  const base = tower.userId ?? tower.username ?? `tower-${fallbackIndex}`;
  const worldX = Number.isFinite(tower.worldX) ? tower.worldX : 0;
  const worldZ = Number.isFinite(tower.worldZ) ? tower.worldZ : 0;
  return `${base}-${worldX}-${worldZ}-${fallbackIndex}`;
};

/**
 * Main GPU instanced tower system component
 */
export const GPUInstancedTowerSystem: React.FC<GPUInstancedTowerSystemProps> = ({
  isGameOver,
  playerTower,
  selectedTower,
  onTowerClick,
  preAssignedTowers,
  onTowersLoaded,
}) => {
  const blockMeshRef = useRef<THREE.InstancedMesh>(null);
  const edgeMeshRef = useRef<THREE.InstancedMesh>(null);
  const beaconMeshRef = useRef<THREE.InstancedMesh>(null);
  const streamingAccumulatorRef = useRef(0);
  const [blockCapacity, setBlockCapacity] = useState(1000);
  const [edgeCapacity, setEdgeCapacity] = useState(500);
  const [beaconCapacity, setBeaconCapacity] = useState(10);
  const blockDataRef = useRef<TowerBlockData[]>([]);
  const edgeDataRef = useRef<TowerBlockData[]>([]);
  const beaconDataRef = useRef<Array<{ position: THREE.Vector3; color: THREE.Color }>>([]);
  const pendingStreamsRef = useRef<TowerStreamingState[]>([]);
  const loadedTowerCountRef = useRef(0);
  const lastBatchEnqueueTimeRef = useRef(0);
  const rollingBatchUnlockedRef = useRef(false);
  const [blockDataVersion, setBlockDataVersion] = useState(0);
  const [edgeDataVersion, setEdgeDataVersion] = useState(0);
  const [beaconDataVersion, setBeaconDataVersion] = useState(0);
  const completedTowerIdsRef = useRef<Set<string>>(new Set());
  const [, forceCompletedTowerVersion] = useState(0);

  // Combine all towers (player + others)
  const allTowers = useMemo(() => {
    const towers: TowerMapEntry[] = [];

    if (playerTower && playerTower.worldX !== undefined && playerTower.worldZ !== undefined) {
      towers.push(playerTower);
    }

    if (preAssignedTowers) {
      const sortedTowers = preAssignedTowers
        .filter(t => t.sessionId !== playerTower?.sessionId && t.isPersonalBest !== false)
        .sort((a, b) => b.score - a.score);

      const seenUsers = new Set<string>();
      const uniqueTowers = sortedTowers.filter((tower) => {
        if (!tower.userId) return true;
        if (seenUsers.has(tower.userId)) return false;
        seenUsers.add(tower.userId);
        return true;
      });

      towers.push(...uniqueTowers.slice(0, TOWER_BATCH_CONFIG.maxVisibleTowers));
    }

    return towers;
  }, [playerTower, preAssignedTowers]);

  useEffect(() => {
    if (onTowersLoaded) {
      onTowersLoaded(allTowers);
    }
  }, [allTowers, onTowersLoaded]);

  // Prepare tower payloads for streaming into the instanced meshes
  const instancingPlan = useMemo(() => {
    const streams: TowerStreamingBlueprint[] = [];
    const towerSnapshots: TowerInstancingSnapshot[] = [];
    const instancingWarnings: string[] = [];
    let totalBlocks = 0;
    let totalEdges = 0;
    let totalBeacons = 0;
    allTowers.forEach((tower, towerIndex) => {
      const isPlayerTower = tower.sessionId === playerTower?.sessionId;
      const rank = towerIndex;
      const isTopFive = rank < 5;

      const towerWorldX = tower.worldX ?? 0;
      const towerWorldZ = tower.worldZ ?? 0;

      const towerBlocks = Array.isArray(tower.towerBlocks) ? tower.towerBlocks : [];
      const towerIdentifier = getTowerIdentifier(tower, towerIndex);
      const sortedBlocks = [...towerBlocks].sort((a, b) => {
        const aY = a.y ?? 0;
        const bY = b.y ?? 0;
        if (aY !== bY) {
          return aY - bY;
        }
        const aHeight = a.height ?? 0;
        const bHeight = b.height ?? 0;
        return aHeight - bHeight;
      });
      if (towerBlocks.length === 0) {
        console.warn('⚠️ Skipping tower with no block data', {
          sessionId: tower.sessionId,
          userId: tower.userId,
          isPlayerTower,
        });
        return;
      }

      if (towerBlocks.length > 2500) {
        instancingWarnings.push(
          `Tower ${tower.sessionId ?? 'unknown'} has ${towerBlocks.length} blocks (rank ${rank})`
        );
      }

      const snapshot: TowerInstancingSnapshot = {
        identifier: towerIdentifier,
        sessionId: tower.sessionId,
        username: tower.username,
        rank,
        blockCount: towerBlocks.length,
        worldX: towerWorldX,
        worldZ: towerWorldZ,
        isPlayerTower,
        estimatedVertices: towerBlocks.length * 24,
      };

      const beacon = isPlayerTower
        ? [
          {
            position: new THREE.Vector3(
              towerWorldX,
              towerBlocks.reduce((max, block) => {
                const blockTop = block.y / 1000 + block.height / 1000;
                return blockTop > max ? blockTop : max;
              }, 0) + 2,
              towerWorldZ
            ),
            color: new THREE.Color('#00f2fe'),
          },
        ]
        : [];

      streams.push({
        snapshot,
        blocks: sortedBlocks,
        towerWorldX,
        towerWorldZ,
        isTopFive,
        beacon,
      });

      towerSnapshots.push(snapshot);
      totalBlocks += towerBlocks.length;
      totalEdges += towerBlocks.length;
      totalBeacons += beacon.length;
    });

    console.log('🛰️ GPU Instancing summary', {
      totals: {
        towers: towerSnapshots.length,
        blocks: totalBlocks,
        edges: totalEdges,
        beacons: totalBeacons,
      },
      towers: towerSnapshots.slice(0, 25),
      warnings: instancingWarnings,
    });

    return {
      streams,
      totals: {
        towers: towerSnapshots.length,
        blocks: totalBlocks,
        edges: totalEdges,
        beacons: totalBeacons,
      },
    };
  }, [allTowers, playerTower?.sessionId]);

  const streamingTowerIdentifiers = useMemo(() => {
    const identifiers = new Set<string>();
    instancingPlan.streams.forEach((stream) => identifiers.add(stream.snapshot.identifier));
    return identifiers;
  }, [instancingPlan]);

  const enqueueTowerBatch = useCallback(
    (startIndex: number, endIndex: number) => {
      if (startIndex >= endIndex) {
        return;
      }

      const nextStreams = instancingPlan.streams.slice(startIndex, endIndex).map((stream) => ({
        ...stream,
        nextBlockIndex: 0,
        beaconEmitted: false,
      }));

      if (nextStreams.length === 0) {
        return;
      }

      pendingStreamsRef.current.push(...nextStreams);
      loadedTowerCountRef.current = endIndex;
      lastBatchEnqueueTimeRef.current = typeof performance !== 'undefined' ? performance.now() : Date.now();

      console.log('📦 Enqueued tower batch', {
        startIndex,
        endIndex,
        totalStreams: instancingPlan.streams.length,
      });
    },
    [instancingPlan]
  );

  const maintainRollingBatch = useCallback(() => {
    if (!rollingBatchUnlockedRef.current) {
      return;
    }

    const totalStreams = instancingPlan.streams.length;
    if (totalStreams === 0) {
      return;
    }

    const activeStreams = pendingStreamsRef.current.length;
    const alreadyLoaded = loadedTowerCountRef.current;
    const remaining = totalStreams - alreadyLoaded;
    if (remaining <= 0) {
      return;
    }

    const maxConcurrent = Math.min(TOWER_BATCH_CONFIG.incrementalBatchSize, totalStreams);
    if (activeStreams >= maxConcurrent) {
      return;
    }

    const slotsToFill = Math.min(maxConcurrent - activeStreams, remaining);
    const startIndex = alreadyLoaded;
    const endIndex = startIndex + slotsToFill;
    enqueueTowerBatch(startIndex, endIndex);

    console.log('🔁 Rolling batch top-off', {
      activeStreams,
      slotsToFill,
      maxConcurrent,
      remainingAfterTopOff: instancingPlan.streams.length - loadedTowerCountRef.current,
    });
  }, [enqueueTowerBatch, instancingPlan.streams.length]);

  const createBlockData = (
    block: TowerBlockSource,
    stream: TowerStreamingState,
    absoluteBlockIndex: number
  ): TowerBlockData | null => {
    const blockX = block.x / 1000;
    const blockY = block.y / 1000;
    const blockZ = (block.z || 0) / 1000;
    const width = block.width / 1000;
    const height = block.height / 1000;
    const depth = (block.depth || block.width) / 1000;
    const rotation = ((block.rotation || 0) / 1000) * (Math.PI / 180);

    if (!Number.isFinite(width) || !Number.isFinite(height) || !Number.isFinite(depth)) {
      console.warn('⚠️ Invalid block dimensions detected, skipping block', {
        sessionId: stream.snapshot.sessionId,
        blockIndex: absoluteBlockIndex,
      });
      return null;
    }

    const selectedSessionId = selectedTower?.sessionId;
    const isSelected = selectedSessionId ? stream.snapshot.sessionId === selectedSessionId : false;
    const isPlayerTower = stream.snapshot.isPlayerTower;
    const highlightTopFive = stream.isTopFive && !selectedSessionId;

    const { colorHex: edgeColorHex, emissiveIntensity } = getEdgeVisualProfile({
      isPlayerTower,
      isTopFive: highlightTopFive,
      isSelected,
      identifier: stream.snapshot.identifier,
    });

    const showEdges = true;

    return {
      position: new THREE.Vector3(
        stream.towerWorldX + blockX,
        blockY + height / 2,
        stream.towerWorldZ + blockZ
      ),
      rotation,
      scale: new THREE.Vector3(width, height, depth),
      baseColor: new THREE.Color('#1a1a2e'),
      edgeColor: new THREE.Color(edgeColorHex),
      emissiveIntensity,
      towerSessionId: stream.snapshot.sessionId ?? stream.snapshot.identifier,
      towerIndex: stream.snapshot.rank,
      blockIndex: absoluteBlockIndex,
      isPlayerTower,
      isSelected,
      isTopFive: stream.isTopFive,
      showEdges,
    };
  };

  const desiredBlockCapacity = Math.max(1000, instancingPlan.totals.blocks);
  const desiredEdgeCapacity = Math.max(500, instancingPlan.totals.edges);
  const desiredBeaconCapacity = Math.max(10, instancingPlan.totals.beacons);

  // Reset streaming queues whenever the instancing plan changes
  useEffect(() => {
    pendingStreamsRef.current = [];
    blockDataRef.current = [];
    edgeDataRef.current = [];
    beaconDataRef.current = [];
    loadedTowerCountRef.current = 0;
    completedTowerIdsRef.current = new Set();
    rollingBatchUnlockedRef.current = false;
    setBlockDataVersion((v) => v + 1);
    setEdgeDataVersion((v) => v + 1);
    setBeaconDataVersion((v) => v + 1);
    forceCompletedTowerVersion((v) => v + 1);
    lastBatchEnqueueTimeRef.current = typeof performance !== 'undefined' ? performance.now() : Date.now();

    const initialBatchSize = Math.min(
      TOWER_BATCH_CONFIG.initialBatchSize,
      instancingPlan.streams.length
    );
    if (initialBatchSize > 0) {
      enqueueTowerBatch(0, initialBatchSize);
    }
  }, [instancingPlan, enqueueTowerBatch]);

  // Stream tower payloads over multiple frames to avoid large CPU spikes and build towers block-by-block
  useFrame((_, delta) => {
    streamingAccumulatorRef.current += delta * 1000;
    if (streamingAccumulatorRef.current < STREAMING_CONFIG.msBetweenSteps) {
      return;
    }
    streamingAccumulatorRef.current = 0;

    const queue = pendingStreamsRef.current;
    const completedThisFrame: string[] = [];
    if (queue.length === 0) {
      const remaining = instancingPlan.streams.length - loadedTowerCountRef.current;
      if (remaining > 0) {
        const now = typeof performance !== 'undefined' ? performance.now() : Date.now();
        if (now - lastBatchEnqueueTimeRef.current >= TOWER_BATCH_CONFIG.batchCooldownMs) {
          const nextStart = loadedTowerCountRef.current;
          const nextEnd = Math.min(
            nextStart + TOWER_BATCH_CONFIG.incrementalBatchSize,
            instancingPlan.streams.length
          );
          enqueueTowerBatch(nextStart, nextEnd);
          if (nextStart >= TOWER_BATCH_CONFIG.initialBatchSize) {
            rollingBatchUnlockedRef.current = true;
          }
        }
      }
      return;
    }

    const start = typeof performance !== 'undefined' ? performance.now() : Date.now();
    let processedBlocks = 0;
    const newBlocks: TowerBlockData[] = [];
    const newBeacons: Array<{ position: THREE.Vector3; color: THREE.Color }> = [];

    while (queue.length > 0) {
      if (processedBlocks >= STREAMING_CONFIG.blocksPerStep) {
        break;
      }

      const elapsed = (typeof performance !== 'undefined' ? performance.now() : Date.now()) - start;
      if (elapsed >= STREAMING_CONFIG.frameBudgetMs) {
        break;
      }

      const stream = queue.shift();
      if (!stream) {
        break;
      }

      const sourceBlock = stream.blocks[stream.nextBlockIndex];
      if (!sourceBlock) {
        continue;
      }

      const blockData = createBlockData(sourceBlock, stream, stream.nextBlockIndex);
      stream.nextBlockIndex += 1;
      processedBlocks += 1;

      if (blockData) {
        newBlocks.push(blockData);
      }

      if (!stream.beaconEmitted && stream.beacon.length > 0) {
        newBeacons.push(...stream.beacon);
        stream.beaconEmitted = true;
      }

      if (stream.nextBlockIndex < stream.blocks.length) {
        queue.push(stream);
      } else {
        completedThisFrame.push(stream.snapshot.identifier);
      }
    }

    if (newBlocks.length > 0) {
      blockDataRef.current.push(...newBlocks);
      setBlockDataVersion((v) => v + 1);
    }

    if (newBeacons.length > 0) {
      beaconDataRef.current.push(...newBeacons);
      setBeaconDataVersion((v) => v + 1);
    }

    if (completedThisFrame.length > 0) {
      const completedSet = completedTowerIdsRef.current;
      let hasNew = false;
      completedThisFrame.forEach((id) => {
        if (!completedSet.has(id)) {
          completedSet.add(id);
          hasNew = true;
        }
      });

      if (hasNew) {
        forceCompletedTowerVersion((v) => v + 1);
      }
    }

    maintainRollingBatch();

    if (newBlocks.length > 0 && queue.length === 0) {
      if (loadedTowerCountRef.current >= instancingPlan.streams.length) {
        console.log('🚀 Completed tower streaming for instanced renderer');
      }
    }
  });

  useEffect(() => {
    if (desiredBlockCapacity > blockCapacity) {
      setBlockCapacity(desiredBlockCapacity);
    }
  }, [desiredBlockCapacity, blockCapacity]);

  useEffect(() => {
    if (desiredEdgeCapacity > edgeCapacity) {
      setEdgeCapacity(desiredEdgeCapacity);
    }
  }, [desiredEdgeCapacity, edgeCapacity]);

  useEffect(() => {
    if (desiredBeaconCapacity > beaconCapacity) {
      setBeaconCapacity(desiredBeaconCapacity);
    }
  }, [desiredBeaconCapacity, beaconCapacity]);

  // Update block instances
  useEffect(() => {
    const mesh = blockMeshRef.current;
    const blockData = blockDataRef.current;
    if (!mesh) {
      return;
    }

    if (blockData.length === 0) {
      mesh.count = 0;
      return;
    }

    if (blockData.length > blockCapacity) {
      console.warn('⛔ Block data exceeds current instancing capacity, waiting for resize', {
        blockData: blockData.length,
        blockCapacity,
      });
      return;
    }

    const tempMatrix = new THREE.Matrix4();
    const tempQuaternion = new THREE.Quaternion();
    const tempEuler = new THREE.Euler();

    try {
      blockData.forEach((block, i) => {
        tempEuler.set(0, block.rotation, 0);
        tempQuaternion.setFromEuler(tempEuler);
        tempMatrix.compose(block.position, tempQuaternion, block.scale);

        mesh.setMatrixAt(i, tempMatrix);
        mesh.setColorAt(i, block.baseColor);

        // if (i === 0) {
        //   console.log('🔍 First block instance:', {
        //     tower: block.towerSessionId,
        //     position: block.position.toArray(),
        //     scale: block.scale.toArray(),
        //     color: block.baseColor.getHexString(),
        //   });
        // }
      });
    } catch (error) {
      console.error('💥 Failed to update instanced block mesh', {
        error,
        blockCount: blockData.length,
        capacity: blockCapacity,
      });
      return;
    }

    mesh.count = blockData.length;
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) {
      mesh.instanceColor.needsUpdate = true;
    }

    // Ensure mesh is visible
    mesh.visible = true;
    mesh.frustumCulled = false;

    // console.log(`✨ Updated ${blockData.length} instanced blocks (mesh visible: ${mesh.visible})`);
  }, [blockDataVersion, blockCapacity]);

  // Recompute edge data whenever blocks or the active selection changes
  useEffect(() => {
    const selectedSessionId = selectedTower?.sessionId ?? null;
    let blockFlagsUpdated = false;

    blockDataRef.current.forEach((block) => {
      const isSelected = selectedSessionId ? block.towerSessionId === selectedSessionId : false;
      const highlightTopFive = block.isTopFive && !selectedSessionId;
      const { colorHex, emissiveIntensity } = getEdgeVisualProfile({
        isPlayerTower: block.isPlayerTower,
        isTopFive: highlightTopFive,
        isSelected,
        identifier: block.towerSessionId,
      });

      if (!block.showEdges) {
        block.showEdges = true;
        blockFlagsUpdated = true;
      }

      if (block.isSelected !== isSelected) {
        block.isSelected = isSelected;
        blockFlagsUpdated = true;
      }

      if (block.emissiveIntensity !== emissiveIntensity) {
        block.emissiveIntensity = emissiveIntensity;
        blockFlagsUpdated = true;
      }

      const desiredEdgeHex = new THREE.Color(colorHex).getHexString();
      if (block.edgeColor.getHexString() !== desiredEdgeHex) {
        block.edgeColor.set(colorHex);
        blockFlagsUpdated = true;
      }
    });

    const nextEdges = blockDataRef.current.filter((block) => block.showEdges);
    const prevEdges = edgeDataRef.current;
    const edgesChanged =
      blockFlagsUpdated ||
      nextEdges.length !== prevEdges.length ||
      nextEdges.some((block, index) => block !== prevEdges[index]);

    if (edgesChanged) {
      edgeDataRef.current = nextEdges;
      setEdgeDataVersion((v) => v + 1);
    }
  }, [selectedTower?.sessionId, blockDataVersion]);

  // Update edge instances
  useEffect(() => {
    const mesh = edgeMeshRef.current;
    const edgeData = edgeDataRef.current;
    if (!mesh) {
      return;
    }

    if (edgeData.length === 0) {
      mesh.count = 0;
      return;
    }

    if (edgeData.length > edgeCapacity) {
      console.warn('⛔ Edge data exceeds current instancing capacity, waiting for resize', {
        edgeData: edgeData.length,
        edgeCapacity,
      });
      return;
    }

    const tempMatrix = new THREE.Matrix4();
    const tempQuaternion = new THREE.Quaternion();
    const tempEuler = new THREE.Euler();

    try {
      edgeData.forEach((block, i) => {
        tempEuler.set(0, block.rotation, 0);
        tempQuaternion.setFromEuler(tempEuler);
        const edgeScale = new THREE.Vector3(
          block.scale.x * 1.01,
          block.scale.y * 1.01,
          block.scale.z * 1.01
        );
        tempMatrix.compose(block.position, tempQuaternion, edgeScale);

        mesh.setMatrixAt(i, tempMatrix);
        mesh.setColorAt(i, block.edgeColor);
      });
    } catch (error) {
      console.error('💥 Failed to update instanced edge mesh', {
        error,
        edgeCount: edgeData.length,
        capacity: edgeCapacity,
      });
      return;
    }

    mesh.count = edgeData.length;
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) {
      mesh.instanceColor.needsUpdate = true;
    }

    console.log(`✨ Updated ${edgeData.length} instanced edges`);
  }, [edgeDataVersion, edgeCapacity]);

  // Update beacon instances
  useEffect(() => {
    const mesh = beaconMeshRef.current;
    const beaconData = beaconDataRef.current;
    if (!mesh) {
      return;
    }

    if (beaconData.length === 0) {
      mesh.count = 0;
      return;
    }

    if (beaconData.length > beaconCapacity) {
      console.warn('⛔ Beacon data exceeds current instancing capacity, waiting for resize', {
        beaconData: beaconData.length,
        beaconCapacity,
      });
      return;
    }

    const tempMatrix = new THREE.Matrix4();
    const tempPosition = new THREE.Vector3();
    const tempScale = new THREE.Vector3(0.5, 50, 0.5);

    try {
      beaconData.forEach((beacon, i) => {
        tempPosition.copy(beacon.position);
        tempPosition.y += 25;
        tempMatrix.compose(tempPosition, new THREE.Quaternion(), tempScale);

        mesh.setMatrixAt(i, tempMatrix);
        mesh.setColorAt(i, beacon.color);
      });
    } catch (error) {
      console.error('💥 Failed to update instanced beacon mesh', {
        error,
        beaconCount: beaconData.length,
        capacity: beaconCapacity,
      });
      return;
    }

    mesh.count = beaconData.length;
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) {
      mesh.instanceColor.needsUpdate = true;
    }
  }, [beaconDataVersion, beaconCapacity]);

  // Animate beacons
  useFrame((state) => {
    const mesh = beaconMeshRef.current;
    if (!mesh || beaconDataRef.current.length === 0) return;

    const time = state.clock.getElapsedTime();
    const opacity = 0.2 + Math.sin(time * 2) * 0.1;

    // Update material opacity (applies to all instances)
    if (mesh.material && 'opacity' in mesh.material) {
      (mesh.material as any).opacity = opacity;
    }
  });

  // Don't render if game is not over
  if (!isGameOver) {
    return null;
  }

  return (
    <group name="gpu-instanced-towers">
      {/* Instanced solid blocks - SINGLE DRAW CALL */}
      {/* Using meshBasicMaterial for bloom compatibility with brighter base color */}
      {blockDataRef.current.length > 0 && (
        <instancedMesh
          key={`blocks-${blockCapacity}`}
          ref={blockMeshRef}
          args={[undefined, undefined, blockCapacity]}
          frustumCulled={false}
          castShadow={false}
          receiveShadow={false}
        >
          <boxGeometry args={[1, 1, 1]} />
          <meshBasicMaterial
            color="#3a3a5e"
            transparent={false}
            toneMapped={false}
            vertexColors={false}
            side={THREE.FrontSide}
          />
        </instancedMesh>
      )}

      {/* Instanced edges - using wireframe mode since EdgesGeometry doesn't work with instancing */}
      {edgeDataRef.current.length > 0 && (
        <instancedMesh
          key={`edges-${edgeCapacity}`}
          ref={edgeMeshRef}
          args={[undefined, undefined, edgeCapacity]}
          frustumCulled={false}
          renderOrder={1}
        >
          <boxGeometry args={[1, 1, 1]} />
          <meshBasicMaterial
            color="#ffffff"
            transparent={true}
            opacity={1.0}
            toneMapped={false}
            vertexColors={false}
            wireframe={true}
            depthTest={true}
            depthWrite={false}
          />
        </instancedMesh>
      )}

      {/* Player tower beacons - SINGLE DRAW CALL */}
      {beaconDataRef.current.length > 0 && (
        <instancedMesh
          key={`beacons-${beaconCapacity}`}
          ref={beaconMeshRef}
          args={[undefined, undefined, beaconCapacity]}
          frustumCulled={false}
        >
          <cylinderGeometry args={[0.5, 0.5, 50, 8]} />
          <meshBasicMaterial
            color="#00f2fe"
            transparent={true}
            opacity={0.3}
            toneMapped={false}
            vertexColors={true}
          />
        </instancedMesh>
      )}

      {/* Interactive tower hitboxes stay active even when text labels are disabled */}
      {allTowers.map((tower, index) => {
        const towerIdentifier = getTowerIdentifier(tower, index);
        const requiresStreaming = streamingTowerIdentifiers.has(towerIdentifier);
        const isTowerReady = completedTowerIdsRef.current.has(towerIdentifier);

        if (requiresStreaming && !isTowerReady) {
          return null;
        }

        const labelProps: TowerLabelProps = {
          tower,
          rank: index,
          isPlayerTower: tower.sessionId === playerTower?.sessionId,
          isSelected: tower.sessionId === selectedTower?.sessionId,
        };

        // Only add onTowerClick if it exists to avoid TypeScript strict optional issue
        if (onTowerClick) {
          labelProps.onTowerClick = onTowerClick;
        }

        return <TowerLabel key={towerIdentifier} {...labelProps} />;
      })}
    </group>
  );
};

/**
 * Individual tower label for interaction
 * These remain as individual components since they need click handlers
 */
interface TowerLabelProps {
  tower: TowerMapEntry;
  rank: number;
  isPlayerTower: boolean;
  isSelected: boolean;
  onTowerClick?: (tower: TowerMapEntry, position: [number, number, number], rank?: number) => void | undefined;
}

const TowerLabel: React.FC<TowerLabelProps> = ({
  tower,
  rank,
  isPlayerTower,
  isSelected,
  onTowerClick,
}) => {
  const groupRef = useRef<THREE.Group>(null);
  const [pointerStart, setPointerStart] = useState<{ x: number; y: number } | null>(null);

  const position: [number, number, number] = [
    tower.worldX ?? 0,
    0,
    tower.worldZ ?? 0,
  ];

  const labelColor = isSelected ? '#ffffff' : isPlayerTower ? '#00f2fe' : rank < 5 ? '#ffff00' : '#666666';
  const uppercaseUsername = tower.username ? tower.username.toUpperCase() : '';
  const rankDisplay = typeof rank === 'number' ? `#${rank + 1}` : '';
  const showLabelCard = ENABLE_TOWER_LABELS && Boolean(uppercaseUsername || rankDisplay);

  // Calculate tower bounds for clickable area
  const towerBounds = useMemo(() => {
    let minX = Infinity, maxX = -Infinity;
    let minY = Infinity, maxY = -Infinity;
    let minZ = Infinity, maxZ = -Infinity;

    tower.towerBlocks.forEach(block => {
      const x = block.x / 1000;
      const y = block.y / 1000;
      const z = (block.z || 0) / 1000;
      const width = block.width / 1000;
      const height = block.height / 1000;
      const depth = (block.depth || block.width) / 1000;

      minX = Math.min(minX, x - width / 2);
      maxX = Math.max(maxX, x + width / 2);
      minY = Math.min(minY, y);
      maxY = Math.max(maxY, y + height);
      minZ = Math.min(minZ, z - depth / 2);
      maxZ = Math.max(maxZ, z + depth / 2);
    });

    const width = maxX - minX;
    const height = maxY - minY;
    const depth = maxZ - minZ;
    const centerX = (minX + maxX) / 2;
    const centerY = (minY + maxY) / 2;
    const centerZ = (minZ + maxZ) / 2;

    return { width, height, depth, centerX, centerY, centerZ };
  }, [tower.towerBlocks]);

  const towerHeight = Number.isFinite(towerBounds.height) && towerBounds.height > 0 ? towerBounds.height : 2;
  const horizontalSpan = Math.max(
    Number.isFinite(towerBounds.width) ? towerBounds.width : 0,
    Number.isFinite(towerBounds.depth) ? towerBounds.depth : 0
  );
  const sizeMetric = Math.max(towerHeight, horizontalSpan * 1.2);
  const labelScale = Math.min(5, Math.max(1, sizeMetric / 12 + 0.5));
  const labelPlaneWidth = Math.max(3, 4 * labelScale);
  const labelPlaneHeight = Math.max(1, 1.5 * labelScale);
  const labelHeight = towerHeight + Math.max(0.5, 0.35 * labelPlaneHeight);

  const labelText = uppercaseUsername || 'STONEFALL';
  const nameFontSize = Math.max(0.6, labelPlaneHeight * 0.4);
  const rankFontSize = Math.max(0.4, labelPlaneHeight * 0.25);
  const textOutline = 0.02 * labelScale;

  return (
    <group
      ref={groupRef}
      position={position}
    >
      {/* Large invisible clickable box covering entire tower */}
      <mesh
        position={[towerBounds.centerX, towerBounds.centerY, towerBounds.centerZ]}
        onPointerDown={(e) => {
          e.stopPropagation();
          setPointerStart({ x: e.clientX, y: e.clientY });
        }}
        onClick={(e) => {
          e.stopPropagation();

          if (pointerStart) {
            const distance = Math.sqrt(
              Math.pow(e.clientX - pointerStart.x, 2) +
              Math.pow(e.clientY - pointerStart.y, 2)
            );

            if (distance > 5) {
              setPointerStart(null);
              return;
            }
          }

          setPointerStart(null);
          onTowerClick?.(tower, position, rank);
        }}
        onPointerOver={(e) => {
          e.stopPropagation();
          document.body.style.cursor = 'pointer';
        }}
        onPointerOut={(e) => {
          e.stopPropagation();
          document.body.style.cursor = 'default';
        }}
      >
        <boxGeometry args={[
          towerBounds.width + 1,  // Add padding for easier clicking
          towerBounds.height,
          towerBounds.depth + 1
        ]} />
        <meshBasicMaterial
          color={labelColor}
          transparent
          opacity={0.0}  // Invisible but still clickable
          depthWrite={false}
        />
      </mesh>

      {/* Visual selection indicator - only show when selected */}
      {isSelected && (
        <mesh position={[towerBounds.centerX, towerBounds.centerY, towerBounds.centerZ]}>
          <boxGeometry args={[
            towerBounds.width + 0.3,
            towerBounds.height + 0.3,
            towerBounds.depth + 0.3
          ]} />
          <meshBasicMaterial
            color="#00ffff"
            transparent
            opacity={0.1}
            toneMapped={false}
            side={THREE.BackSide}
          />
        </mesh>
      )}

      {/* Base glow ring */}
      {/* <mesh position={[0, -0.1, 0]}>
        <cylinderGeometry args={[2, 2, 0.2, 16]} />
        <meshBasicMaterial
          color={labelColor}
          transparent
          opacity={0.2}
          toneMapped={false}
        />
      </mesh> */}

      {showLabelCard && (
        <group position={[towerBounds.centerX, labelHeight, towerBounds.centerZ]}>
          <mesh>
            <planeGeometry args={[labelPlaneWidth, labelPlaneHeight]} />
            <meshBasicMaterial
              color="#03030a"
              transparent
              opacity={0.65}
              toneMapped={false}
            />
          </mesh>
          <group position={[0, labelPlaneHeight * 0.1, 0]}>
            <Text
              fontSize={nameFontSize}
              color={labelColor}
              anchorX="center"
              anchorY="middle"
              outlineWidth={textOutline}
              outlineColor="black"
              maxWidth={labelPlaneWidth * 0.9}
            >
              {labelText}
            </Text>
            {rankDisplay && (
              <Text
                fontSize={rankFontSize}
                color={labelColor}
                position={[0, -labelPlaneHeight * 0.4, 0]}
                anchorX="center"
                anchorY="middle"
                outlineWidth={textOutline * 0.6}
                outlineColor="black"
              >
                {rankDisplay}
              </Text>
            )}
          </group>
          <group rotation={[0, Math.PI, 0]}>
            <Text
              fontSize={nameFontSize}
              color={labelColor}
              anchorX="center"
              anchorY="middle"
              outlineWidth={textOutline}
              outlineColor="black"
              maxWidth={labelPlaneWidth * 0.9}
            >
              {labelText}
            </Text>
            {rankDisplay && (
              <Text
                fontSize={rankFontSize}
                color={labelColor}
                position={[0, -labelPlaneHeight * 0.4, 0]}
                anchorX="center"
                anchorY="middle"
                outlineWidth={textOutline * 0.6}
                outlineColor="black"
              >
                {rankDisplay}
              </Text>
            )}
          </group>
        </group>
      )}
    </group>
  );
};
