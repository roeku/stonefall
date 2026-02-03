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
import * as THREE from 'three';
import { TowerMapEntry } from '../../shared/types/api';
import { MAX_VISIBLE_TOWERS } from '../../shared/constants/towers';
import { PlayerColorTheme, getPlayerColorTheme, PLAYER_COLOR_THEMES } from '../constants/playerColors';

const DEBUG_GPU_TOWERS = false;

const STREAMING_CONFIG = {
  blocksPerStep: 80,
  msBetweenSteps: 20,
  frameBudgetMs: 5,
};

const MOBILE_STREAMING_CONFIG = {
  blocksPerStep: 35,
  msBetweenSteps: 45,
  frameBudgetMs: 3,
};

const TOWER_BATCH_CONFIG = {
  maxVisibleTowers: MAX_VISIBLE_TOWERS,
  initialBatchSize: 50,
  incrementalBatchSize: 50,
  batchCooldownMs: 0,
};

const MOBILE_TOWER_BATCH_CONFIG = {
  maxVisibleTowers: Math.max(50, Math.floor(MAX_VISIBLE_TOWERS * 0.6)),
  initialBatchSize: 20,
  incrementalBatchSize: 20,
  batchCooldownMs: 20,
};

const getTowerIdentifier = (tower: TowerMapEntry, fallbackIndex: number) => {
  if (!tower) return `tower-null-${fallbackIndex}`;
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
  expectedTotalTowers?: number;
  leadingColor?: 'blue' | 'orange' | null;
  /**
   * Percentage of BLUE among known-color towers (0-100). Used to distribute unknown towers.
   * Note: the renderer currently uses a fixed 50/50 split for unknown towers.
   */
  fallbackBluePercentage?: number | null;
  /**
   * Set of tower session IDs that have been defeated in challenge mode.
   * These towers will be rendered with a red outline indicator.
   */
  defeatedTowerIds?: Set<string> | undefined;
}

const hashToUnitFloat = (input: string): number => {
  // Lightweight deterministic hash (FNV-1a-ish) mapped to [0, 1).
  let hash = 2166136261;
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  // Convert to unsigned and normalize.
  return (hash >>> 0) / 4294967296;
};

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

interface TowerInstancingPlanTotals {
  towers: number;
  blocks: number;
  edges: number;
  beacons: number;
}

interface TowerInstancingPlan {
  streams: TowerStreamingBlueprint[];
  totals: TowerInstancingPlanTotals;
  towerSignatures: Map<string, string>;
}

const MAX_BLOCK_HASH_SAMPLES = 64;

const fingerprintTowerBlocks = (blocks: TowerBlockSource[]): string => {
  let hash = 0;
  const sampleCount = Math.min(blocks.length, MAX_BLOCK_HASH_SAMPLES);
  for (let i = 0; i < sampleCount; i += 1) {
    const block = blocks[i];
    if (!block) {
      continue;
    }
    hash = (hash * 31 + Math.round(block.x ?? 0)) | 0;
    hash = (hash * 31 + Math.round(block.y ?? 0)) | 0;
    hash = (hash * 31 + Math.round(block.height ?? 0)) | 0;
    hash = (hash * 31 + Math.round(block.rotation ?? 0)) | 0;
  }
  return (hash >>> 0).toString(16);
};

const setAttributeUpdateRange = (
  attribute: THREE.BufferAttribute,
  offset: number,
  count: number
) => {
  const anyAttribute = attribute as any;
  if (typeof anyAttribute.clearUpdateRanges === 'function' && typeof anyAttribute.addUpdateRange === 'function') {
    anyAttribute.clearUpdateRanges();
    anyAttribute.addUpdateRange(offset, count);
    return;
  }
  if (anyAttribute.updateRange) {
    anyAttribute.updateRange.offset = offset;
    anyAttribute.updateRange.count = count;
  }
};

const createTowerSignature = (
  snapshot: TowerInstancingSnapshot,
  towerBlocks: TowerBlockSource[],
  tower: TowerMapEntry,
  isTopFive: boolean
): string => {
  const blockHash = fingerprintTowerBlocks(towerBlocks);
  return [
    snapshot.identifier,
    isTopFive ? 'top5' : 'std', // Use isTopFive instead of rank to avoid rebuilding on list reorders
    snapshot.blockCount,
    tower.score ?? 0,
    tower.perfectStreak ?? 0,
    tower.timestamp ?? 0,
    tower.worldX ?? 0,
    tower.worldZ ?? 0,
    blockHash
  ].join('|');
};

const areSignatureMapsEqual = (
  prev: Map<string, string> | null,
  next: Map<string, string>
): boolean => {
  if (!prev) {
    return false;
  }
  if (prev.size !== next.size) {
    return false;
  }
  for (const [identifier, signature] of next.entries()) {
    if (prev.get(identifier) !== signature) {
      return false;
    }
  }
  return true;
};

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
  towerSessionId: string;
  towerIndex: number;
  blockIndex: number;
  isPlayerTower: boolean;
  isSelected: boolean;
  isTopFive: boolean;
  showEdges: boolean;
  isDefeated: boolean;
}

