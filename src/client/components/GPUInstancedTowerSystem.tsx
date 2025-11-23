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
import { PlayerColorTheme, getPlayerColorTheme } from '../constants/playerColors';

const ENABLE_TOWER_LABELS = false; // Keep Drei text optional until perf/CSP story is final

const STREAMING_CONFIG = {
  blocksPerStep: 30,
  msBetweenSteps: 20,
  frameBudgetMs: 5,
};

const TOWER_BATCH_CONFIG = {
  maxVisibleTowers: MAX_VISIBLE_TOWERS,
  initialBatchSize: 20,
  incrementalBatchSize: 40,
  batchCooldownMs: 20,
};

const EDGE_COLORS = {
  default: '#ffa3ff',
  player: '#00f2fe',
  topFive: '#7bff4b',
  selected: '#ffffff',
};

const TRON_VARIANT_COLORS = [
  '#00b4ff',
  '#ff4500',
];

const getTronVariantForIdentifier = (identifier?: string | null) => {
  if (!identifier) {
    return { colorHex: EDGE_COLORS.default, emissiveIntensity: 0.12 };
  }

  let hash = 0;
  for (let i = 0; i < identifier.length; i += 1) {
    hash = (hash * 31 + identifier.charCodeAt(i)) >>> 0;
  }

  const colorHex = TRON_VARIANT_COLORS[hash % TRON_VARIANT_COLORS.length] ?? EDGE_COLORS.default;
  const intensityVariant = (hash >> 3) % 3;
  const emissiveIntensity = 0.12 + intensityVariant * 0.02;
  return { colorHex, emissiveIntensity };
};

