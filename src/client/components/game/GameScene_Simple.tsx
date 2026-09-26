import React, { useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { AudioPlayer, MusicManager } from '../audio/AudioPlayer';
import { GameState, FixedMath } from '../../../shared/simulation';
import { GameBlockMemo as GameBlock, PerfectEdgeCascadeEvent } from './GameBlock_Simple';
import { EffectsRenderer } from '../effects/EffectsRenderer';
import { CutDebris, type DebrisSpawn } from './CutDebris';
import { LandingRings, type LandingRing } from './LandingRings';
import { PassRings, type RunPass } from './PassRings';
import { GrowthEffects } from '../effects/GrowthEffects';
import { BoardFloor } from '../board/BoardFloor';
import { GPUGameBlocks } from './GPUGameBlocks';
import { mixHex, type FactionTheme } from '../../constants/factions';
import {
  TowerPlacementSystem,
  DEFAULT_TOWER_GRID_OFFSET,
  DEFAULT_TOWER_GRID_SIZE,
} from '../../../shared/types/towerPlacement';
import {
  computeGridRadiusForCapacity,
  DEFAULT_TOWER_GRID_DENSITY,
  MAX_VISIBLE_TOWERS,
} from '../../../shared/constants/towers';
// The actual game mode (rotating_block / regenerate), not the legacy view-mode type that
// shared this name. Two different things called GameMode is exactly the kind of ambiguity that
// made this codebase hard to reason about.
import type { GameMode } from '../../../shared/simulation/types';
import { TowerMapEntry } from '../../../shared/types/api';
import { useFrustumCulling } from '../../hooks/useFrustumCulling';

const DEBUG_LOGS = false;

type VibratePattern = number | number[];

const PERFECT_VIBRATION_PATTERN: VibratePattern = [50, 30, 90];
const MISS_VIBRATION_PATTERN: VibratePattern = [35, 40, 35];

const triggerHapticFeedback = (pattern: VibratePattern) => {
  if (typeof window === 'undefined') {
    return;
  }

  const { navigator: nav } = window;
  if (!nav || typeof nav.vibrate !== 'function') {
    return;
  }

  if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    return;
  }

  // Like sound, never before the player has touched the game or while it is off screen.
  if (!AudioPlayer.engaged()) return;

  try {
    nav.vibrate(pattern);
  } catch (error) {
    if (DEBUG_LOGS) {
      console.warn('Haptics vibration failed', error);
    }
  }
};

/**
 * Adds the current shake and punch to a camera that has just been placed and aimed.
 *
 * Shake is a decaying, non-repeating wobble in all three axes; punch is a short move toward the
 * subject and back. Both are scaled by `reach` so a phone, whose camera sits further off, gets
 * the same apparent motion as a monitor.
 */
const applyImpactToCamera = (
  cam: THREE.PerspectiveCamera,
  lookAt: THREE.Vector3,
  im: { shakeAmp: number; shakeStart: number; punch: number },
  now: number,
  reach: number
): void => {
  const t = (now - im.shakeStart) / 280;
  if (t < 0 || t >= 1 || im.shakeAmp <= 0) return;
  const decay = (1 - t) * (1 - t);
  const amp = im.shakeAmp * decay * reach;
  const phase = t * 40;
  cam.position.x += Math.sin(phase * 1.7 + 0.3) * amp;
  cam.position.y += Math.cos(phase * 1.3 + 1.1) * amp * 0.6;
  cam.position.z += Math.sin(phase * 1.9 + 2.4) * amp;
  if (im.punch > 0) {
    const toward = lookAt.clone().sub(cam.position).normalize();
    cam.position.addScaledVector(
      toward,
      im.punch * 1.6 * reach * Math.sin(Math.min(1, t * 2) * Math.PI)
    );
  }
};

/** Moves a mutable point a fraction of the way toward a target. */
const easeToward = (
  point: { x: number; y: number; z: number },
  x: number,
  y: number,
  z: number,
  k: number
): void => {
  point.x += (x - point.x) * k;
  point.y += (y - point.y) * k;
  point.z += (z - point.z) * k;
};

interface GameSceneProps {
  gameState: GameState | null;
  gameMode?: GameMode;
  onTimeScale?: (scale: number) => void;
  gridSize?: number;
  gridOffsetX?: number;
  gridOffsetZ?: number;
  gridDensity?: number;
  enableDebugWireframe?: boolean;
  playerColorTheme?: FactionTheme | null;
  /**
   * World position of the cell the run is built on.
   *
   * The simulation works in its own space centred on zero, but zero is a cell *corner* on the
   * shared grid (`cellToWorld(0)` is 4, so cells span multiples of 8). The run used to be drawn
   * there and the game's floor was shifted half a cell to make it look right, which is why the
   * grid jumped when a run ended: the two scenes were drawing two different grids. The tower is
   * now placed on a real cell and both scenes draw the same one.
   */
  originX?: number;
  originZ?: number;
  onCameraReady?: (camera: THREE.PerspectiveCamera) => void;
  onTowerPlacementSave?: (
    sessionId: string,
    worldX: number,
    worldZ: number,
    gridX: number,
    gridZ: number
  ) => Promise<void>;
  placementSystem?: TowerPlacementSystem;
  stepSimulationFrame?: () => void;
  isPlaying?: boolean;
  timeScale?: number;
  ghostState?: GameState | null;
  ghostTowerBlocks?: TowerMapEntry['towerBlocks'] | null;
  /**
   * Body colour per block index, overriding the run's own gradient. The relay tower is laid by
   * many hands, and each block keeps the colour of whoever laid it.
   */
  paletteByIndex?: ReadonlyArray<string | null | undefined> | undefined;
  /** Colour of the moving block, when it is not the player's own. */
  activeBlockColor?: string | undefined;
  /** Pieces thrown from outside the run, e.g. another player's block going over the edge. */
  extraDebris?: ReadonlyArray<DebrisSpawn> | undefined;
  /**
   * A moment to feel that this client's own simulation did not produce: somebody else's block
   * falling off the shared tower, or its top healing. Keyed, so each is felt once.
   */
  impulse?: { key: number; kind: 'land' | 'perfect' | 'over' | 'heal' } | null | undefined;
  /** Scores passed this run, each ringed on the block that passed it. */
  passes?: readonly RunPass[] | undefined;
}

