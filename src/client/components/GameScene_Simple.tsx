import React, { useRef } from 'react';
// Html overlay removed; no longer importing Html
import { useFrame, useThree } from '@react-three/fiber';
// Removed OrbitControls - using custom TowerCameraController instead
import * as THREE from 'three';
import { AudioPlayer, MusicManager } from './AudioPlayer';
import { GameState, FixedMath } from '../../shared/simulation';
import { GameBlock } from './GameBlock_Simple';
import { EffectsRenderer } from './EffectsRenderer';
import { TronClearDisintegration } from './TronClearDisintegration';
import { FloatingParticles } from './FloatingParticles';
import { PerfectPlacementEffects } from './PerfectPlacementEffects';
import { TronBackground } from './TronBackground';
import { UnifiedTowerSystem } from './UnifiedTowerSystem';
import { TowerCameraController } from './TowerCameraController';
import { TowerPlacementSystem } from '../../shared/types/towerPlacement';
import { GameMode } from '../types/gameMode';
import { TowerMapEntry } from '../../shared/types/api';

// Global debug flag to silence per-frame console output
const DEBUG_LOGS = false;

// Disable continuous logging for performance - removed unused variable



interface GameSceneProps {
  gameState: GameState | null;
  gameMode?: GameMode;
  onTimeScale?: (scale: number) => void;
  gridSize?: number;
  gridOffsetX?: number;
  gridOffsetZ?: number;
  gridLineWidth?: number;
  enableDebugWireframe?: boolean;
  playerTower?: any;
  selectedTower?: TowerMapEntry | null;
  onCameraDebugUpdate?: (debug: any) => void;
  onCameraReady?: (camera: THREE.PerspectiveCamera) => void;
  onTowerClick?: (tower: TowerMapEntry, position: [number, number, number], rank?: number) => void;
  onTowerPlacementSave?: (sessionId: string, worldX: number, worldZ: number, gridX: number, gridZ: number) => Promise<void>;
  preAssignedTowers?: TowerMapEntry[] | null | undefined;
  placementSystem?: TowerPlacementSystem;
}