export const GPUInstancedTowerSystem: React.FC<GPUInstancedTowerSystemProps> = ({
  isGameOver,
  playerTower,
  selectedTower,
  onTowerClick,
  preAssignedTowers,
  onTowersLoaded,
  playerColorTheme,
  leadingColor: _leadingColor = null,
  fallbackBluePercentage: _fallbackBluePercentage = null,
  expectedTotalTowers,
  defeatedTowerIds,
}) => {
  const [viewportSize, setViewportSize] = useState<{ width: number; height: number }>({
    width: 0,
    height: 0,
  });

  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }

    const updateViewportSize = () => {
      const root = document.documentElement;
      const width = root?.clientWidth ?? window.innerWidth;
      const height = root?.clientHeight ?? window.innerHeight;
      setViewportSize({ width, height });
    };

    updateViewportSize();

    if ('ResizeObserver' in window) {
      const observer = new ResizeObserver((entries) => {
        const entry = entries[0];
        if (entry?.contentRect) {
          setViewportSize({
            width: entry.contentRect.width,
            height: entry.contentRect.height,
          });
        } else {
          updateViewportSize();
        }
      });
      const target = document.documentElement ?? document.body;
      if (target) {
        observer.observe(target);
      }
      return () => observer.disconnect();
    }

    window.addEventListener('resize', updateViewportSize);
    return () => window.removeEventListener('resize', updateViewportSize);
  }, []);

  const isMobile = useMemo(() => {
    if (!viewportSize.width || !viewportSize.height) {
      return false;
    }
    const minDim = Math.min(viewportSize.width, viewportSize.height);
    return minDim <= 768;
  }, [viewportSize]);

  const streamingConfig = useMemo(
    () => (isMobile ? MOBILE_STREAMING_CONFIG : STREAMING_CONFIG),
    [isMobile]
  );

  const towerBatchConfig = useMemo(
    () => (isMobile ? MOBILE_TOWER_BATCH_CONFIG : TOWER_BATCH_CONFIG),
    [isMobile]
  );

  // Determine a stable fallback theme for towers that don't have an explicit playerColorChoice.
  // Unknown towers always use a deterministic 50/50 split.
  const getFallbackChoiceForIdentifier = useCallback(
    (identifier: string): 'blue' | 'orange' | null => {
      return hashToUnitFloat(identifier) < 0.5 ? 'blue' : 'orange';
    },
    []
  );

  const getFallbackAccentHex = useCallback(
    (identifier: string): string => {
      const choice = getFallbackChoiceForIdentifier(identifier);
      if (choice === 'blue') {
        return PLAYER_COLOR_THEMES.blue.accentHex;
      }
      if (choice === 'orange') {
        return PLAYER_COLOR_THEMES.orange.accentHex;
      }
      return '#00f2fe';
    },
    [getFallbackChoiceForIdentifier]
  );

  const getFallbackBeaconHex = useCallback(
    (identifier: string): string => {
      const choice = getFallbackChoiceForIdentifier(identifier);
      if (choice === 'blue') {
        return PLAYER_COLOR_THEMES.blue.beaconHex;
      }
      if (choice === 'orange') {
        return PLAYER_COLOR_THEMES.orange.beaconHex;
      }
      return '#00f2fe';
    },
    [getFallbackChoiceForIdentifier]
  );

  const blockMeshRef = useRef<THREE.InstancedMesh | null>(null);
  const edgeMeshRef = useRef<THREE.InstancedMesh | null>(null);
  const beaconMeshRef = useRef<THREE.InstancedMesh | null>(null);
  const hitboxMeshRef = useRef<THREE.InstancedMesh | null>(null);
  const pointerStartRef = useRef<{ x: number; y: number; instanceId: number } | null>(null);
  const streamingAccumulatorRef = useRef(0);
  const [blockCapacity, setBlockCapacity] = useState(() => {
    if (expectedTotalTowers) {
      const estimatedTotalBlocks = expectedTotalTowers * 25;
      return Math.max(5000, Math.ceil((estimatedTotalBlocks * 1.2) / 1000) * 1000);
    }
    return 1000;
  });
  const [edgeCapacity, setEdgeCapacity] = useState(() => {
    if (expectedTotalTowers) {
      const estimatedTotalBlocks = expectedTotalTowers * 25;
      return Math.max(2500, Math.ceil((estimatedTotalBlocks * 1.2) / 500) * 500);
    }
    return 500;
  });
  const [beaconCapacity, setBeaconCapacity] = useState(10);
  const blockDataRef = useRef<TowerBlockData[]>([]);
  const edgeDataRef = useRef<TowerBlockData[]>([]);
  const beaconDataRef = useRef<Array<{ position: THREE.Vector3; color: THREE.Color }>>([]);
  const pendingStreamsRef = useRef<TowerStreamingState[]>([]);
  const loadedTowerCountRef = useRef(0);
  const lastBatchEnqueueTimeRef = useRef(0);
  const rollingBatchUnlockedRef = useRef(false);
  const completedTowerIdsRef = useRef<Set<string>>(new Set());
  const [completedTowerVersion, forceCompletedTowerVersion] = useState(0);
  const animationStartTimeRef = useRef(0);
  const animationResetRef = useRef(true);

  // Optimization refs for incremental updates
  const lastUpdatedBlockCountRef = useRef(0);
  const lastBlockMeshUuidRef = useRef<string>('');
  const lastUpdatedEdgeCountRef = useRef(0);
  const lastEdgeMeshUuidRef = useRef<string>('');
  const lastUpdatedEdgeColorCountRef = useRef(0);
  const lastEdgeColorMeshUuidRef = useRef<string>('');
  const lastBeaconMeshUuidRef = useRef<string>(''); // Add this
  const blockUploadScheduledRef = useRef(false);
  const edgeUploadScheduledRef = useRef(false);
  const beaconUploadScheduledRef = useRef(false);

  // Combine all towers (player + others)
  const allTowers = useMemo(() => {
    const towers: TowerMapEntry[] = [];
    const includedSessionIds = new Set<string>();

    // 1. Player Tower
    if (playerTower && playerTower.worldX !== undefined && playerTower.worldZ !== undefined) {
      towers.push(playerTower);
      includedSessionIds.add(playerTower.sessionId);
    }

    // 2. Leaderboard Towers
    if (preAssignedTowers && Array.isArray(preAssignedTowers)) {
      const sortedTowers = preAssignedTowers
        .filter(t => t && !includedSessionIds.has(t.sessionId))
        .sort((a, b) => (b.score || 0) - (a.score || 0));

      // Note: User deduplication is handled by the preloader based on leaderboard type
      // (all-time: deduplicated, daily: not deduplicated)
      // Here we just need to avoid duplicate sessions and enforce the max visible limit
      const slice = sortedTowers.slice(0, towerBatchConfig.maxVisibleTowers);
      towers.push(...slice);
      slice.forEach(t => includedSessionIds.add(t.sessionId));
    }

    // 3. Selected Tower (ensure it's visible even if not in leaderboard)
    // We add it at the end if not already included to avoid shifting indices of leaderboard towers
    if (selectedTower && selectedTower.worldX !== undefined && selectedTower.worldZ !== undefined) {
      if (!includedSessionIds.has(selectedTower.sessionId)) {
        towers.push(selectedTower);
        includedSessionIds.add(selectedTower.sessionId);
      }
    }

    return towers;
  }, [playerTower, preAssignedTowers, selectedTower, towerBatchConfig]);

  useEffect(() => {
    if (onTowersLoaded) {
      onTowersLoaded(allTowers);
    }
  }, [allTowers, onTowersLoaded]);

  // Prepare tower payloads for streaming into the instanced meshes
  const instancingPlan = useMemo<TowerInstancingPlan>(() => {
    const streams: TowerStreamingBlueprint[] = [];
    const towerSnapshots: TowerInstancingSnapshot[] = [];
    const instancingWarnings: string[] = [];
    const towerSignatures = new Map<string, string>();
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

      towerBlocks.forEach((block) => {
        const x = (block.x ?? 0) / 1000;
        const y = (block.y ?? 0) / 1000;
        const z = (block.z ?? 0) / 1000;
        const width = (block.width ?? 0) / 1000;
        const height = (block.height ?? 0) / 1000;
        const depth = ((block.depth ?? block.width) ?? 0) / 1000;

        minX = Math.min(minX, x - width / 2);
        maxX = Math.max(maxX, x + width / 2);
        minY = Math.min(minY, y);
        maxY = Math.max(maxY, y + height);
        minZ = Math.min(minZ, z - depth / 2);
        maxZ = Math.max(maxZ, z + depth / 2);
      });

      // Handle empty or invalid bounds
      if (minX === Infinity) {
        // Default bounds for towers with no blocks or invalid data
        // Make it large enough to be clickable
        minX = -1.5; maxX = 1.5;
        minY = 0; maxY = 4;
        minZ = -1.5; maxZ = 1.5;
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
      const defaultBeaconHex = getFallbackBeaconHex(towerIdentifier);
      const beacon = isPlayerTower
        ? [
          {
            position: new THREE.Vector3(
              towerWorldX,
              maxY + 2,
              towerWorldZ
            ),
            color: new THREE.Color(beaconTheme?.beaconHex ?? defaultBeaconHex),
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

      towerSignatures.set(
        snapshot.identifier,
        createTowerSignature(snapshot, sortedBlocks, tower, isTopFive)
      );

      towerSnapshots.push(snapshot);
      totalBlocks += towerBlocks.length;
      totalEdges += towerBlocks.length;
      totalBeacons += beacon.length;
    });

    if (DEBUG_GPU_TOWERS) {
      console.log('🛰️ GPU Instancing summary', {
        totals: {
          towers: towerSnapshots.length,
          blocks: totalBlocks,
          edges: totalEdges,
          beacons: totalBeacons,
        },
        warnings: instancingWarnings,
      });
    }

    return {
      streams,
      totals: {
        towers: towerSnapshots.length,
        blocks: totalBlocks,
        edges: totalEdges,
        beacons: totalBeacons,
      },
      towerSignatures,
    };
  }, [allTowers, playerColorTheme, playerTower?.sessionId]);

  const towerColorByIdentifier = useMemo(() => {
    const map = new Map<string, THREE.Color>();
    instancingPlan.streams.forEach((stream) => {
      const themeForBlocks = stream.snapshot.isPlayerTower
        ? playerColorTheme ?? stream.towerTheme
        : stream.towerTheme;
      const hex = themeForBlocks?.accentHex ?? getFallbackAccentHex(stream.snapshot.identifier);
      map.set(stream.snapshot.identifier, new THREE.Color(hex));
    });
    return map;
  }, [instancingPlan.streams, playerColorTheme, getFallbackAccentHex]);

  const towerColorVersion = useMemo(() => {
    return instancingPlan.streams
      .map((stream) => {
        const themeForBlocks = stream.snapshot.isPlayerTower
          ? playerColorTheme ?? stream.towerTheme
          : stream.towerTheme;
        const hex = themeForBlocks?.accentHex ?? getFallbackAccentHex(stream.snapshot.identifier);
        return `${stream.snapshot.identifier}:${hex}`;
      })
      .join('|');
  }, [instancingPlan.streams, playerColorTheme, getFallbackAccentHex]);

  // Ensure instance colors refresh when themes change (and recover from fast refresh).
  useEffect(() => {
    lastUpdatedEdgeColorCountRef.current = 0;
    edgeUploadScheduledRef.current = true;
    beaconUploadScheduledRef.current = true;
  }, [towerColorVersion]);

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

      const nextStreams = instancingPlan.streams
        .slice(startIndex, endIndex)
        .filter((stream) => !completedTowerIdsRef.current.has(stream.snapshot.identifier))
        .map((stream) => ({
          ...stream,
          nextBlockIndex: 0,
          beaconEmitted: false,
        }));

      if (nextStreams.length === 0) {
        // Even if no streams were added (all filtered out), we must advance the loaded count
        // to prevent getting stuck in a loop trying to load the same range.
        loadedTowerCountRef.current = Math.max(loadedTowerCountRef.current, endIndex);
        return;
      }

      pendingStreamsRef.current.push(...nextStreams);
      loadedTowerCountRef.current = Math.max(loadedTowerCountRef.current, endIndex);
      lastBatchEnqueueTimeRef.current = typeof performance !== 'undefined' ? performance.now() : Date.now();

      if (DEBUG_GPU_TOWERS) {
        console.log('📦 Enqueued tower batch', {
          startIndex,
          endIndex,
          totalStreams: instancingPlan.streams.length,
        });
      }
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

    const maxConcurrent = Math.min(towerBatchConfig.incrementalBatchSize, totalStreams);
    if (activeStreams >= maxConcurrent) {
      return;
    }

    const slotsToFill = Math.min(maxConcurrent - activeStreams, remaining);
    const startIndex = alreadyLoaded;
    const endIndex = startIndex + slotsToFill;
    enqueueTowerBatch(startIndex, endIndex);

    if (DEBUG_GPU_TOWERS) {
      console.log('🔁 Rolling batch top-off', {
        activeStreams,
        slotsToFill,
        maxConcurrent,
        remainingAfterTopOff: instancingPlan.streams.length - loadedTowerCountRef.current,
      });
    }
  }, [enqueueTowerBatch, instancingPlan.streams.length, towerBatchConfig]);

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
    const showEdges = true;
    const isDefeated = defeatedTowerIds?.has(stream.snapshot.sessionId ?? '') ?? false;

    return {
      posX: stream.towerWorldX + blockX,
      posY: blockY + height / 2,
      posZ: stream.towerWorldZ + blockZ,
      rotY: rotation,
      scaleX: width,
      scaleY: height,
      scaleZ: depth,
      towerSessionId: stream.snapshot.identifier, // Always use identifier as the canonical key for updates
      towerIndex: stream.snapshot.rank,
      blockIndex: absoluteBlockIndex,
      isPlayerTower,
      isSelected,
      isTopFive: stream.isTopFive,
      showEdges,
      isDefeated,
    };
  };

  const estimatedTotalBlocks = (expectedTotalTowers || 0) * 25;
  const desiredBlockCapacity = Math.max(
    5000,
    Math.ceil((instancingPlan.totals.blocks * 1.5) / 1000) * 1000,
    Math.ceil((estimatedTotalBlocks * 1.2) / 1000) * 1000
  );
  const desiredEdgeCapacity = Math.max(
    2500,
    Math.ceil((instancingPlan.totals.edges * 1.5) / 500) * 500,
    Math.ceil((estimatedTotalBlocks * 1.2) / 500) * 500
  );
  const desiredBeaconCapacity = Math.max(
    50,
    Math.ceil((instancingPlan.totals.beacons * 1.5) / 10) * 10
  );

  // Track previous plan to detect incremental updates
  const prevInstancingPlanRef = useRef<TowerInstancingPlan | null>(null);
  const prevPlanSignaturesRef = useRef<Map<string, string> | null>(null);

  // Reset streaming queues whenever the instancing plan changes
  useEffect(() => {
    const prevPlan = prevInstancingPlanRef.current;
    const prevSignatures = prevPlanSignaturesRef.current; // Capture OLD signatures

    const signaturesMatch = areSignatureMapsEqual(
      prevSignatures,
      instancingPlan.towerSignatures
    );

    // Robust check for pure append (incremental loading)
    let isPureAppend = false;
    if (prevPlan && prevPlan.streams.length > 0 && instancingPlan.streams.length > prevPlan.streams.length) {
      // Check if the prefix matches exactly
      // This ensures we are just adding towers to the end, not inserting/reordering
      isPureAppend = true;
      // Optimization: Check first, middle, and last of original range to fail fast
      const checkIndices = [
        0,
        Math.floor(prevPlan.streams.length / 2),
        prevPlan.streams.length - 1
      ];

      for (const idx of checkIndices) {
        if (idx >= 0 && idx < prevPlan.streams.length) {
          const prevStream = prevPlan.streams[idx];
          const nextStream = instancingPlan.streams[idx];
          if (!prevStream || !nextStream || nextStream.snapshot.identifier !== prevStream.snapshot.identifier) {
            isPureAppend = false;
            break;
          }
        }
      }

      // If random checks passed, do full verification (still fast for <1000 items)
      if (isPureAppend) {
        for (let i = 0; i < prevPlan.streams.length; i++) {
          const prevStream = prevPlan.streams[i];
          const nextStream = instancingPlan.streams[i];
          if (!prevStream || !nextStream || nextStream.snapshot.identifier !== prevStream.snapshot.identifier) {
            isPureAppend = false;
            break;
          }
        }
      }
    }

    // Update refs AFTER we are done comparing, OR use local variables for comparison
    prevInstancingPlanRef.current = instancingPlan;
    prevPlanSignaturesRef.current = instancingPlan.towerSignatures;

    if (signaturesMatch) {
      return;
    }

    if (isPureAppend) {
      if (DEBUG_GPU_TOWERS) {
        console.log('⚡️ Incremental update detected (Pure Append)', {
          prev: prevPlan?.streams.length,
          next: instancingPlan.streams.length
        });
      }
      // For incremental updates, we rely on the useFrame loop to pick up the new towers
      // via the (remaining > 0) check.
      return;
    }

    // Smart Diff: If only a few towers changed (e.g. player moved), update them in-place
    // instead of wiping the entire world.
    if (prevSignatures) {
      const prevSigs = prevSignatures;
      const nextSigs = instancingPlan.towerSignatures;

      // Check if player tower changed - if so, force full reset to ensure clean state
      // This prevents "ghost" towers when switching sessions or loading data
      const prevPlayerId = prevPlan?.streams.find(s => s.snapshot.isPlayerTower)?.snapshot.identifier;
      const nextPlayerId = instancingPlan.streams.find(s => s.snapshot.isPlayerTower)?.snapshot.identifier;

      if (prevPlayerId !== nextPlayerId) {
        if (DEBUG_GPU_TOWERS) {
          console.log('🔄 Player tower changed, forcing full reset');
        }
        // Fall through to full reset logic below
      } else {
        const changedOrNewIds = new Set<string>();
        for (const [id, sig] of nextSigs) {
          if (prevSigs.get(id) !== sig) {
            changedOrNewIds.add(id);
          }
        }

        const removedIds = new Set<string>();
        for (const id of prevSigs.keys()) {
          if (!nextSigs.has(id)) {
            removedIds.add(id);
          }
        }

        const totalOps = changedOrNewIds.size + removedIds.size;
        // Threshold: if less than 25% of towers changed, use smart diff
        // Relax threshold for pure additions (even if not strictly append-only)
        // BUT only if we had towers before (avoid partial update for initial load 0 -> N)
        const isPureAddition = removedIds.size === 0 && (prevPlan?.streams.length ?? 0) > 0;
        const threshold = isPureAddition
          ? instancingPlan.streams.length // Allow any number of additions if no removals
          : Math.max(5, instancingPlan.streams.length * 0.25);

        if (totalOps > 0 && totalOps <= threshold) {
          if (DEBUG_GPU_TOWERS) {
            console.log('⚡️ Performing partial tower update', {
              changed: changedOrNewIds.size,
              removed: removedIds.size,
              totalBlocksBefore: blockDataRef.current.length
            });
          }

          const idsToRefresh = new Set([...changedOrNewIds, ...removedIds]);
          const countBeforeFilter = blockDataRef.current.length;

          // 1. Clear old data for affected towers
          blockDataRef.current = blockDataRef.current.filter(b => !idsToRefresh.has(b.towerSessionId));
          edgeDataRef.current = edgeDataRef.current.filter(b => !idsToRefresh.has(b.towerSessionId));

          // CRITICAL FIX: Also remove any pending streams for these towers.
          // If a tower was queued but not yet processed, and then updated, we must remove the old pending stream
          // to prevent it from being added to blockDataRef later (creating a "ghost" tower).
          pendingStreamsRef.current = pendingStreamsRef.current.filter(
            s => !idsToRefresh.has(s.snapshot.identifier)
          );

          const countAfterFilter = blockDataRef.current.length;
          if (countBeforeFilter === countAfterFilter && idsToRefresh.size > 0) {
            // This is suspicious if we expected to remove something (i.e. it's not a brand new tower)
            // However, if it's a NEW tower (not in blockData yet), this is normal.
            // We can check if the ID was in removedIds or if it was an update (changed).
            const hasUpdates = Array.from(changedOrNewIds).some(id => prevPlanSignaturesRef.current?.has(id));
            if (hasUpdates || removedIds.size > 0) {
              // console.warn('⚠️ Partial update filter did not remove blocks for updated/removed towers', { 
              //     idsToRefresh: Array.from(idsToRefresh),
              //     removedIds: Array.from(removedIds)
              // });
            }
          }

          // 2. Rebuild beacons (fast enough to just rebuild from current plan)
          // We keep beacons for unchanged towers, and let the streaming add the new ones
          const preservedBeacons: Array<{ position: THREE.Vector3; color: THREE.Color }> = [];
          instancingPlan.streams.forEach(s => {
            if (!changedOrNewIds.has(s.snapshot.identifier)) {
              preservedBeacons.push(...s.beacon);
            }
          });
          beaconDataRef.current = preservedBeacons;

          // 3. Queue updates for changed/new towers
          const streamsToRequeue = instancingPlan.streams.filter(s => changedOrNewIds.has(s.snapshot.identifier));

          // OPTIMIZATION: If the update is small (e.g. just selection change), process synchronously to avoid flickering
          const totalNewBlocks = streamsToRequeue.reduce((sum, s) => sum + s.blocks.length, 0);
          const SYNC_UPDATE_THRESHOLD = 2500; // Up to ~2.5k blocks is fine to process in one frame

          // If this is a large batch addition (e.g. initial load of 50 towers), do NOT process synchronously
          // to avoid freezing the frame. Let the background streamer handle it.
          const isLargeBatch = streamsToRequeue.length > 10;

          if (totalNewBlocks <= SYNC_UPDATE_THRESHOLD && !isLargeBatch) {
            const newBlocks: TowerBlockData[] = [];
            const newBeacons: Array<{ position: THREE.Vector3; color: THREE.Color }> = [];

            streamsToRequeue.forEach(stream => {
              // Create a temporary state for synchronous processing
              const tempStream: TowerStreamingState = {
                ...stream,
                nextBlockIndex: 0,
                beaconEmitted: false
              };

              stream.blocks.forEach((block, idx) => {
                const blockData = createBlockData(block, tempStream, idx);
                if (blockData) {
                  newBlocks.push(blockData);
                }
              });

              if (stream.beacon.length > 0) {
                newBeacons.push(...stream.beacon);
              }
            });

            if (newBlocks.length > 0) {
              blockDataRef.current.push(...newBlocks);
              newBlocks.forEach(b => {
                if (b.showEdges) edgeDataRef.current.push(b);
              });
            }
            if (newBeacons.length > 0) {
              beaconDataRef.current.push(...newBeacons);
            }

            // Mark as handled
            // Do NOT set loadedTowerCountRef to full length, as we might still be streaming other towers.
            // Instead, mark these specific towers as completed so the batcher skips them.
            streamsToRequeue.forEach(s => completedTowerIdsRef.current.add(s.snapshot.identifier));

            blockUploadScheduledRef.current = true;
            edgeUploadScheduledRef.current = true;
            beaconUploadScheduledRef.current = true;
            forceCompletedTowerVersion(v => v + 1);

            if (DEBUG_GPU_TOWERS) {
              console.log('⚡️ Synchronous partial update completed', { blocks: totalNewBlocks });
            }
            return;
          }

          const newPending = streamsToRequeue.map(s => ({
            ...s,
            nextBlockIndex: 0,
            beaconEmitted: false
          }));

          pendingStreamsRef.current.push(...newPending);

          // 4. Mark as handled
          // Do NOT set loadedTowerCountRef to full length.
          // Mark these specific towers as completed so the batcher skips them (preventing duplicates).
          streamsToRequeue.forEach(s => completedTowerIdsRef.current.add(s.snapshot.identifier));

          blockUploadScheduledRef.current = true;
          edgeUploadScheduledRef.current = true;
          beaconUploadScheduledRef.current = true;
          forceCompletedTowerVersion(v => v + 1);

          return;
        }
      }
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
    lastUpdatedEdgeColorCountRef.current = 0;
    blockUploadScheduledRef.current = true;
    edgeUploadScheduledRef.current = true;
    beaconUploadScheduledRef.current = true;
    forceCompletedTowerVersion((v) => v + 1);
    lastBatchEnqueueTimeRef.current = typeof performance !== 'undefined' ? performance.now() : Date.now();

    const initialBatchSize = Math.min(
      towerBatchConfig.initialBatchSize,
      instancingPlan.streams.length
    );
    if (initialBatchSize > 0) {
      enqueueTowerBatch(0, initialBatchSize);
    }
  }, [instancingPlan, enqueueTowerBatch, towerBatchConfig]);

  // Stream tower payloads over multiple frames to avoid large CPU spikes and build towers block-by-block
  useFrame((_, delta) => {
    processScheduledUploads();

    streamingAccumulatorRef.current += delta * 1000;
    if (streamingAccumulatorRef.current < streamingConfig.msBetweenSteps) {
      return;
    }
    streamingAccumulatorRef.current = 0;

    const queue = pendingStreamsRef.current;
    const completedThisFrame: string[] = [];
    if (queue.length === 0) {
      const remaining = instancingPlan.streams.length - loadedTowerCountRef.current;
      if (remaining > 0) {
        const now = typeof performance !== 'undefined' ? performance.now() : Date.now();
        if (now - lastBatchEnqueueTimeRef.current >= towerBatchConfig.batchCooldownMs) {
          const nextStart = loadedTowerCountRef.current;
          const nextEnd = Math.min(
            nextStart + towerBatchConfig.incrementalBatchSize,
            instancingPlan.streams.length
          );
          enqueueTowerBatch(nextStart, nextEnd);
          if (nextStart >= towerBatchConfig.initialBatchSize) {
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
      if (processedBlocks >= streamingConfig.blocksPerStep) {
        break;
      }

      const elapsed = (typeof performance !== 'undefined' ? performance.now() : Date.now()) - start;
      if (elapsed >= streamingConfig.frameBudgetMs) {
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
        if (DEBUG_GPU_TOWERS) {
          console.log('🚀 Completed tower streaming for instanced renderer');
        }
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

    const startMatrixIndex = lastUpdatedBlockCountRef.current;
    const tempMatrix = new THREE.Matrix4();
    const tempQuaternion = new THREE.Quaternion();
    const tempEuler = new THREE.Euler();
    const tempPosition = new THREE.Vector3();
    const tempScale = new THREE.Vector3();

    try {
      for (let i = startMatrixIndex; i < blockData.length; i++) {
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
      }
    } catch (error) {
      console.error('💥 Failed to update instanced block mesh', {
        error,
        blockCount: blockData.length,
        capacity: blockCapacity,
      });
      return false;
    }

    const matrixDelta = blockData.length - startMatrixIndex;
    if (matrixDelta > 0) {
      setAttributeUpdateRange(mesh.instanceMatrix, startMatrixIndex * 16, matrixDelta * 16);
      mesh.instanceMatrix.needsUpdate = true;
      lastUpdatedBlockCountRef.current = blockData.length;
    } else {
      // Keep counts in sync when only color refresh happened.
      lastUpdatedBlockCountRef.current = Math.min(lastUpdatedBlockCountRef.current, blockData.length);
    }

    mesh.count = blockData.length;

    mesh.visible = true;
    mesh.frustumCulled = false;
    return true;
  }, [blockCapacity]);

  const flushEdgeInstances = useCallback(() => {
    const mesh = edgeMeshRef.current;
    const edgeData = edgeDataRef.current;
    if (!mesh) {
      return false;
    }

    if (edgeData.length === 0) {
      mesh.count = 0;
      lastUpdatedEdgeCountRef.current = 0;
      return true;
    }

    if (mesh.uuid !== lastEdgeMeshUuidRef.current) {
      lastUpdatedEdgeCountRef.current = 0;
      lastEdgeMeshUuidRef.current = mesh.uuid;
      (mesh.userData as any).__instancingColorEnabled = false;
    }
    if (mesh.uuid !== lastEdgeColorMeshUuidRef.current) {
      lastUpdatedEdgeColorCountRef.current = 0;
      lastEdgeColorMeshUuidRef.current = mesh.uuid;
      (mesh.userData as any).__instancingColorEnabled = false;
    }
    if (edgeData.length < lastUpdatedEdgeCountRef.current) {
      lastUpdatedEdgeCountRef.current = 0;
    }
    if (edgeData.length < lastUpdatedEdgeColorCountRef.current) {
      lastUpdatedEdgeColorCountRef.current = 0;
    }

    if (edgeData.length > edgeCapacity) {
      console.warn('⛔ Edge data exceeds current instancing capacity, waiting for resize', {
        edgeData: edgeData.length,
        edgeCapacity,
      });
      return false;
    }

    const startMatrixIndex = lastUpdatedEdgeCountRef.current;
    let startColorIndex = lastUpdatedEdgeColorCountRef.current;
    if (!mesh.instanceColor) {
      startColorIndex = 0;
    }
    const tempMatrix = new THREE.Matrix4();
    const tempQuaternion = new THREE.Quaternion();
    const tempEuler = new THREE.Euler();
    const tempPosition = new THREE.Vector3();
    const tempScale = new THREE.Vector3();
    const fallbackTowerColor = new THREE.Color('#00f2fe');
    let activeTowerId = '';
    let activeTowerColor: THREE.Color = fallbackTowerColor;

    try {
      for (let i = startMatrixIndex; i < edgeData.length; i++) {
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
      }

      activeTowerId = '';
      activeTowerColor = fallbackTowerColor;
      const defeatedColor = new THREE.Color('#ff0000'); // Red for defeated towers
      for (let i = startColorIndex; i < edgeData.length; i++) {
        const block = edgeData[i];
        if (!block) {
          continue;
        }
        if (block.towerSessionId !== activeTowerId) {
          activeTowerId = block.towerSessionId;
          // Use red if defeated, otherwise use tower color
          if (block.isDefeated) {
            activeTowerColor = defeatedColor;
          } else {
            activeTowerColor = towerColorByIdentifier.get(activeTowerId) ?? fallbackTowerColor;
          }
        }
        mesh.setColorAt(i, activeTowerColor);
      }
    } catch (error) {
      console.error('💥 Failed to update instanced edge mesh', {
        error,
        edgeCount: edgeData.length,
        capacity: edgeCapacity,
      });
      return false;
    }

    const matrixDelta = edgeData.length - startMatrixIndex;
    if (matrixDelta > 0) {
      setAttributeUpdateRange(mesh.instanceMatrix, startMatrixIndex * 16, matrixDelta * 16);
      mesh.instanceMatrix.needsUpdate = true;
      lastUpdatedEdgeCountRef.current = edgeData.length;
    } else {
      lastUpdatedEdgeCountRef.current = Math.min(lastUpdatedEdgeCountRef.current, edgeData.length);
    }

    const colorDelta = edgeData.length - startColorIndex;
    if (mesh.instanceColor && colorDelta > 0) {
      setAttributeUpdateRange(mesh.instanceColor, startColorIndex * 3, colorDelta * 3);
      mesh.instanceColor.needsUpdate = true;
      lastUpdatedEdgeColorCountRef.current = edgeData.length;
    } else {
      lastUpdatedEdgeColorCountRef.current = Math.min(lastUpdatedEdgeColorCountRef.current, edgeData.length);
    }

    if (mesh.instanceColor && !(mesh.userData as any).__instancingColorEnabled) {
      const material = mesh.material as any;
      if (material) {
        material.needsUpdate = true;
      }
      (mesh.userData as any).__instancingColorEnabled = true;
    }
    mesh.count = edgeData.length;

    return true;
  }, [edgeCapacity, towerColorByIdentifier]);

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

    if (mesh.uuid !== lastBeaconMeshUuidRef.current) {
      lastBeaconMeshUuidRef.current = mesh.uuid;
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
    const blockMeshChanged = blockMeshRef.current?.uuid !== lastBlockMeshUuidRef.current;

    if ((blockUploadScheduledRef.current || blockMeshChanged) && flushBlockInstances()) {
      blockUploadScheduledRef.current = false;
    }

    const edgeMeshChanged = edgeMeshRef.current?.uuid !== lastEdgeMeshUuidRef.current;

    const edgeMesh = edgeMeshRef.current;
    const edgeColorMissing =
      edgeDataRef.current.length > 0 &&
      (!edgeMesh?.instanceColor || lastUpdatedEdgeColorCountRef.current < edgeDataRef.current.length);

    if ((edgeUploadScheduledRef.current || edgeMeshChanged || edgeColorMissing) && flushEdgeInstances()) {
      edgeUploadScheduledRef.current = false;
    }

    const beaconMeshChanged = beaconMeshRef.current?.uuid !== lastBeaconMeshUuidRef.current;
    if ((beaconUploadScheduledRef.current || beaconMeshChanged) && flushBeaconInstances()) {
      beaconUploadScheduledRef.current = false;
    }
  }, [flushBlockInstances, flushEdgeInstances, flushBeaconInstances]);

  // Selection highlighting is handled by a lightweight overlay mesh.


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

  const boundsByIdentifier = useMemo(() => {
    const map = new Map<string, TowerBounds>();
    instancingPlan.streams.forEach((stream) => {
      map.set(stream.snapshot.identifier, stream.snapshot.bounds);
    });
    return map;
  }, [instancingPlan]);

  const interactiveTowers = useMemo(() => {
    if (!allTowers || !Array.isArray(allTowers)) return [];

    return allTowers
      .map((tower, index) => {
        if (!tower) return null;
        const identifier = getTowerIdentifier(tower, index);
        // NOTE: We intentionally allow hitboxes even if a tower is still streaming.
        // Otherwise, in “today” (busy) cycles you can end up with no interactive hitboxes
        // until streaming completes, which makes selecting/deselecting feel broken.
        const bounds = boundsByIdentifier.get(identifier) ?? {
          width: 2,
          height: 2,
          depth: 2,
          centerX: 0,
          centerY: 1,
          centerZ: 0,
        };

        const position: [number, number, number] = [tower.worldX ?? 0, 0, tower.worldZ ?? 0];
        return { tower, index, identifier, bounds, position };
      })
      .filter((entry): entry is NonNullable<typeof entry> => Boolean(entry));
  }, [allTowers, streamingTowerIdentifiers, completedTowerVersion, boundsByIdentifier]);

  const selectedHighlight = useMemo(() => {
    if (!selectedTower) {
      return null;
    }

    const selectedIndex = allTowers.findIndex((t) => t.sessionId === selectedTower.sessionId);
    if (selectedIndex < 0) {
      return null;
    }

    const identifier = getTowerIdentifier(allTowers[selectedIndex]!, selectedIndex);
    const bounds =
      boundsByIdentifier.get(identifier) ??
      ({
        width: 2,
        height: 2,
        depth: 2,
        centerX: 0,
        centerY: 1,
        centerZ: 0,
      } as TowerBounds);

    const worldX = selectedTower.worldX ?? 0;
    const worldZ = selectedTower.worldZ ?? 0;

    const isUnavailable = defeatedTowerIds?.has(selectedTower.sessionId ?? '') ?? false;

    return {
      position: [worldX + bounds.centerX, bounds.centerY, worldZ + bounds.centerZ] as [number, number, number],
      scale: [bounds.width + 0.3, bounds.height + 0.3, bounds.depth + 0.3] as [number, number, number],
      isUnavailable,
    };
  }, [selectedTower, allTowers, streamingTowerIdentifiers, completedTowerVersion, boundsByIdentifier, defeatedTowerIds]);

  useEffect(() => {
    const mesh = hitboxMeshRef.current;
    if (!mesh) {
      return;
    }

    const tempMatrix = new THREE.Matrix4();
    const tempPosition = new THREE.Vector3();
    const tempQuaternion = new THREE.Quaternion();
    const tempScale = new THREE.Vector3();

    const count = interactiveTowers.length;
    for (let i = 0; i < count; i += 1) {
      const entry = interactiveTowers[i];
      if (!entry) {
        continue;
      }
      const b = entry.bounds;
      tempPosition.set(entry.position[0] + b.centerX, b.centerY, entry.position[2] + b.centerZ);
      tempScale.set(
        Math.max(3, b.width + 2),
        Math.max(3, b.height),
        Math.max(3, b.depth + 2)
      );
      tempMatrix.compose(tempPosition, tempQuaternion, tempScale);
      mesh.setMatrixAt(i, tempMatrix);
    }

    mesh.count = count;
    setAttributeUpdateRange(mesh.instanceMatrix, 0, count * 16);
    mesh.instanceMatrix.needsUpdate = true;
  }, [interactiveTowers]);

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
            color="#000000"
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
          onUpdate={(mesh) => {
            const instanced = mesh as unknown as THREE.InstancedMesh;
            if (!instanced.instanceColor) {
              instanced.setColorAt(0, new THREE.Color('#ffffff'));
              if (instanced.instanceColor) {
                (instanced.instanceColor as any).needsUpdate = true;
              }
              const material = instanced.material as any;
              if (material) {
                material.needsUpdate = true;
              }
              (instanced.userData as any).__instancingColorEnabled = true;
              lastUpdatedEdgeColorCountRef.current = 0;
              edgeUploadScheduledRef.current = true;
            }
          }}
        >
          <boxGeometry args={[1, 1, 1]} />
          <meshBasicMaterial
            color="#ffffff"
            transparent={true}
            opacity={1.0}
            toneMapped={false}
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
          onUpdate={(mesh) => {
            const instanced = mesh as unknown as THREE.InstancedMesh;
            if (!instanced.instanceColor) {
              instanced.setColorAt(0, new THREE.Color('#ffffff'));
              if (instanced.instanceColor) {
                (instanced.instanceColor as any).needsUpdate = true;
              }
              const material = instanced.material as any;
              if (material) {
                material.needsUpdate = true;
              }
              beaconUploadScheduledRef.current = true;
            }
          }}
        >
          <cylinderGeometry args={[0.5, 0.5, 50, 8]} />
          <meshBasicMaterial
            color="#ffffff"
            transparent={true}
            opacity={0.3}
            toneMapped={false}
          />
        </instancedMesh>
      )}

      {/* Single instanced hitbox mesh for all towers (avoids 1 mesh per tower). */}
      {onTowerClick && interactiveTowers.length > 0 && (
        <instancedMesh
          key={`tower-hitboxes-${allTowers.length}`}
          ref={hitboxMeshRef}
          args={[undefined, undefined, Math.max(1, allTowers.length)]}
          frustumCulled={false}
          onPointerDown={(e) => {
            e.stopPropagation();
            if (typeof e.instanceId === 'number') {
              pointerStartRef.current = { x: e.clientX, y: e.clientY, instanceId: e.instanceId };
            }
          }}
          onClick={(e) => {
            e.stopPropagation();
            if (typeof e.instanceId !== 'number') {
              return;
            }

            const start = pointerStartRef.current;
            pointerStartRef.current = null;

            if (start) {
              const distance = Math.sqrt(
                Math.pow(e.clientX - start.x, 2) + Math.pow(e.clientY - start.y, 2)
              );
              if (distance > 5 || start.instanceId !== e.instanceId) {
                return;
              }
            }

            const entry = interactiveTowers[e.instanceId];
            if (!entry) {
              return;
            }

            onTowerClick(entry.tower, entry.position, entry.index);
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
          <boxGeometry args={[1, 1, 1]} />
          <meshBasicMaterial transparent opacity={0} depthWrite={false} />
        </instancedMesh>
      )}

      {/* Selected tower highlight (single mesh). */}
      {selectedHighlight && (
        <mesh position={selectedHighlight.position} scale={selectedHighlight.scale} raycast={() => { }}>
          <boxGeometry args={[1, 1, 1]} />
          <meshBasicMaterial
            color={selectedHighlight.isUnavailable ? '#ff3333' : '#00ffff'}
            transparent
            opacity={selectedHighlight.isUnavailable ? 0.25 : 0.1}
            toneMapped={false}
            side={THREE.BackSide}
          />
        </mesh>
      )}
    </group>
  );
};

export default GPUInstancedTowerSystem;