export const GameScene: React.FC<GameSceneProps> = ({
  gameState,
  gameMode: _gameMode = 'playing', // Prefixed with underscore to indicate intentionally unused
  gridSize = DEFAULT_TOWER_GRID_SIZE,
  gridOffsetX = DEFAULT_TOWER_GRID_OFFSET,
  gridOffsetZ = DEFAULT_TOWER_GRID_OFFSET,
  gridDensity = DEFAULT_TOWER_GRID_DENSITY,
  enableDebugWireframe = false,
  playerColorTheme,
  onCameraReady,
  onTowerPlacementSave: _onTowerPlacementSave, // Prefixed with underscore to indicate intentionally unused
  placementSystem: externalPlacementSystem,
  stepSimulationFrame,
  isPlaying = false,
  timeScale = 1.0,
  originX = 0,
  originZ = 0,
  ghostState: _ghostState = null, // Prefixed with underscore to indicate intentionally unused
  ghostTowerBlocks = null,
  paletteByIndex,
  activeBlockColor,
  extraDebris,
  impulse,
  passes,
}) => {
  const cameraRef = useRef<THREE.PerspectiveCamera>(null);
  // Removed orbitControlsRef - using custom camera controller
  const { gl: _gl, set, size, camera: incomingCamera } = useThree();
  const viewportWidth = size.width;
  const viewportHeight = size.height;
  // Portrait screens hold the camera further back (see the frame loop), so the floor fades later.
  const floorReach = Math.min(
    2.4,
    Math.max(1, viewportHeight > 0 ? viewportHeight / viewportWidth : 1)
  );

  // Set perspective camera as default when it's ready - ONLY ONCE
  const cameraInitializedRef = useRef(false);
  React.useEffect(() => {
    if (cameraRef.current && !cameraInitializedRef.current) {
      /**
       * Start where the board left off.
       *
       * This used to slam the camera to a fixed (40, 28, 40) the moment a run began, which is a
       * cut, which is why there was a black veil over it. The run and the board are the same
       * place seen from different distances, so the camera is inherited and the frame loop eases
       * it to the tower from wherever the board was looking.
       */
      const from = incomingCamera as THREE.PerspectiveCamera;
      const startX = Number.isFinite(from?.position.x) ? from.position.x : 40;
      const startY = Number.isFinite(from?.position.y) ? from.position.y : 28;
      const startZ = Number.isFinite(from?.position.z) ? from.position.z : 40;

      // Where the outgoing camera was aimed, taken as a point on its view axis at the same
      // distance the run will hold, so the look target eases rather than snapping.
      const dir = new THREE.Vector3();
      from?.getWorldDirection?.(dir);
      const aim =
        dir.lengthSq() > 0
          ? new THREE.Vector3(startX, startY, startZ).addScaledVector(dir, 60)
          : new THREE.Vector3(originX, 4, originZ);

      cameraRef.current.position.set(startX, startY, startZ);
      cameraRef.current.lookAt(aim);

      if (viewportHeight > 0) {
        cameraRef.current.aspect = viewportWidth / viewportHeight;
        cameraRef.current.updateProjectionMatrix();
      }

      lookAtTargetRef.current.x = aim.x;
      lookAtTargetRef.current.y = aim.y;
      lookAtTargetRef.current.z = aim.z;
      cameraBaseRef.current = { x: startX, y: startY, z: startZ };

      set({ camera: cameraRef.current });
      onCameraReady?.(cameraRef.current);
      cameraInitializedRef.current = true;
    }
  }, [set, onCameraReady, viewportWidth, viewportHeight, incomingCamera, originX, originZ]);

  React.useEffect(() => {
    if (!cameraRef.current) return;
    if (viewportHeight === 0) return;
    cameraRef.current.aspect = viewportWidth / viewportHeight;
    cameraRef.current.updateProjectionMatrix();
  }, [viewportWidth, viewportHeight]);

  const desiredGridRadius = React.useMemo(
    () => computeGridRadiusForCapacity(MAX_VISIBLE_TOWERS, gridDensity),
    [gridDensity]
  );

  // Tower placement system - use external if provided, otherwise create local
  const placementSystemRef = useRef<TowerPlacementSystem>(
    externalPlacementSystem ||
      new TowerPlacementSystem(gridSize, gridOffsetX, gridOffsetZ, desiredGridRadius)
  );

  // Update placement system reference if external system changes
  React.useEffect(() => {
    if (externalPlacementSystem) {
      placementSystemRef.current = externalPlacementSystem;
    }
  }, [externalPlacementSystem]);

  // Removed towersData state - no longer needed with GPU instanced system

  // Camera control state - disabled by default for normal gameplay
  const [manualCameraControl, _setManualCameraControl] = React.useState(false); // Prefixed with underscore to indicate intentionally unused

  // Update placement system when grid parameters change
  React.useEffect(() => {
    placementSystemRef.current.updateGrid(gridSize, gridOffsetX, gridOffsetZ, desiredGridRadius);
  }, [gridSize, gridOffsetX, gridOffsetZ, desiredGridRadius]);

  const lookAtVectorRef = useRef(new THREE.Vector3());

  const prevBlocksRef = useRef<number>(0);
  const lastActivePosRef = useRef<{ x: number; y: number; z: number } | null>(null);
  const lastPlacementSpawnRef = useRef<{ x: number; y: number; z: number } | null>(null);
  if (
    gameState &&
    gameState.blocks.length > prevBlocksRef.current &&
    !lastPlacementSpawnRef.current
  ) {
    const newest = gameState.blocks[gameState.blocks.length - 1];
    if (newest) {
      const targetPos = {
        x: FixedMath.toFloat(newest.x),
        y: FixedMath.toFloat(newest.y + newest.height / 2),
        z: FixedMath.toFloat(newest.z ?? 0),
      };
      if (lastActivePosRef.current) {
        lastPlacementSpawnRef.current = {
          x: lastActivePosRef.current.x,
          y: targetPos.y,
          z: lastActivePosRef.current.z,
        };
      } else {
        lastPlacementSpawnRef.current = targetPos;
      }
    }
  }

  const cameraBaseRef = useRef({ x: 40, y: 28, z: 40 });

  /**
   * The felt half of a landing.
   *
   * Hit stop freezes the simulation for a few frames so the impact registers; the shake and the
   * punch move the camera, decaying over a quarter of a second. A perfect hits harder than a
   * miss, and the end of the run harder still. All of it is on the one action the game has.
   */
  const impactRef = useRef({ stopUntil: 0, shakeAmp: 0, shakeStart: 0, punch: 0 });
  const impact = (kind: 'land' | 'perfect' | 'over') => {
    const now = typeof performance !== 'undefined' ? performance.now() : Date.now();
    const im = impactRef.current;
    im.stopUntil = now + (kind === 'over' ? 220 : kind === 'perfect' ? 85 : 40);
    im.shakeAmp = kind === 'over' ? 1.1 : kind === 'perfect' ? 0.55 : 0.24;
    im.shakeStart = now;
    im.punch = kind === 'over' ? 0 : kind === 'perfect' ? 1 : 0.4;
  };
  /** The newest block, so it can flash and squash into place. */
  const [landing, setLanding] = React.useState<{
    index: number;
    at: number;
    perfect: boolean;
  } | null>(null);
  const [rings, setRings] = React.useState<LandingRing[]>([]);
  /** The block that slid off the top at game over. */
  const [fallen, setFallen] = React.useState<DebrisSpawn[]>([]);
  const lastMovingBlockRef = useRef<{
    x: number;
    y: number;
    z: number;
    width: number;
    height: number;
    depth: number;
  } | null>(null);
  const lookAtTargetRef = useRef({ x: 0, y: 0, z: 0 });
  const musicStageRef = useRef<'start' | 'main' | 'crescendo' | 'gameover'>('start');
  // Whether this run's intro has been started. Cleared when the count drops back to the base block.
  const introStartedRef = useRef(false);
  // PERFECT placement tracking
  const perfectEventKeyRef = useRef<number>(0); // monotonic key for effect remount
  const lastPerfectContactRef = useRef<{
    pos: [number, number, number];
    width: number;
    height: number;
  } | null>(null);
  // Streak / tier tracking (strict perfect placements only)
  const perfectStreakRef = useRef<number>(0);
  const perfectTierRef = useRef<number>(0);
  // Miss (imperfect) streak tracking
  const missStreakRef = useRef<number>(0);
  const missTierRef = useRef<number>(0);
  const missTierThresholds = [0, 3, 6, 9, 13, 18, 24, 31]; // 8 miss tiers (0-7)
  const computeMissTier = (streak: number) => {
    let tier = 0;
    for (let i = 0; i < missTierThresholds.length; i++) {
      const th = missTierThresholds[i];
      if (typeof th === 'number' && streak >= th) tier = i;
      else break;
    }
    return Math.min(missTierThresholds.length - 1, tier);
  };
  // Configurable toggle (can be changed by UI or console): enable/disable miss feedback
  const missFeedbackEnabledRef = useRef<boolean>(true);
  (globalThis as any).__setMissFeedbackEnabled = (val: boolean) => {
    missFeedbackEnabledRef.current = !!val;
  };
  // Tier thresholds (streak lengths) for 16-tier escalation (tiers 0-15).
  // Designed with gradually increasing gaps to make late tiers rare & meaningful.
  // You reach tier i when streak >= tierThresholds[i].
  const tierThresholds = [
    0, // 0  : PERFECT
    2, // 1  : CLEAN
    4, // 2  : PRECISE
    6, // 3  : SHARPER
    9, // 4  : FLAWLESS
    13, // 5  : TRANSCENDENT
    18, // 6  : ASCENDANT
    24, // 7  : CELESTIAL
    31, // 8  : ETHEREAL
    39, // 9  : DIVINE
    48, // 10 : MYTHIC
    58, // 11 : LEGENDARY
    69, // 12 : APEX
    81, // 13 : OMNI
    94, // 14 : INFINITE
    108, // 15 : GODLIKE
  ];
  const computeTier = (streak: number) => {
    let tier = 0;
    for (let i = 0; i < tierThresholds.length; i++) {
      const th = tierThresholds[i];
      if (typeof th === 'number' && streak >= th) tier = i;
      else break;
    }
    return Math.min(15, tier);
  };
  const gameOverZoomRef = useRef<{
    active: boolean;
    start: number;
    duration: number;
    startZoom: number;
    targetZoom: number;
    startBaseY: number;
    targetBaseY: number;
    startLookY: number;
    targetLookY: number;
  }>({
    active: false,
    start: 0,
    duration: 1200,
    startZoom: 36,
    targetZoom: 36,
    startBaseY: 32,
    targetBaseY: 32,
    startLookY: 0,
    targetLookY: 0,
  });

  // Gradient shading state ---------------------------------------------------
  // Stored color for each placed block (stable once assigned)
  const blockColorsRef = useRef<string[]>([]);
  // Counts how many gradient steps have been consumed (excludes frozen streak blocks)
  const shadeStepRef = useRef<number>(0);
  // When a perfect streak is active we freeze a uniform color for that region
  const freezeColorRef = useRef<string | null>(null);
  const [edgeCascadeEvent, setEdgeCascadeEvent] = React.useState<PerfectEdgeCascadeEvent | null>(
    null
  );

  /**
   * The body colour of the next block: the faction's colour, breathing slowly with height.
   *
   * It used to be a cyan-blue wave mixed with a theme accent nobody had chosen. A tower now
   * reads as its colour from the first block, and the wave only keeps a tall stack from being a
   * flat column of one value.
   */
  const generateGradientColor = (step: number): string => {
    const accent = playerColorTheme?.accentHex ?? '#00f2fe';
    const t = (Math.sin(step * 0.3) + 1) / 2;
    return mixHex(mixHex(accent, '#ffffff', 0.16), mixHex(accent, '#08111a', 0.14), t);
  };

  // No ghost stack: we now seed real blocks at start, so intro visuals are handled by real placements

  // Convert fixed-point coordinates to Three.js world coordinates
  const convertPosition = React.useCallback((fixedValue: number): number => {
    return FixedMath.toFloat(fixedValue);
  }, []);

  // Frustum culling for performance optimization - only render visible blocks
  const visibleBlockIndices = useFrustumCulling(
    gameState?.blocks || [],
    convertPosition,
    originX,
    originZ
  );

  // Axes helper ref (for debugging/orientation) - not used in production

  // Compute world-space bounds of the tower (min bottom Y, max top Y)
  const computeTowerBounds = React.useCallback((gs: GameState) => {
    if (!gs.blocks || gs.blocks.length === 0) return { minY: -0.1, maxY: 0 };
    let minY = Infinity;
    let maxY = -Infinity;
    for (const b of gs.blocks) {
      const by = FixedMath.toFloat(b.y);
      const h = FixedMath.toFloat(b.height);
      const bottom = by - h / 2;
      const top = by + h / 2;
      if (bottom < minY) minY = bottom;
      if (top > maxY) maxY = top;
    }
    // Include base slightly below
    minY = Math.min(minY, -0.2);
    return { minY, maxY };
  }, []);

  // Optimized frame loop with reduced overhead
  const tickAccumulatorRef = useRef(0);

  useFrame((_, delta) => {
    // Fixed timestep simulation - synchronized with rendering
    // This ensures simulation and visual updates happen on the same frame
    const frameNow = typeof performance !== 'undefined' ? performance.now() : Date.now();
    const frozen = frameNow < impactRef.current.stopUntil;
    if (frozen) {
      // Hit stop: nothing advances, and no catch-up afterwards either.
      tickAccumulatorRef.current = 0;
    }

    if (isPlaying && stepSimulationFrame && !frozen) {
      const TICK_DURATION = 1000 / 60; // 60 ticks per second
      const deltaMs = delta * 1000; // Convert to milliseconds

      // Cap delta to prevent huge accumulator buildup on frame drops
      // This prevents the "spiral of death" where simulation catches up causes more frame drops
      const cappedDeltaMs = Math.min(deltaMs, 100); // Max 100ms (10 FPS minimum)

      // Accumulate time scaled by timeScale
      tickAccumulatorRef.current += cappedDeltaMs * timeScale;

      // Limit simulation steps per frame to prevent lockup
      const MAX_STEPS_PER_FRAME = 4;
      let stepsThisFrame = 0;

      // Process accumulated ticks
      while (tickAccumulatorRef.current >= TICK_DURATION && stepsThisFrame < MAX_STEPS_PER_FRAME) {
        tickAccumulatorRef.current -= TICK_DURATION;
        stepSimulationFrame();
        stepsThisFrame++;
      }

      // If we hit the step limit, clamp accumulator to prevent infinite catch-up
      if (stepsThisFrame >= MAX_STEPS_PER_FRAME && tickAccumulatorRef.current > TICK_DURATION * 2) {
        tickAccumulatorRef.current = TICK_DURATION * 2;
      }
    }

    if (cameraRef.current && gameState && gameState.blocks.length > 0) {
      const cam = cameraRef.current;

      // The standoff is tuned for a landscape monitor. A portrait phone has a horizontal field
      // of view a quarter as wide, so at the same distance a four-unit block filled the whole
      // width of the screen and the tower under it was never in frame. Back off in proportion.
      const aspect = viewportHeight > 0 ? viewportWidth / viewportHeight : 1;
      const reach = Math.min(2.4, Math.max(1, 1 / aspect));

      if (gameState.isGameOver) {
        // Hold on the finished tower. This used to hand the camera to a controller that flew
        // off to frame an "overview" of towers this scene no longer holds, while the blocks
        // themselves were hidden -- so the end of every run was a shot of an empty floor. The
        // run deserves its own picture: ease back and up until the whole tower is in frame.
        gameOverZoomRef.current.active = false;
        const { minY, maxY } = computeTowerBounds(gameState);
        const last = gameState.blocks[gameState.blocks.length - 1];
        // Block coordinates are simulation-local; the camera lives in world space, so every
        // focus point picks up the plot offset the blocks are drawn at.
        const cx = (last ? FixedMath.toFloat(last.x) : 0) + originX;
        const cz = (last ? FixedMath.toFloat(last.z ?? 0) : 0) + originZ;
        const mid = (minY + maxY) / 2;
        const standoff = Math.max(58, (maxY - minY) * 1.41) * reach;
        const wantX = cx + standoff * 0.72;
        const wantY = mid + standoff * 0.42;
        const wantZ = cz + standoff * 0.72;
        easeToward(cameraBaseRef.current, wantX, wantY, wantZ, 0.035);
        easeToward(lookAtTargetRef.current, cx, mid, cz, 0.05);
        cam.position.set(cameraBaseRef.current.x, cameraBaseRef.current.y, cameraBaseRef.current.z);
        const lookAtVec = lookAtVectorRef.current;
        lookAtVec.set(
          lookAtTargetRef.current.x,
          lookAtTargetRef.current.y,
          lookAtTargetRef.current.z
        );
        cam.lookAt(lookAtVec);
        applyImpactToCamera(cam, lookAtVec, impactRef.current, frameNow, reach);
        return;
      } else if (!manualCameraControl) {
        // Automatic camera control (only when manual control is disabled)
        // Normal follow of the top block
        const topBlock = gameState.blocks[gameState.blocks.length - 1];
        if (!topBlock) return;
        const topY = FixedMath.toFloat(topBlock.y + topBlock.height / 2);
        const topX = FixedMath.toFloat(topBlock.x) + originX;

        // Standoffs scaled by 0.83 for the wider lens, so the tower is framed as before.
        const desiredBaseY = topY + 16.6 * reach;
        const desiredBaseZ = originZ + 33 * reach;
        const desiredBaseX = topX + 33 * reach;

        // Smoothly update the camera base to follow tower
        cameraBaseRef.current.y += (desiredBaseY - cameraBaseRef.current.y) * 0.08;
        cameraBaseRef.current.z += (desiredBaseZ - cameraBaseRef.current.z) * 0.06;
        cameraBaseRef.current.x += (desiredBaseX - cameraBaseRef.current.x) * 0.12;

        // Apply camera position
        cameraRef.current.position.set(
          cameraBaseRef.current.x,
          cameraBaseRef.current.y,
          cameraBaseRef.current.z
        );

        // Look at target
        const topBlock2 = gameState.blocks[gameState.blocks.length - 1];
        if (topBlock2) {
          const desiredTargetX = FixedMath.toFloat(topBlock2.x) + originX;
          const desiredTargetY = FixedMath.toFloat(topBlock2.y + topBlock2.height);
          const desiredTargetZ = FixedMath.toFloat(topBlock2.z ?? 0) + originZ;

          // Update all lookAt target coordinates to follow the tower
          lookAtTargetRef.current.x += (desiredTargetX - lookAtTargetRef.current.x) * 0.08;
          lookAtTargetRef.current.y += (desiredTargetY - lookAtTargetRef.current.y) * 0.08;
          lookAtTargetRef.current.z += (desiredTargetZ - lookAtTargetRef.current.z) * 0.08;

          // DEBUG: Track lookAt target updates (removed to prevent spam)
        }
        const lookAtVec = lookAtVectorRef.current;
        lookAtVec.set(
          lookAtTargetRef.current.x,
          lookAtTargetRef.current.y,
          lookAtTargetRef.current.z
        );
        cameraRef.current.lookAt(lookAtVec);
        applyImpactToCamera(cameraRef.current, lookAtVec, impactRef.current, frameNow, reach);
      }

      // Camera positioning is now handled above in the manual control check
    }

    // Capture the last known visual position of the moving block so when it becomes a
    // placed block we can spawn the placed mesh from that position and animate it into place.
    if (gameState && gameState.currentBlock) {
      lastActivePosRef.current = {
        x: convertPosition(gameState.currentBlock.x),
        y: convertPosition(gameState.currentBlock.y + gameState.currentBlock.height / 2),
        z: convertPosition(gameState.currentBlock.z ?? 0),
      };
      lastMovingBlockRef.current = {
        ...lastActivePosRef.current,
        width: convertPosition(gameState.currentBlock.width),
        height: convertPosition(gameState.currentBlock.height),
        depth: convertPosition(gameState.currentBlock.depth ?? gameState.currentBlock.width),
      };
    }
    // Keep main shadow-casting light aligned with the camera so shadow frustum
    // follows the visible area as the camera moves upward.
  });

  // Audio feedback: whoosh while falling, thunk/chime on placement
  React.useEffect(() => {
    if (!gameState) return;

    // Initialize music manager once when we have a game state
    MusicManager.init();

    // A new game (only the base block): start the intro -> loop flow, once. This effect runs on
    // every frame, and each startGame stops the one before, so calling it for as long as the base
    // block stood alone cancelled every intro before it began: the music stayed silent until the
    // first drop, and each frame built new audio nodes. The new game is read from this effect's
    // own previous count, in the same run that starts the intro: the relay's first frame on a new
    // tower still carries the last tower's blocks, and the camera's new-game reset, which runs
    // after this effect, would restart the intro a frame later.
    if (gameState.blocks.length <= 1 && prevBlocksRef.current > 1) introStartedRef.current = false;
    if (gameState.blocks.length <= 1 && !introStartedRef.current) {
      introStartedRef.current = true;
      MusicManager.startGame();
    }

    // Play whoosh when the current block starts falling
    if (gameState.currentBlock && gameState.currentBlock.isFalling) {
      // AudioPlayer.playWhoosh(0.12, 380 + Math.random() * 120);
    }

    // Detect new block added -> placement occurred
    const prev = prevBlocksRef.current;
    const current = gameState.blocks.length;
    if (current > prev) {
      const last = gameState.blocks[gameState.blocks.length - 1];
      const below = gameState.blocks[gameState.blocks.length - 2];

      // Single source of truth for a strict perfect: simulation reports noTrim on last placement.
      const simPlacement = (gameState as any).lastPlacement as {
        noTrim: boolean;
        isPositionPerfect: boolean;
        comboAfter: number;
      } | null;
      const isPerfectPlacement = !!simPlacement?.noTrim;

      if (prev > 0) {
        if (isPerfectPlacement) {
          triggerHapticFeedback(PERFECT_VIBRATION_PATTERN);
        } else if (missFeedbackEnabledRef.current) {
          triggerHapticFeedback(MISS_VIBRATION_PATTERN);
        }
        impact(isPerfectPlacement ? 'perfect' : 'land');
        const at = typeof performance !== 'undefined' ? performance.now() : Date.now();
        setLanding({ index: current - 1, at, perfect: isPerfectPlacement });
        if (last) {
          const ring: LandingRing = {
            key: at,
            x: FixedMath.toFloat(last.x),
            y: FixedMath.toFloat(last.y),
            z: FixedMath.toFloat(last.z ?? 0),
            width: FixedMath.toFloat(last.width),
            depth: FixedMath.toFloat(last.depth ?? last.width),
            at,
            perfect: isPerfectPlacement,
          };
          setRings((r) => [...r.slice(-5), ring]);
        }
      }

      // Track streak (internal refs)
      const prevStreak = perfectStreakRef.current;
      if (isPerfectPlacement) {
        perfectStreakRef.current = prevStreak + 1;
      } else {
        perfectStreakRef.current = 0;
      }
      const streakLen = perfectStreakRef.current;
      const startingStreak = streakLen === 1;
      const continuingStreak = streakLen > 1 && isPerfectPlacement;
      const endingStreak = !isPerfectPlacement && prevStreak > 0;
      perfectTierRef.current = computeTier(streakLen);

      // Assign gradient / frozen colors for the newly placed block
      const newIndex = gameState.blocks.length - 1;
      if (!blockColorsRef.current[newIndex]) {
        if (
          freezeColorRef.current &&
          (continuingStreak || (prevStreak > 0 && isPerfectPlacement))
        ) {
          blockColorsRef.current[newIndex] = freezeColorRef.current; // continue frozen color
        } else {
          const col = generateGradientColor(shadeStepRef.current);
          blockColorsRef.current[newIndex] = col;
          shadeStepRef.current++;
          if (startingStreak) {
            freezeColorRef.current = col; // freeze during streak
          }
        }
      }
      if (endingStreak) {
        freezeColorRef.current = null; // clear when streak breaks
      }

      // The base block arriving on the first frame is not a placement: no sound, no streak,
      // and above all no miss. It used to count as one, so every run opened with a thud and a
      // red cross in the HUD before the player had touched anything.
      if (prev === 0) {
        // Nothing to judge yet.
      } else if (isPerfectPlacement && last && below) {
        AudioPlayer.playPerfectImpact(perfectTierRef.current, perfectStreakRef.current);
        // Reset miss streak when a perfect occurs
        if (missStreakRef.current > 0) {
          missStreakRef.current = 0;
          missTierRef.current = 0;
        }

        const contactY = FixedMath.toFloat(below.y + below.height);
        const cx = FixedMath.toFloat(last.x);
        const cz = FixedMath.toFloat(last.z ?? 0);
        const width = FixedMath.toFloat(last.width);
        const height = FixedMath.toFloat(last.height);
        lastPerfectContactRef.current = { pos: [cx, contactY, cz], width, height };
        perfectEventKeyRef.current++;
        setEdgeCascadeEvent((prev) => {
          const nextKey = (prev?.key ?? 0) + 1;
          const start = typeof performance !== 'undefined' ? performance.now() : Date.now();
          return {
            key: nextKey,
            start,
            tier: perfectTierRef.current,
            totalBlocks: gameState.blocks.length,
          };
        });
        // Dispatch a custom DOM event for UI layer (avoids polling)
        try {
          window.dispatchEvent(
            new CustomEvent('perfect-streak-advance', {
              detail: {
                streak: perfectStreakRef.current,
                tier: perfectTierRef.current,
                placement: {
                  x: FixedMath.toFloat(last.x),
                  y: FixedMath.toFloat(below.y + below.height),
                  width: FixedMath.toFloat(last.width),
                },
              },
            })
          );
        } catch {}
      } else {
        AudioPlayer.playThud(0.55, 70);
        // Increment miss streak (only if not perfect)
        if (missFeedbackEnabledRef.current) {
          missStreakRef.current = missStreakRef.current + 1;
          missTierRef.current = computeMissTier(missStreakRef.current);
          try {
            window.dispatchEvent(
              new CustomEvent('imperfect-streak-advance', {
                detail: {
                  streak: missStreakRef.current,
                  tier: missTierRef.current,
                },
              })
            );
          } catch {}
          // Audio cue for miss tier (mild). Avoid spamming low-tier every single time by gating.
          if (missStreakRef.current % 2 === 0 || missTierRef.current >= 2) {
            AudioPlayer.playMissImpact(missTierRef.current, missStreakRef.current);
          }
        }
      }

      // Store placement perfectness for highlight logic
      (globalThis as any).__lastPlacementPerfect = isPerfectPlacement;
      (globalThis as any).__perfectStreakLenRef = perfectStreakRef.current;
      (globalThis as any).__perfectTierRef = perfectTierRef.current;
      (globalThis as any).__missStreak = missStreakRef.current;
      (globalThis as any).__missTier = missTierRef.current;
    }

    prevBlocksRef.current = current;
  }, [gameState]);

  // Removed ghost intro effect: real seeding now handles initial stack visuals

  // Music transitions driven by block count milestones and game over
  React.useEffect(() => {
    if (!gameState) return;
    // Only trigger transitions when BOTH conditions are met:
    //  - block count has passed a threshold
    //  - the current moving block is sufficiently small compared to the top block
    // This prevents a crescendo/transition from firing while the player still has the
    // majority of the moving block.
    const TRANSITION_COUNT = 10;
    const TRANSITION_RATIO = 0.8; // currentBlock.width < top.width * 0.8
    const CRESCENDO_COUNT = 30;
    const CRESCENDO_RATIO = 0.5; // currentBlock.width <= top.width * 0.5

    // track which stage we've reached so we don't repeatedly retrigger
    const stageRef = musicStageRef;

    const count = gameState.blocks.length;
    const top =
      gameState.blocks && gameState.blocks.length > 0
        ? gameState.blocks[gameState.blocks.length - 1]
        : null;
    const current = gameState.currentBlock || null;

    // Helper to compare sizes (works with width/depth — use width as primary)
    const currentWidth = current ? current.width : null;
    const topWidth = top ? top.width : null;

    if (gameState.isGameOver) {
      // Game over always transitions back
      MusicManager.gameOverReturn();
      stageRef.current = 'gameover';
      // Once per run: `fallen` is emptied when a new game starts.
      if (fallen.length === 0) {
        impact('over');
        AudioPlayer.playThud(0.9, 55);
        // The block that missed keeps going: off the edge, down past the tower, onto the floor.
        const b = lastMovingBlockRef.current;
        if (b) {
          const len = Math.hypot(b.x, b.z) || 1;
          setFallen([
            {
              key: 'fell-off',
              x: b.x,
              y: b.y,
              z: b.z,
              width: b.width,
              height: b.height,
              depth: b.depth,
              dirX: b.x / len,
              dirZ: b.z / len,
              color: playerColorTheme?.accentHex ?? '#00f2fe',
            },
          ]);
        }
      }
      return;
    }

    // Transition to main loops
    if (
      stageRef.current === 'start' &&
      count >= TRANSITION_COUNT &&
      currentWidth != null &&
      topWidth != null &&
      currentWidth < topWidth * TRANSITION_RATIO
    ) {
      MusicManager.transitionToSection();
      stageRef.current = 'main';
    }

    // Crescendo: require that we've already transitioned to main and that the player
    // is currently playing with a block smaller than the crescendo ratio
    if (
      stageRef.current !== 'crescendo' &&
      count >= CRESCENDO_COUNT &&
      currentWidth != null &&
      topWidth != null &&
      currentWidth <= topWidth * CRESCENDO_RATIO
    ) {
      // Only allow crescendo if we're not still in the early stages
      MusicManager.crescendo();
      stageRef.current = 'crescendo';
    }
  }, [gameState && gameState.blocks.length, gameState && gameState.isGameOver]);

  // Trigger zoom-out when game over begins
  React.useEffect(() => {
    if (!gameState || !cameraRef.current) return;
    const cam = cameraRef.current;
    const wasActive = gameOverZoomRef.current.active || false;

    if (gameState.isGameOver && !wasActive) {
      const { minY, maxY } = computeTowerBounds(gameState);

      // Check for radial stats bounds for better framing
      const statsBounds = (globalThis as any).__END_STATS_BOUNDS__;
      let effectiveMinY = minY;
      let effectiveMaxY = maxY;

      if (statsBounds && statsBounds.min && statsBounds.max) {
        effectiveMinY = Math.min(minY, statsBounds.min.y);
        effectiveMaxY = Math.max(maxY, statsBounds.max.y);
      }

      const margin = 4.0; // larger margin for more dramatic zoom out
      const desiredHalfHeight = Math.max(3, (effectiveMaxY - effectiveMinY) / 2 + margin);
      const minTargetDistance = Math.max(80, desiredHalfHeight * 2.4);

      // Calculate zoom out while maintaining the current view
      const currentDistance = cam.position.distanceTo(
        new THREE.Vector3(
          lookAtTargetRef.current.x,
          lookAtTargetRef.current.y,
          lookAtTargetRef.current.z
        )
      );
      const targetDistance = Math.max(currentDistance * 2, minTargetDistance); // Zoom out 2x or based on tower height

      // Enable smooth zoom animation that preserves angle
      gameOverZoomRef.current = {
        active: true,
        start: typeof performance !== 'undefined' ? performance.now() : Date.now(),
        duration: 1500, // 1.5 second smooth zoom animation
        startZoom: currentDistance,
        targetZoom: targetDistance,
        startBaseY: cameraBaseRef.current.y,
        targetBaseY: cameraBaseRef.current.y,
        startLookY: lookAtTargetRef.current.y,
        targetLookY: lookAtTargetRef.current.y,
      };

      // Camera synchronization now handled by TowerCameraController
    }
  }, [gameState && gameState.isGameOver, computeTowerBounds]);

  // Initialize and reset camera - ONLY when truly needed
  const lastBlockCountRef = useRef(0);
  React.useEffect(() => {
    if (!cameraRef.current) return;
    const cam = cameraRef.current;

    // Set initial camera position if not set - moved back and up
    if (cam.position.length() === 0) {
      cam.position.set(40, 28, 40);
      cameraBaseRef.current = { x: 40, y: 28, z: 40 };
    }

    if (!gameState) return;

    const currentBlockCount = gameState.blocks.length;
    const lastBlockCount = lastBlockCountRef.current;

    // Only reset when we go from many blocks to few blocks (new game started)
    // AND we're not in game over state
    if (!gameState.isGameOver && currentBlockCount <= 1 && lastBlockCount > 1) {
      gameOverZoomRef.current.active = false;

      // Back to the opening shot of the run's own cell. This used to be a fixed point by the
      // world origin, so a second run on a plot far from the middle of the map opened with the
      // camera flying across the map to find it.
      cam.position.set(originX + 40, 28, originZ + 40);
      cameraBaseRef.current = { x: originX + 40, y: 28, z: originZ + 40 };
      lookAtTargetRef.current.x = originX;
      lookAtTargetRef.current.y = 0;
      lookAtTargetRef.current.z = originZ;
      musicStageRef.current = 'start';

      // Reset shading state for new game
      blockColorsRef.current = [];
      shadeStepRef.current = 0;
      freezeColorRef.current = null;
      setLanding(null);
      setRings([]);
      setFallen([]);
    }

    lastBlockCountRef.current = currentBlockCount;
  }, [gameState && gameState.blocks.length, gameState && gameState.isGameOver]);

  // Camera panning now handled by TowerCameraController

  // Moments from outside this client's own simulation: another player's miss shakes the frame
  // the way your own does, and a healed top flashes and throws a ring so the heal is seen.
  // Whatever moment was current when this scene mounted belongs to a scene that came before it.
  const feltImpulse = useRef(impulse?.key ?? 0);
  React.useEffect(() => {
    if (!impulse || impulse.key === feltImpulse.current || !gameState) return;
    feltImpulse.current = impulse.key;
    if (impulse.kind !== 'heal') {
      impact(impulse.kind);
      return;
    }
    const index = gameState.blocks.length - 1;
    const top = gameState.blocks[index];
    if (!top) return;
    const at = typeof performance !== 'undefined' ? performance.now() : Date.now();
    setLanding({ index, at, perfect: true });
    setRings((r) => [
      ...r.slice(-5),
      {
        key: at,
        x: FixedMath.toFloat(top.x),
        y: FixedMath.toFloat(top.y + top.height),
        z: FixedMath.toFloat(top.z ?? 0),
        width: FixedMath.toFloat(top.width),
        depth: FixedMath.toFloat(top.depth ?? top.width),
        at,
        perfect: true,
      },
    ]);
    // Keyed on the impulse alone: it is the moment, not the state, that is being felt.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [impulse?.key]);

  const debris = React.useMemo(
    () => (extraDebris && extraDebris.length > 0 ? [...fallen, ...extraDebris] : fallen),
    [fallen, extraDebris]
  );

  // Don't render anything if there's no game state (before game starts)
  if (!gameState) return null;

  /**
   * The colour of the block in play: what the moving block is drawn in, and what anything cut
   * off it is thrown in. Read during the render of the tick a placement lands, which is when
   * the debris for that placement is spawned, so an offcut carries the colour of the block it
   * came off rather than the one that follows it.
   */
  const currentBlockColor =
    activeBlockColor ?? freezeColorRef.current ?? generateGradientColor(shadeStepRef.current);

  return (
    <>
      {/* Performance Monitor moved to App.tsx as DOM overlay */}

      {/* Endgame overlay removed from scene; stats now handled by GameUI */}
      {/* PERFECT layered effects (Three.js) - ENABLED */}
      {/* {lastPerfectContactRef.current && (
        <PerfectPlacementEffects
          key={perfectEventKeyRef.current}
          triggerKey={perfectEventKeyRef.current}
          effectPosition={lastPerfectContactRef.current?.pos || [0, 0, 0]}
          blockWidth={lastPerfectContactRef.current?.width || 1}
          blockHeight={lastPerfectContactRef.current?.height || 1}
          tier={perfectTierRef.current}
        />
      )} */}

      {/* Same lens as the board: fov 30, near 1. The board used to force these back on every
          frame because the run installed a different camera, and the correction was a visible
          pop at the start and end of every run. Matching them means the swap changes nothing
          about the lens, so only the position moves, and the position is handed over. */}
      <perspectiveCamera
        ref={cameraRef}
        fov={30}
        near={1}
        far={12000} // Matches the board camera so a fitted thousand-block tower is never clipped
        position={[30.4, 21.1, 30]}
      />

      {/* Dark cyberpunk background */}
      <color attach="background" args={['#000814']} />

      {/* The same floor the board stands on, so a run and its placement are one place. It
          recedes as the camera follows the tower up, which is the only cue of height the
          game has. */}
      {/* No origin override. The board draws its grid on cell boundaries and so does this; the
          run is offset onto a cell instead of the grid being offset onto the run. */}
      <BoardFloor color="#2a86a8" fadeDistance={260 * floorReach} />

      {/* Postprocessing effects (bloom for emissive outlines) */}
      <EffectsRenderer />

      {/* The run, moved onto its cell. One group so blocks, debris, rings and growth effects
          can all keep working in simulation coordinates. */}
      <group position={[originX, 0, originZ]}>
        {/* Floating ambient particles that react to placed blocks - rendered inside the blocks group below */}

        {/* Axes helper to show coordinate orientation: X=red, Y=green, Z=blue */}
        {/* <primitive ref={axesRef} object={new THREE.AxesHelper(2)} position={[10, 10, 0]} /> */}

        {/* Post-game towers - render other players' towers when game is over - REMOVED DUPLICATE */}

        {/* Ghost Tower (static, offset behind player) */}
        {ghostTowerBlocks && ghostTowerBlocks.length > 0 && (
          <group position={[0, 0, -gridSize * 1.1]}>
            <GPUGameBlocks
              blocks={ghostTowerBlocks}
              activeBlock={null}
              convertPosition={convertPosition}
              isGhost={true}
            />
          </group>
        )}

        {/* Render all blocks - with frustum culling for performance */}
        <group>
          {/* No ghost stack: initial real blocks are seeded in simulation */}

          {/* Drawn on game over too. The finished tower used to vanish the instant the run ended,
            because a second renderer was expected to take over and never did. */}
          {gameState &&
            gameState.blocks.map((block, index) => {
              // Frustum culling: skip rendering if block is outside camera view
              if (!visibleBlockIndices.current.has(index)) {
                return null;
              }

              const isNewTop =
                gameState.blocks.length > prevBlocksRef.current &&
                index === gameState.blocks.length - 1;
              const spawnFrom = isNewTop
                ? (lastPlacementSpawnRef.current ?? lastActivePosRef.current ?? undefined)
                : undefined;
              if (isNewTop) {
                lastPlacementSpawnRef.current = null;
              }
              const highlightPerfect =
                lastPerfectContactRef.current &&
                index === gameState.blocks.length - 1 &&
                (globalThis as any).__lastPlacementPerfect;
              const color = paletteByIndex
                ? (paletteByIndex[index] ?? undefined)
                : (blockColorsRef.current[index] ?? undefined);
              return (
                <GameBlock
                  key={`block-${index}`}
                  block={block}
                  isActive={false}
                  convertPosition={convertPosition}
                  spawnFrom={spawnFrom}
                  highlight={highlightPerfect ? 'perfect' : null}
                  blockIndex={index}
                  enableDebugWireframe={enableDebugWireframe}
                  combo={gameState.combo}
                  lastPlacement={gameState.lastPlacement}
                  perfectEdgeEvent={edgeCascadeEvent}
                  playerTheme={playerColorTheme}
                  landed={landing && landing.index === index ? landing : undefined}
                  {...(color ? { color } : {})}
                />
              );
            })}

          {/* Current moving block */}
          {gameState &&
            !gameState.isGameOver &&
            gameState.currentBlock &&
            (() => {
              // Render the active/current block visually flush on top of the highest placed block.
              // We do a shallow copy and override the y (visual only) so simulation state remains authoritative.
              const current = { ...gameState.currentBlock };
              if (gameState.blocks && gameState.blocks.length > 0) {
                const top = gameState.blocks[gameState.blocks.length - 1];
                if (top) {
                  // Align bottom of active block with top surface of tower using fixed-point units
                  current.y = top.y + top.height + 1;
                }
              }
              return (
                <GameBlock
                  key="current-block"
                  block={current}
                  isActive={true}
                  convertPosition={convertPosition}
                  highlight={(globalThis as any).__lastPlacementPerfect ? 'perfect' : null}
                  blockIndex={gameState.blocks.length}
                  enableDebugWireframe={enableDebugWireframe}
                  combo={gameState.combo}
                  lastPlacement={gameState.lastPlacement}
                  // Preview next color: either frozen streak color or upcoming gradient step
                  color={currentBlockColor}
                  perfectEdgeEvent={edgeCascadeEvent}
                  playerTheme={playerColorTheme}
                />
              );
            })()}
        </group>

        {/* What gets cut off stays on the floor; what lands throws a ring. */}
        <CutDebris
          trimEffects={gameState.recentTrimEffects}
          convertPosition={convertPosition}
          extra={debris}
          color={currentBlockColor}
        />
        <LandingRings rings={rings} />
        {gameState && passes && passes.length > 0 && (
          <PassRings passes={passes} blocks={gameState.blocks} />
        )}

        {gameState && !gameState.isGameOver && (
          <>
            {gameState.recentGrowthEffects && (
              <GrowthEffects
                growthEffects={gameState.recentGrowthEffects}
                convertPosition={convertPosition}
                currentTick={gameState.tick}
                theme={playerColorTheme}
              />
            )}
          </>
        )}
      </group>
    </>
  );
};