const getEdgeVisualProfile = (params: {
  isPlayerTower: boolean;
  isTopFive: boolean;
  isSelected: boolean;
  identifier: string | undefined;
}) => {
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

const getTowerIdentifier = (tower: TowerMapEntry, fallbackIndex: number) => {
  if (tower.sessionId) {
    return tower.sessionId;
  }

  const base = tower.userId ?? tower.username ?? `tower-${fallbackIndex}`;
  const worldX = Number.isFinite(tower.worldX) ? tower.worldX : 0;
  const worldZ = Number.isFinite(tower.worldZ) ? tower.worldZ : 0;
  return `${base}-${worldX}-${worldZ}-${fallbackIndex}`;
};

interface GPUInstancedTowerSystemProps {
  isGameOver: boolean;
  playerTower?: TowerMapEntry | null;
  selectedTower?: TowerMapEntry | null;
  onTowerClick?: (tower: TowerMapEntry, position: [number, number, number], rank?: number) => void;
  preAssignedTowers?: TowerMapEntry[] | null | undefined;
  onTowersLoaded?: (towers: TowerMapEntry[]) => void;
  playerColorTheme?: PlayerColorTheme | null | undefined;
}

interface TowerBounds {
  width: number;
  height: number;
  depth: number;
  centerX: number;
  centerY: number;
  centerZ: number;
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
  bounds: TowerBounds;
}

type TowerBlockSource = TowerMapEntry['towerBlocks'] extends (infer U)[] ? U : never;

interface TowerStreamingBlueprint {
  snapshot: TowerInstancingSnapshot;
  blocks: TowerBlockSource[];
  towerWorldX: number;
  towerWorldZ: number;
  isTopFive: boolean;
  beacon: Array<{ position: THREE.Vector3; color: THREE.Color }>;
  towerTheme: PlayerColorTheme | null;
}

interface TowerStreamingState extends TowerStreamingBlueprint {
  nextBlockIndex: number;
  beaconEmitted: boolean;
}

interface TowerBlockData {
  posX: number;
  posY: number;
  posZ: number;
  rotY: number;
  scaleX: number;
  scaleY: number;
  scaleZ: number;
  baseColorHex: number;
  edgeColorHex: number;
  emissiveIntensity: number;
  towerTheme: PlayerColorTheme | null;
  towerSessionId: string;
  towerIndex: number;
  blockIndex: number;
  isPlayerTower: boolean;
  isSelected: boolean;
  isTopFive: boolean;
  showEdges: boolean;
}

export const GPUInstancedTowerSystem: React.FC<GPUInstancedTowerSystemProps> = ({
  isGameOver,
  playerTower,
  selectedTower,
  onTowerClick,
  preAssignedTowers,
  onTowersLoaded,
  playerColorTheme,
}) => {
  const blockMeshRef = useRef<THREE.InstancedMesh | null>(null);
  const edgeMeshRef = useRef<THREE.InstancedMesh | null>(null);
  const beaconMeshRef = useRef<THREE.InstancedMesh | null>(null);
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
  const completedTowerIdsRef = useRef<Set<string>>(new Set());
  const [, forceCompletedTowerVersion] = useState(0);
  const animationStartTimeRef = useRef(0);
  const animationResetRef = useRef(true);

  // Optimization refs for incremental updates
  const lastUpdatedBlockCountRef = useRef(0);
  const lastBlockMeshUuidRef = useRef<string>('');
  const lastUpdatedEdgeCountRef = useRef(0);
  const lastEdgeMeshUuidRef = useRef<string>('');
  const lastSelectionRef = useRef<string | undefined>(undefined);
  const blockUploadScheduledRef = useRef(false);
  const edgeUploadScheduledRef = useRef(false);
  const beaconUploadScheduledRef = useRef(false);

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
      const towerTheme = tower.playerColorChoice
        ? getPlayerColorTheme(tower.playerColorChoice)
        : null;

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

      // Calculate bounds once during planning
      let minX = Infinity, maxX = -Infinity;
      let minY = Infinity, maxY = -Infinity;
      let minZ = Infinity, maxZ = -Infinity;

      towerBlocks.forEach(block => {
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

      // Handle empty or invalid bounds
      if (minX === Infinity) {
        minX = -1; maxX = 1;
        minY = 0; maxY = 2;
        minZ = -1; maxZ = 1;
      }

      const bounds: TowerBounds = {
        width: maxX - minX,
        height: maxY - minY,
        depth: maxZ - minZ,
        centerX: (minX + maxX) / 2,
        centerY: (minY + maxY) / 2,
        centerZ: (minZ + maxZ) / 2,
      };

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
        bounds,
      };

      const beaconTheme = isPlayerTower ? playerColorTheme ?? towerTheme : towerTheme;
      const beacon = isPlayerTower
        ? [
          {
            position: new THREE.Vector3(
              towerWorldX,
              maxY + 2,
              towerWorldZ
            ),
            color: new THREE.Color(beaconTheme?.beaconHex ?? '#00f2fe'),
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
        towerTheme,
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
  }, [allTowers, playerColorTheme, playerTower?.sessionId]);

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
    const storedTowerTheme = stream.towerTheme;
    const runtimeTowerTheme = isPlayerTower
      ? playerColorTheme ?? storedTowerTheme
      : storedTowerTheme;

    const profile = getEdgeVisualProfile({
      isPlayerTower,
      isTopFive: highlightTopFive,
      isSelected,
      identifier: stream.snapshot.identifier,
    });
    let edgeColorHex = profile.colorHex;
    let emissiveIntensity = profile.emissiveIntensity;

    if (!isSelected && runtimeTowerTheme) {
      edgeColorHex = runtimeTowerTheme.accentHex;
      const minimumGlow = isPlayerTower ? 0.32 : 0.24;
      emissiveIntensity = Math.max(emissiveIntensity, minimumGlow);
    }

    const blockBaseHex = runtimeTowerTheme?.blockBaseHex ?? '#1a1a2e';
    const showEdges = true;

    return {
      posX: stream.towerWorldX + blockX,
      posY: blockY + height / 2,
      posZ: stream.towerWorldZ + blockZ,
      rotY: rotation,
      scaleX: width,
      scaleY: height,
      scaleZ: depth,
      baseColorHex: new THREE.Color(blockBaseHex).getHex(),
      edgeColorHex: new THREE.Color(edgeColorHex).getHex(),
      emissiveIntensity,
      towerTheme: runtimeTowerTheme ?? null,
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

  // Track previous plan to detect incremental updates
  const prevInstancingPlanRef = useRef<typeof instancingPlan | null>(null);

  // Reset streaming queues whenever the instancing plan changes
  useEffect(() => {
    // Check if this is an incremental update (append)
    const prevPlan = prevInstancingPlanRef.current;
    const isIncremental = Boolean(
      prevPlan &&
      instancingPlan.streams.length > prevPlan.streams.length &&
      instancingPlan.streams.length > 0 &&
      prevPlan.streams.length > 0 &&
      instancingPlan.streams[0]?.snapshot.identifier === prevPlan.streams[0]?.snapshot.identifier
    );

    prevInstancingPlanRef.current = instancingPlan;

    if (isIncremental) {
      // For incremental updates, we rely on the useFrame loop to pick up the new towers
      // via the (remaining > 0) check.
      return;
    }

    pendingStreamsRef.current = [];
    blockDataRef.current = [];
    edgeDataRef.current = [];
    beaconDataRef.current = [];
    loadedTowerCountRef.current = 0;
    completedTowerIdsRef.current = new Set();
    rollingBatchUnlockedRef.current = false;

    // Reset optimization counters
    lastUpdatedBlockCountRef.current = 0;
    lastUpdatedEdgeCountRef.current = 0;
    blockUploadScheduledRef.current = true;
    edgeUploadScheduledRef.current = true;
    beaconUploadScheduledRef.current = true;
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
    processScheduledUploads();

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
      newBlocks.forEach((block) => {
        if (block.showEdges) {
          edgeDataRef.current.push(block);
        }
      });
      blockUploadScheduledRef.current = true;
      edgeUploadScheduledRef.current = true;
    }

    if (newBeacons.length > 0) {
      beaconDataRef.current.push(...newBeacons);
      beaconUploadScheduledRef.current = true;
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

    processScheduledUploads();
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

  const flushBlockInstances = useCallback(() => {
    const mesh = blockMeshRef.current;
    const blockData = blockDataRef.current;
    if (!mesh) {
      return false;
    }

    if (blockData.length === 0) {
      mesh.count = 0;
      lastUpdatedBlockCountRef.current = 0;
      return true;
    }

    if (mesh.uuid !== lastBlockMeshUuidRef.current) {
      lastUpdatedBlockCountRef.current = 0;
      lastBlockMeshUuidRef.current = mesh.uuid;
    }

    if (blockData.length < lastUpdatedBlockCountRef.current) {
      lastUpdatedBlockCountRef.current = 0;
    }

    if (blockData.length > blockCapacity) {
      console.warn('⛔ Block data exceeds current instancing capacity, waiting for resize', {
        blockData: blockData.length,
        blockCapacity,
      });
      return false;
    }

    const startIndex = lastUpdatedBlockCountRef.current;
    const tempMatrix = new THREE.Matrix4();
    const tempQuaternion = new THREE.Quaternion();
    const tempEuler = new THREE.Euler();
    const tempPosition = new THREE.Vector3();
    const tempScale = new THREE.Vector3();
    const tempColor = new THREE.Color();

    try {
      for (let i = startIndex; i < blockData.length; i++) {
        const block = blockData[i];
        if (!block) {
          continue;
        }
        tempEuler.set(0, block.rotY, 0);
        tempQuaternion.setFromEuler(tempEuler);
        tempPosition.set(block.posX, block.posY, block.posZ);
        tempScale.set(block.scaleX, block.scaleY, block.scaleZ);
        tempMatrix.compose(tempPosition, tempQuaternion, tempScale);

        mesh.setMatrixAt(i, tempMatrix);
        tempColor.setHex(block.baseColorHex);
        mesh.setColorAt(i, tempColor);
      }
    } catch (error) {
      console.error('💥 Failed to update instanced block mesh', {
        error,
        blockCount: blockData.length,
        capacity: blockCapacity,
      });
      return false;
    }

    lastUpdatedBlockCountRef.current = blockData.length;

    mesh.count = blockData.length;
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) {
      mesh.instanceColor.needsUpdate = true;
    }

    mesh.visible = true;
    mesh.frustumCulled = false;
    return true;
  }, [blockCapacity]);

  const flushEdgeInstances = useCallback(() => {
    const mesh = edgeMeshRef.current;
    const edgeData = edgeDataRef.current;
    const currentSelection = selectedTower?.sessionId;
    if (!mesh) {
      return false;
    }

    if (edgeData.length === 0) {
      mesh.count = 0;
      lastUpdatedEdgeCountRef.current = 0;
      return true;
    }

    let forceFullUpdate = false;
    if (mesh.uuid !== lastEdgeMeshUuidRef.current) {
      forceFullUpdate = true;
      lastEdgeMeshUuidRef.current = mesh.uuid;
    }
    if (currentSelection !== lastSelectionRef.current) {
      forceFullUpdate = true;
      lastSelectionRef.current = currentSelection;
    }
    if (edgeData.length < lastUpdatedEdgeCountRef.current) {
      forceFullUpdate = true;
    }

    if (forceFullUpdate) {
      lastUpdatedEdgeCountRef.current = 0;
    }

    if (edgeData.length > edgeCapacity) {
      console.warn('⛔ Edge data exceeds current instancing capacity, waiting for resize', {
        edgeData: edgeData.length,
        edgeCapacity,
      });
      return false;
    }

    const startIndex = lastUpdatedEdgeCountRef.current;
    const tempMatrix = new THREE.Matrix4();
    const tempQuaternion = new THREE.Quaternion();
    const tempEuler = new THREE.Euler();
    const tempPosition = new THREE.Vector3();
    const tempScale = new THREE.Vector3();
    const tempColor = new THREE.Color();

    try {
      for (let i = startIndex; i < edgeData.length; i++) {
        const block = edgeData[i];
        if (!block) {
          continue;
        }
        tempEuler.set(0, block.rotY, 0);
        tempQuaternion.setFromEuler(tempEuler);
        tempPosition.set(block.posX, block.posY, block.posZ);
        const edgeScale = tempScale.set(
          block.scaleX * 1.01,
          block.scaleY * 1.01,
          block.scaleZ * 1.01
        );
        tempMatrix.compose(tempPosition, tempQuaternion, edgeScale);

        mesh.setMatrixAt(i, tempMatrix);
        tempColor.setHex(block.edgeColorHex);
        mesh.setColorAt(i, tempColor);
      }
    } catch (error) {
      console.error('💥 Failed to update instanced edge mesh', {
        error,
        edgeCount: edgeData.length,
        capacity: edgeCapacity,
      });
      return false;
    }

    lastUpdatedEdgeCountRef.current = edgeData.length;
    mesh.count = edgeData.length;
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) {
      mesh.instanceColor.needsUpdate = true;
    }

    return true;
  }, [edgeCapacity, selectedTower?.sessionId]);

  const flushBeaconInstances = useCallback(() => {
    const mesh = beaconMeshRef.current;
    const beaconData = beaconDataRef.current;
    if (!mesh) {
      return false;
    }

    if (beaconData.length === 0) {
      mesh.count = 0;
      return true;
    }

    if (beaconData.length > beaconCapacity) {
      console.warn('⛔ Beacon data exceeds current instancing capacity, waiting for resize', {
        beaconData: beaconData.length,
        beaconCapacity,
      });
      return false;
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
      return false;
    }

    mesh.count = beaconData.length;
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) {
      mesh.instanceColor.needsUpdate = true;
    }

    return true;
  }, [beaconCapacity]);

  const processScheduledUploads = useCallback(() => {
    if (blockUploadScheduledRef.current && flushBlockInstances()) {
      blockUploadScheduledRef.current = false;
    }
    if (edgeUploadScheduledRef.current && flushEdgeInstances()) {
      edgeUploadScheduledRef.current = false;
    }
    if (beaconUploadScheduledRef.current && flushBeaconInstances()) {
      beaconUploadScheduledRef.current = false;
    }
  }, [flushBlockInstances, flushEdgeInstances, flushBeaconInstances]);

  // Recompute edge data whenever the active selection changes
  useEffect(() => {
    const selectedSessionId = selectedTower?.sessionId ?? null;
    let blockFlagsUpdated = false;

    blockDataRef.current.forEach((block) => {
      const isSelected = selectedSessionId ? block.towerSessionId === selectedSessionId : false;
      const highlightTopFive = block.isTopFive && !selectedSessionId;
      const profile = getEdgeVisualProfile({
        isPlayerTower: block.isPlayerTower,
        isTopFive: highlightTopFive,
        isSelected,
        identifier: block.towerSessionId,
      });
      let edgeColorHex = profile.colorHex;
      let emissiveIntensity = profile.emissiveIntensity;

      if (!isSelected && block.towerTheme) {
        edgeColorHex = block.towerTheme.accentHex;
        const minimumGlow = block.isPlayerTower ? 0.32 : 0.24;
        emissiveIntensity = Math.max(emissiveIntensity, minimumGlow);
      }

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

      const desiredEdgeHex = new THREE.Color(edgeColorHex).getHex();
      if (block.edgeColorHex !== desiredEdgeHex) {
        block.edgeColorHex = desiredEdgeHex;
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
      lastUpdatedEdgeCountRef.current = 0;
      edgeUploadScheduledRef.current = true;
    } else if (blockFlagsUpdated) {
      lastUpdatedEdgeCountRef.current = 0;
      edgeUploadScheduledRef.current = true;
    }
  }, [selectedTower?.sessionId]);


  // Animate beacons
  useFrame((state) => {
    const mesh = beaconMeshRef.current;
    const now = state.clock.getElapsedTime();

    if (animationResetRef.current) {
      animationStartTimeRef.current = now;
      animationResetRef.current = false;
    }

    const time = now - animationStartTimeRef.current;

    if (mesh && beaconDataRef.current.length > 0) {
      const opacity = 0.2 + Math.sin(now * 2) * 0.1;
      // Update material opacity (applies to all instances)
      if (mesh.material && 'opacity' in mesh.material) {
        (mesh.material as any).opacity = opacity;
      }
    }

    // Update block animation time
    const blockMesh = blockMeshRef.current;
    if (blockMesh && blockMesh.material) {
      const material = blockMesh.material as THREE.ShaderMaterial;
      if (material.userData?.shader) {
        material.userData.shader.uniforms.uTime.value = time;
      }
    }
  });

  // Don't render if game is not over
  if (!isGameOver) {
    return null;
  }

  return (
    <group name="gpu-instanced-towers">
      {/* Instanced solid blocks - SINGLE DRAW CALL */}
      {/* Using meshStandardMaterial for better visuals and custom shader animation */}
      {blockDataRef.current.length > 0 && (
        <instancedMesh
          key={`blocks-${blockCapacity}`}
          ref={blockMeshRef}
          args={[undefined, undefined, blockCapacity]}
          frustumCulled={false}
        >
          <boxGeometry args={[1, 1, 1]} />
          <meshBasicMaterial
            color="#3a3a5e"
            transparent={false}
            toneMapped={false}
            side={THREE.FrontSide}
            onBeforeCompile={(shader) => {
              shader.uniforms.uTime = { value: 0 };
              // Save reference to shader for updates
              if (blockMeshRef.current && blockMeshRef.current.material) {
                (blockMeshRef.current.material as any).userData.shader = shader;
              }

              shader.vertexShader = 'uniform float uTime;\n' + shader.vertexShader;
              shader.vertexShader = shader.vertexShader.replace(
                '#include <begin_vertex>',
                `
                #include <begin_vertex>
                // Instance position is in instanceMatrix[3]
                float dist = length(instanceMatrix[3].xz);
                float delay = dist * 0.05;
                // Animate scale from 0 to 1
                float scale = smoothstep(0.0, 1.0, (uTime - delay) * 0.5); 
                
                // Scale from bottom (-0.5)
                transformed.y = (transformed.y + 0.5) * scale - 0.5;
                `
              );
            }}
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
          bounds: instancingPlan.streams.find(s => s.snapshot.identifier === towerIdentifier)?.snapshot.bounds,
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
  bounds?: TowerBounds | undefined;
}

const TowerLabel: React.FC<TowerLabelProps> = ({
  tower,
  rank,
  isPlayerTower,
  isSelected,
  onTowerClick,
  bounds,
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

  // Use pre-calculated bounds or fallback
  const towerBounds = bounds || {
    width: 2,
    height: 2,
    depth: 2,
    centerX: 0,
    centerY: 1,
    centerZ: 0
  };

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

export default GPUInstancedTowerSystem;