export const GameScene: React.FC<GameSceneProps> = ({
  gameState,
  gameMode: _gameMode = 'playing', // Prefixed with underscore to indicate intentionally unused
  gridSize = 8,
  gridOffsetX = -4.0,
  gridOffsetZ = -4.0,
  gridLineWidth,
  enableDebugWireframe = false,
  selectedTower,
  onTowerClick,
  playerTower,
  onCameraDebugUpdate,
  onCameraReady,
  onTowerPlacementSave: _onTowerPlacementSave, // Prefixed with underscore to indicate intentionally unused
  preAssignedTowers,
  placementSystem: externalPlacementSystem
}) => {
  const cameraRef = useRef<THREE.PerspectiveCamera>(null);
  // Removed orbitControlsRef - using custom camera controller
  const mainLightRef = useRef<THREE.DirectionalLight>(null as any);
  const _panOffset = useRef({ x: 0, y: 0, z: 0 }); // Prefixed with underscore to indicate intentionally unused
  const { gl: _gl, set } = useThree(); // Prefixed with underscore to indicate intentionally unused

  // Set perspective camera as default when it's ready - ONLY ONCE
  const cameraInitializedRef = useRef(false);
  React.useEffect(() => {
    if (cameraRef.current && !cameraInitializedRef.current) {
      set({ camera: cameraRef.current });

      // Apply optimized camera settings as defaults - moved back and up
      cameraRef.current.position.set(40, 28, 40);
      cameraRef.current.lookAt(0, 4, 0);

      // Set the lookAt target reference
      lookAtTargetRef.current.x = 0;
      lookAtTargetRef.current.y = 4;
      lookAtTargetRef.current.z = 0;

      // Initialize camera base reference
      cameraBaseRef.current = { x: 40, y: 28, z: 40 };

      console.log('🎥 INIT - Camera position (ONCE):', cameraRef.current.position.toArray());
      console.log('🎥 INIT - LookAt target (ONCE):', [lookAtTargetRef.current.x, lookAtTargetRef.current.y, lookAtTargetRef.current.z]);

      onCameraReady?.(cameraRef.current);
      cameraInitializedRef.current = true;
    }
  }, [set, onCameraReady]);

  // Auto-apply optimized preset after a short delay - ONLY ONCE
  React.useEffect(() => {
    const timer = setTimeout(() => {
      if (cameraRef.current && !cameraInitializedRef.current) {
        // Apply the exact same logic as the optimized preset - moved back and up
        cameraRef.current.position.set(40, 28, 40);
        cameraRef.current.rotation.set(
          -30 * Math.PI / 180,
          30 * Math.PI / 180,
          0
        );
        cameraRef.current.fov = 14;
        cameraRef.current.updateProjectionMatrix();
        cameraRef.current.lookAt(0, 4, 0);

        console.log('🎥 AUTO-OPTIMIZED - Applied optimized preset automatically (ONCE)');
      }
    }, 100); // Small delay to ensure everything is loaded

    return () => clearTimeout(timer);
  }, []);

  // Tower placement system - use external if provided, otherwise create local
  const placementSystemRef = useRef<TowerPlacementSystem>(
    externalPlacementSystem || new TowerPlacementSystem(gridSize, gridOffsetX, gridOffsetZ)
  );

  // Update placement system reference if external system changes
  React.useEffect(() => {
    if (externalPlacementSystem) {
      placementSystemRef.current = externalPlacementSystem;
    }
  }, [externalPlacementSystem]);

  const [towersData, setTowersData] = React.useState<TowerMapEntry[]>([]);

  // Camera control state - disabled by default for normal gameplay
  const [manualCameraControl, _setManualCameraControl] = React.useState(false); // Prefixed with underscore to indicate intentionally unused

  // DEBUG: Track manual camera control changes
  React.useEffect(() => {
    console.log('🎥 CONTROL - Manual camera control:', manualCameraControl);
  }, [manualCameraControl]);

  // Update placement system when grid parameters change
  React.useEffect(() => {
    placementSystemRef.current.updateGrid(gridSize, gridOffsetX, gridOffsetZ);
  }, [gridSize, gridOffsetX, gridOffsetZ]);

  // Real-time camera debug state
  const [_cameraDebug, setCameraDebug] = React.useState({ // Prefixed with underscore to indicate intentionally unused
    position: { x: 0, y: 0, z: 0 },
    distance: 0,
    lookAt: { x: 0, y: 0, z: 0 },
    isGameOver: false
  });

  const prevBlocksRef = useRef<number>(0);
  const lastActivePosRef = useRef<{ x: number; y: number; z: number } | null>(null);

  const lastFrameTimeRef = useRef<number | null>(null);
  const cameraBaseRef = useRef({ x: 40, y: 28, z: 40 });
  // Keep a constant horizontal offset so the camera keeps the same angle while
  // the lookAt target (top block) moves left/right.
  const _cameraOffsetXRef = useRef<number>(40); // Prefixed with underscore to indicate intentionally unused
  const lookAtTargetRef = useRef({ x: 0, y: 0, z: 0 });
  const musicStageRef = useRef<'start' | 'main' | 'crescendo' | 'gameover'>('start');
  // PERFECT placement tracking
  const perfectEventKeyRef = useRef<number>(0); // monotonic key for effect remount
  const lastPerfectContactRef = useRef<{ pos: [number, number, number]; width: number; height: number } | null>(null);
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
      if (typeof th === 'number' && streak >= th) tier = i; else break;
    }
    return Math.min(missTierThresholds.length - 1, tier);
  };
  // Configurable toggle (can be changed by UI or console): enable/disable miss feedback
  const missFeedbackEnabledRef = useRef<boolean>(true);
  (globalThis as any).__setMissFeedbackEnabled = (val: boolean) => { missFeedbackEnabledRef.current = !!val; };
  // Tier thresholds (streak lengths) for 16-tier escalation (tiers 0-15).
  // Designed with gradually increasing gaps to make late tiers rare & meaningful.
  // You reach tier i when streak >= tierThresholds[i].
  const tierThresholds = [
    0,  // 0  : PERFECT
    2,  // 1  : CLEAN
    4,  // 2  : PRECISE
    6,  // 3  : SHARPER
    9,  // 4  : FLAWLESS
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
    108 // 15 : GODLIKE
  ];
  const computeTier = (streak: number) => {
    let tier = 0;
    for (let i = 0; i < tierThresholds.length; i++) {
      const th = tierThresholds[i];
      if (typeof th === 'number' && streak >= th) tier = i; else break;
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



  // Returns a color that progresses through the color spectrum as the tower grows.
  // step=0 => vibrant red/orange; later steps cycle through the rainbow.
  const generateGradientColor = (step: number): string => {
    // Smooth cyan-blue gradient transition
    // Create a smooth sine wave between cyan and blue
    const t = (Math.sin(step * 0.3) + 1) / 2; // Normalize to 0-1

    // Cyan: #00ffff (0, 255, 255)
    // Blue: #0080ff (0, 128, 255)
    const r = 0; // Red stays 0
    const g = Math.floor(255 - (127 * t)); // Green: 255 → 128
    const b = 255; // Blue stays 255

    // Convert to hex
    const toHex = (n: number) => n.toString(16).padStart(2, '0');
    return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
  };

  // No ghost stack: we now seed real blocks at start, so intro visuals are handled by real placements

  // Convert fixed-point coordinates to Three.js world coordinates
  const convertPosition = (fixedValue: number): number => {
    return FixedMath.toFloat(fixedValue);
  };

  // Axes helper ref (for debugging/orientation) - not used in production

  // Optimized frame loop with reduced overhead
  const frameCountRef = useRef(0);

  useFrame(() => {
    frameCountRef.current++;

    // Only do expensive operations every 10th frame (6fps for debug checks)
    if (frameCountRef.current % 10 === 0) {
      try {
        const now = typeof performance !== 'undefined' ? performance.now() : Date.now();
        const last = lastFrameTimeRef.current;
        if (last != null && (now - last) > 100) { // Only log very long frames
          try {
            const g = globalThis as any;
            if (!g.__DEBUG_EVENTS) g.__DEBUG_EVENTS = [];
            g.__DEBUG_EVENTS.push({ ts: now, msg: 'longFrame', meta: { frameMs: now - last } });
            if (g.__DEBUG_EVENTS.length > 20) g.__DEBUG_EVENTS.shift(); // Much smaller buffer
          } catch (e) {
            // swallow
          }
        }
        lastFrameTimeRef.current = now;
      } catch (e) {
        // swallow
      }
    }


    if (cameraRef.current && gameState && gameState.blocks.length > 0) {
      const cam = cameraRef.current;



      // Update camera debug state - throttled to every 10th frame
      if (frameCountRef.current % 10 === 0) {
        const debugInfo = {
          position: {
            x: parseFloat(cam.position.x.toFixed(2)),
            y: parseFloat(cam.position.y.toFixed(2)),
            z: parseFloat(cam.position.z.toFixed(2))
          },
          distance: parseFloat(cam.position.distanceTo(new THREE.Vector3(lookAtTargetRef.current.x, lookAtTargetRef.current.y, lookAtTargetRef.current.z)).toFixed(2)),
          lookAt: {
            x: parseFloat(lookAtTargetRef.current.x.toFixed(2)),
            y: parseFloat(lookAtTargetRef.current.y.toFixed(2)),
            z: parseFloat(lookAtTargetRef.current.z.toFixed(2))
          },
          isGameOver: gameState.isGameOver
        };

        setCameraDebug(debugInfo);
        onCameraDebugUpdate?.(debugInfo);
      }

      // Handle game over - let TowerCameraController take full control
      if (gameState.isGameOver) {
        // Disable the old zoom animation system - TowerCameraController handles all camera movement now
        gameOverZoomRef.current.active = false;
        // Let TowerCameraController handle everything in post-game
        return;
      } else if (!manualCameraControl) {
        // Automatic camera control (only when manual control is disabled)
        // Normal follow of the top block
        const topBlock = gameState.blocks[gameState.blocks.length - 1];
        if (!topBlock) return;
        const topY = FixedMath.toFloat(topBlock.y + topBlock.height / 2);
        const topX = FixedMath.toFloat(topBlock.x);



        // Use optimized camera positioning relative to tower - moved back and up
        const desiredBaseY = topY + 20; // Increased height offset
        const desiredBaseZ = 40; // Increased Z distance
        const desiredBaseX = topX + 40; // Increased X offset

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
          const desiredTargetX = FixedMath.toFloat(topBlock2.x);
          const desiredTargetY = FixedMath.toFloat(topBlock2.y + topBlock2.height);
          const desiredTargetZ = FixedMath.toFloat(topBlock2.z ?? 0);

          // Update all lookAt target coordinates to follow the tower
          lookAtTargetRef.current.x += (desiredTargetX - lookAtTargetRef.current.x) * 0.08;
          lookAtTargetRef.current.y += (desiredTargetY - lookAtTargetRef.current.y) * 0.08;
          lookAtTargetRef.current.z += (desiredTargetZ - lookAtTargetRef.current.z) * 0.08;

          // DEBUG: Track lookAt target updates (removed to prevent spam)
        }
        const lookAtVec = new THREE.Vector3(
          lookAtTargetRef.current.x,
          lookAtTargetRef.current.y,
          lookAtTargetRef.current.z
        );
        cameraRef.current.lookAt(lookAtVec);

        // DEBUG: Check camera matrix after lookAt (removed to prevent spam)
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
      // Debug: report width/depth mismatches between current and top block
      const DEBUG_DROP = typeof globalThis !== 'undefined' && (globalThis as any).__DEBUG_DROP;
      if (DEBUG_DROP && gameState.blocks && gameState.blocks.length > 0) {
        const top = gameState.blocks[gameState.blocks.length - 1];
        if (top && gameState.currentBlock) {
          if (gameState.currentBlock.width !== top.width || (gameState.currentBlock.depth ?? gameState.currentBlock.width) !== (top.depth ?? top.width)) {
            if (DEBUG_LOGS) {
              // console.log('[DEBUG] width mismatch: current.width=', gameState.currentBlock.width, 'top.width=', top.width, 'current.depth=', gameState.currentBlock.depth, 'top.depth=', top.depth);
            }
          }
        }
      }
    }
    // Keep main shadow-casting light aligned with the camera so shadow frustum
    // follows the visible area as the camera moves upward.
    const light = mainLightRef.current as any;
    const cam = cameraRef.current;
    if (light && cam) {
      // place the light relative to camera so shadows stay within view
      const offset = new THREE.Vector3(3, 12, 6);
      const camPos = cam.position.clone();
      light.position.set(camPos.x + offset.x, camPos.y + offset.y, camPos.z + offset.z);

      // sync shadow camera for perspective view
      const distance = cam.position.distanceTo(new THREE.Vector3(lookAtTargetRef.current.x, lookAtTargetRef.current.y, lookAtTargetRef.current.z));
      const shadowSize = Math.max(20, distance * 0.5); // Scale shadow area with camera distance
      const sc = light.shadow && (light.shadow.camera as THREE.OrthographicCamera);
      if (sc) {
        sc.left = -shadowSize;
        sc.right = shadowSize;
        sc.top = shadowSize;
        sc.bottom = -shadowSize;
        sc.near = 0.5;
        sc.far = 200;
        sc.updateProjectionMatrix();
      }
      // Avoid disposing the shadow map every frame — that is very expensive and
      // will cause long main-thread stalls. Only update shadow camera extents
      // above; let Three.js manage the shadow map lifecycle.
    }
  });

  // Audio feedback: whoosh while falling, thunk/chime on placement
  React.useEffect(() => {
    if (!gameState) return;

    // Initialize music manager once when we have a game state
    MusicManager.init();

    // If this is the first frame with a non-null currentBlock it likely means a new game started.
    // Start the intro -> loop flow when blocks length is small (<=1 means just base block).
    if (gameState.blocks && gameState.blocks.length <= 1) {
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
      const simPlacement = (gameState as any).lastPlacement as { noTrim: boolean; isPositionPerfect: boolean; comboAfter: number } | null;
      const isPerfectPlacement = !!simPlacement?.noTrim;

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
        if (freezeColorRef.current && (continuingStreak || (prevStreak > 0 && isPerfectPlacement))) {
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

      if (isPerfectPlacement && last && below) {
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
        // Dispatch a custom DOM event for UI layer (avoids polling)
        try {
          window.dispatchEvent(new CustomEvent('perfect-streak-advance', {
            detail: {
              streak: perfectStreakRef.current,
              tier: perfectTierRef.current,
              placement: { x: FixedMath.toFloat(last.x), y: FixedMath.toFloat(below.y + below.height), width: FixedMath.toFloat(last.width) }
            }
          }));
        } catch { }
        // Global stat accumulation
        try {
          const g: any = globalThis as any;
          g.__PERFECT_COUNT = (g.__PERFECT_COUNT || 0) + 1;
          g.__MAX_PERFECT_STREAK = Math.max(g.__MAX_PERFECT_STREAK || 0, perfectStreakRef.current);
          if (simPlacement?.comboAfter != null) {
            g.__MAX_COMBO = Math.max(g.__MAX_COMBO || 0, simPlacement.comboAfter);
          }
        } catch { }
      } else {
        AudioPlayer.playThud(0.55, 70);
        // Increment miss streak (only if not perfect)
        if (missFeedbackEnabledRef.current) {
          missStreakRef.current = missStreakRef.current + 1;
          missTierRef.current = computeMissTier(missStreakRef.current);
          try {
            window.dispatchEvent(new CustomEvent('imperfect-streak-advance', {
              detail: {
                streak: missStreakRef.current,
                tier: missTierRef.current,
              }
            }));
          } catch { }
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
    const top = gameState.blocks && gameState.blocks.length > 0 ? gameState.blocks[gameState.blocks.length - 1] : null;
    const current = gameState.currentBlock || null;

    // Helper to compare sizes (works with width/depth — use width as primary)
    const currentWidth = current ? current.width : null;
    const topWidth = top ? top.width : null;

    if (gameState.isGameOver) {
      // Game over always transitions back
      MusicManager.gameOverReturn();
      stageRef.current = 'gameover';
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
      const _desiredHalfHeight = Math.max(3, (effectiveMaxY - effectiveMinY) / 2 + margin); // Prefixed with underscore to indicate intentionally unused

      // Preserve the current lookAt target from gameplay
      console.log('🎥 GAME-OVER - Current lookAt target:', [lookAtTargetRef.current.x, lookAtTargetRef.current.y, lookAtTargetRef.current.z]);

      // Calculate zoom out while maintaining the current view
      const currentDistance = cam.position.distanceTo(new THREE.Vector3(lookAtTargetRef.current.x, lookAtTargetRef.current.y, lookAtTargetRef.current.z));
      const targetDistance = Math.max(currentDistance * 2, 80); // Zoom out 2x or minimum 80 units for better overview

      console.log('🎥 GAME-OVER - Distance:', currentDistance, '→', targetDistance);

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
    if (!gameState.isGameOver &&
      currentBlockCount <= 1 &&
      lastBlockCount > 1) {

      console.log('🎥 NEW-GAME - Resetting camera for new game');
      gameOverZoomRef.current.active = false;

      // restore defaults - moved back and up
      cam.position.set(40, 28, 40);
      cameraBaseRef.current = { x: 40, y: 28, z: 40 };

      // Reset horizontal tracking to origin as well
      lookAtTargetRef.current.x = 0;
      lookAtTargetRef.current.y = 0;
      lookAtTargetRef.current.z = 0;
      musicStageRef.current = 'start';

      // Reset shading state for new game
      blockColorsRef.current = [];
      shadeStepRef.current = 0;
      freezeColorRef.current = null;
    }

    lastBlockCountRef.current = currentBlockCount;
  }, [gameState && gameState.blocks.length, gameState && gameState.isGameOver]);

  // Camera panning now handled by TowerCameraController

  // Camera control and debug keyboard shortcuts
  React.useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (!cameraRef.current) return;

      const cam = cameraRef.current;

      // Camera positioning shortcuts
      switch (e.key.toLowerCase()) {
        case '1': // Isometric view
          cam.position.set(8, 50, 6);
          cam.fov = 8;
          cam.updateProjectionMatrix();
          console.log('📷 Camera: Isometric view');
          break;
        case '2': // Top-down view
          cam.position.set(0, 80, 0);
          cam.fov = 15;
          cam.updateProjectionMatrix();
          console.log('📷 Camera: Top-down view');
          break;
        case '3': // Side view
          cam.position.set(30, 20, 0);
          cam.fov = 25;
          cam.updateProjectionMatrix();
          console.log('📷 Camera: Side view');
          break;
        case '4': // Perspective view
          cam.position.set(15, 25, 15);
          cam.fov = 45;
          cam.updateProjectionMatrix();
          console.log('📷 Camera: Perspective view');
          break;
        case 'r': // Reset to default
          cam.position.set(8, 50, 6);
          cam.fov = 8;
          cam.updateProjectionMatrix();
          console.log('📷 Camera: Reset to default');
          break;
        case 'p': // Print current camera position
          console.log('📷 Current camera position:', {
            position: cam.position.toArray(),
            fov: cam.fov
          });
          break;
        // Music debug shortcuts
        case 't':
          MusicManager.transitionToSection();
          break;
        case 'c':
          MusicManager.crescendo();
          break;
        case 'g':
          MusicManager.gameOverReturn();
          break;
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);



  // Don't render anything if there's no game state (before game starts)
  if (!gameState) {
    console.log('🎮 GameScene: No game state, returning null');
    return null;
  }

  console.log('🎮 GameScene: Rendering with game state:', {
    isGameOver: gameState.isGameOver,
    blocksCount: gameState.blocks.length,
    currentBlock: !!gameState.currentBlock
  });

  return (
    <>
      {/* Endgame overlay removed from scene; stats now handled by GameUI */}
      {/* PERFECT layered effects (Three.js) - ENABLED */}
      {lastPerfectContactRef.current && (
        <PerfectPlacementEffects
          key={perfectEventKeyRef.current}
          triggerKey={perfectEventKeyRef.current}
          effectPosition={lastPerfectContactRef.current?.pos || [0, 0, 0]}
          blockWidth={lastPerfectContactRef.current?.width || 1}
          blockHeight={lastPerfectContactRef.current?.height || 1}
          tier={perfectTierRef.current}
        />
      )}

      <perspectiveCamera
        ref={cameraRef}
        fov={14} // Optimized FOV for good perspective balance
        near={1.86}
        far={3500} // Extended far plane for infinite grid
        position={[30.4, 21.1, 30]} // Optimized isometric position
      />

      {/* Custom tower camera controller - ONLY render during game over */}
      {gameState?.isGameOver && (
        <TowerCameraController
          selectedTower={selectedTower}
          isGameOver={true}
          onCameraDebugUpdate={onCameraDebugUpdate}
          getTowersData={() => towersData}
        />
      )}



      {/* Tron-style lighting setup */}
      <hemisphereLight color={0x001122} groundColor={0x000408} intensity={0.3} />
      <directionalLight
        ref={mainLightRef}
        castShadow={true}
        // initial position will be overridden by useFrame alignment
        position={[3, 18, 6]}
        intensity={0.8}
        color={0x4488ff}
        shadow-mapSize-width={2048}
        shadow-mapSize-height={2048}
        shadow-camera-near={0.5}
        shadow-camera-far={200}
        shadow-camera-left={-20}
        shadow-camera-right={20}
        shadow-camera-top={20}
        shadow-camera-bottom={-20}
        shadow-bias={-0.0005}
      />

      {/* Darker ambient for cyberpunk mood */}
      <ambientLight intensity={0.25} color={0x002244} />

      {/* Dark cyberpunk background */}
      <color attach="background" args={["#000814"]} />

      {/* Tron-style fog */}
      {false && gameState && gameState?.isGameOver && (
        <fog attach="fog" args={["#000814", 15, 80]} />
      )}

      {/* Tron grid background */}
      <TronBackground
        gameState={gameState}
        gridSize={gridSize ?? 8.0}
        gridOffsetX={gridOffsetX ?? -4.0}
        gridOffsetZ={gridOffsetZ ?? -4.0}
        gridLineWidth={gridLineWidth ?? 3.0}
      />

      {/* Postprocessing effects (bloom for emissive outlines) */}
      <EffectsRenderer />

      {/* Floating ambient particles that react to placed blocks - rendered inside the blocks group below */}

      {/* Axes helper to show coordinate orientation: X=red, Y=green, Z=blue */}
      {/* <primitive ref={axesRef} object={new THREE.AxesHelper(2)} position={[10, 10, 0]} /> */}

      {/* Post-game towers - render other players' towers when game is over - REMOVED DUPLICATE */}

      {/* Render all blocks */}
      <group>
        {/* No ghost stack: initial real blocks are seeded in simulation */}

        {gameState && !gameState.isGameOver && gameState.blocks.map((block, index) => {
          const isNewTop = gameState.blocks.length > prevBlocksRef.current && index === gameState.blocks.length - 1;
          const spawnFrom = isNewTop ? lastActivePosRef.current ?? undefined : undefined;
          const highlightPerfect = lastPerfectContactRef.current && index === gameState.blocks.length - 1 && (globalThis as any).__lastPlacementPerfect;
          const color = blockColorsRef.current[index] ?? undefined;
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
              {...(color ? { color } : {})}
            />
          );
        })}

        {/* Current moving block */}
        {gameState && !gameState.isGameOver && gameState.currentBlock && (() => {
          // Render the active/current block visually flush on top of the highest placed block.
          // We do a shallow copy and override the y (visual only) so simulation state remains authoritative.
          const current = { ...gameState.currentBlock };
          if (gameState.blocks && gameState.blocks.length > 0) {
            const top = gameState.blocks[gameState.blocks.length - 1];
            if (top) {
              // place the bottom of the current block at the top surface of the top block
              // y values in simulation are center-based, so top surface = top.y + top.height
              // then current center y = topSurface + current.height/2
              current.y = top.y + top.height + current.height / 2;
            }
            // preserve fixed-point units (these are fixed values already)
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
              color={freezeColorRef.current ?? generateGradientColor(shadeStepRef.current)}
            />
          );
        })()}
        {/* Place floating particles in the same group as blocks so they align with the stack */}
        {gameState && !gameState.isGameOver && (<FloatingParticles gameState={gameState} convertPosition={convertPosition} />)}


      </group>

      {/* Clear Tron disintegration - shows what got cut, then fast particles */}
      {gameState && !gameState.isGameOver && (
        <TronClearDisintegration trimEffects={gameState.recentTrimEffects} convertPosition={convertPosition} currentTick={gameState.tick} />
      )}

      {/* Tron-style base platform - match actual block size */}
      <mesh position={[0, -0.1, 0]} receiveShadow>
        <boxGeometry args={[4, 0.2, 4]} />
        <meshStandardMaterial
          color="#001122"
          emissive="#003366"
          emissiveIntensity={0.3}
          metalness={0.8}
          roughness={0.2}
          toneMapped={false}
          visible={false}
        //wireframe
        />
      </mesh>

      {/* Glowing platform edges - Reddit orange */}
      <mesh position={[0, 0.05, 0]} receiveShadow={false}>
        <boxGeometry args={[4.1, 0.05, 4.1]} />
        <meshBasicMaterial
          color="#ff4500"
          transparent
          opacity={0.4}
          toneMapped={false}
        />
      </mesh>

      {/* Simple background */}
      {/* <mesh position={[0, 0, -5]} receiveShadow>
        <planeGeometry args={[20, 20]} />
        <meshBasicMaterial color="#1a2036" />
      </mesh> */}

      {/* Performance-Aware Tower System - ONLY render when game is over for performance */}
      {gameState?.isGameOver && (
        <UnifiedTowerSystem
          isGameOver={true}
          playerTower={playerTower}
          placementSystem={placementSystemRef.current}
          selectedTower={selectedTower || null}
          preAssignedTowers={preAssignedTowers}
          onTowerClick={(tower, position, rank) => {
            console.log('🏰 Tower clicked in GameScene:', tower.username, 'at', position, 'rank:', rank);
            onTowerClick?.(tower, position, rank);
          }}
          onTowersLoaded={(towers) => {
            setTowersData(towers);
            console.log('🏰 GameScene - Received towers data:', towers.length, 'towers');
          }}
        />
      )}

    </>
  );
};
