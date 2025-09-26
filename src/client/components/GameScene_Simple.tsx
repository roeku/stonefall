import React, { useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { OrthographicCamera } from '@react-three/drei';
import * as THREE from 'three';
import { AudioPlayer, MusicManager } from './AudioPlayer';
import { GameState, FixedMath } from '../../shared/simulation';
import { GameBlock } from './GameBlock_Simple';
import { EffectsRenderer } from './EffectsRenderer';
import { TrimEffects } from './TrimEffects';
import { FloatingParticles } from './FloatingParticles';

interface GameSceneProps {
  gameState: GameState | null;
  onTimeScale?: (scale: number) => void;
}

export const GameScene: React.FC<GameSceneProps> = ({ gameState }) => {
  const cameraRef = useRef<THREE.OrthographicCamera>(null);
  const mainLightRef = useRef<THREE.DirectionalLight>(null as any);
  useThree();

  const prevBlocksRef = useRef<number>(0);
  const lastActivePosRef = useRef<{ x: number; y: number; z: number } | null>(null);
  const shakeRef = useRef({ intensity: 0, time: 0 });
  const lastFrameTimeRef = useRef<number | null>(null);
  const cameraBaseRef = useRef({ x: 8, y: 32, z: 6 });
  // Keep a constant horizontal offset so the camera keeps the same angle while
  // the lookAt target (top block) moves left/right.
  const cameraOffsetXRef = useRef<number>(8);
  const lookAtTargetRef = useRef({ x: 0, y: 0, z: 0 });
  const musicStageRef = useRef<'start' | 'main' | 'crescendo' | 'gameover'>('start');
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

  // No ghost stack: we now seed real blocks at start, so intro visuals are handled by real placements

  // Convert fixed-point coordinates to Three.js world coordinates
  const convertPosition = (fixedValue: number): number => {
    return FixedMath.toFloat(fixedValue);
  };

  // Axes helper ref (for debugging/orientation) - not used in production

  // Controlled cinematic follow: small vertical adjustment, fixed distance
  useFrame(() => {
    try {
      const now = typeof performance !== 'undefined' ? performance.now() : Date.now();
      const last = lastFrameTimeRef.current;
      if (last != null) {
        const frameMs = now - last;
        // If a frame took longer than 40ms, record it to the global debug buffer.
        if (frameMs > 40) {
          try {
            const g = globalThis as any;
            if (!g.__DEBUG_EVENTS) g.__DEBUG_EVENTS = [];
            g.__DEBUG_EVENTS.push({ ts: now, msg: 'longFrame', meta: { frameMs } });
            if (g.__DEBUG_EVENTS.length > 500) g.__DEBUG_EVENTS.shift();
            if (g.__DEBUG_DROP) console.warn('[DBG] longFrame', frameMs);
          } catch (e) {
            // swallow
          }
        }
      }
      lastFrameTimeRef.current = now;
    } catch (e) {
      // swallow
    }


    if (cameraRef.current && gameState && gameState.blocks.length > 0) {
      const cam = cameraRef.current;

      // During game-over zoom-out, override normal follow behavior
      if (gameOverZoomRef.current.active || gameState.isGameOver) {
        // Progress animation if active
        if (gameOverZoomRef.current.active) {
          const nowMs = typeof performance !== 'undefined' ? performance.now() : Date.now();
          const t = Math.min(1, (nowMs - gameOverZoomRef.current.start) / gameOverZoomRef.current.duration);
          // easeOutCubic
          const e = 1 - Math.pow(1 - t, 3);
          const z = gameOverZoomRef.current.startZoom + (gameOverZoomRef.current.targetZoom - gameOverZoomRef.current.startZoom) * e;
          const by = gameOverZoomRef.current.startBaseY + (gameOverZoomRef.current.targetBaseY - gameOverZoomRef.current.startBaseY) * e;
          const ly = gameOverZoomRef.current.startLookY + (gameOverZoomRef.current.targetLookY - gameOverZoomRef.current.startLookY) * e;

          cam.zoom = z;
          cam.updateProjectionMatrix();
          cameraBaseRef.current.y = by;
          lookAtTargetRef.current.y = ly;

          if (t >= 1) {
            gameOverZoomRef.current.active = false; // keep final values
          }
        }

        // Disable shake during or after zoom-out
        shakeRef.current.intensity = 0;

        // Keep camera Z stable
        cameraBaseRef.current.z += (6.0 - cameraBaseRef.current.z) * 0.06;
      } else {
        // Normal follow of the top block
        // Use the last placed block (top of the stack) as the focus target
        const topBlock = gameState.blocks[gameState.blocks.length - 1];
        if (!topBlock) return;
        const topY = FixedMath.toFloat(topBlock.y + topBlock.height / 2);
        const topX = FixedMath.toFloat(topBlock.x);

        // Higher base offset for a better orthographic composition
        const desiredBaseY = topY + 4.4; // raised offset
        const desiredBaseZ = 6.0;

        // Smoothly update the camera base (this is the stable camera position without shake)
        cameraBaseRef.current.y += (desiredBaseY - cameraBaseRef.current.y) * 0.08;
        cameraBaseRef.current.z += (desiredBaseZ - cameraBaseRef.current.z) * 0.06;

        // Track X: smoothly move the lookAt target's X toward the top block center,
        // then keep the camera at a constant horizontal offset from that target.
        lookAtTargetRef.current.x += (topX - lookAtTargetRef.current.x) * 0.12;
        cameraBaseRef.current.x = lookAtTargetRef.current.x + cameraOffsetXRef.current;
      }

      // Compute shake offset (do not mutate base position)
      let shakeX = 0;
      let shakeY = 0;
      if (shakeRef.current.intensity > 0) {
        const t = shakeRef.current.time;
        const decay = 1 - t;
        const intensity = shakeRef.current.intensity * decay;
        shakeX = (Math.random() - 0.5) * intensity * 0.12;
        shakeY = (Math.random() - 0.5) * intensity * 0.06;
        // advance time
        shakeRef.current.time = Math.min(1, t + 0.04);
        if (shakeRef.current.time >= 1) {
          shakeRef.current.intensity = 0;
          shakeRef.current.time = 0;
        }
      }

      // Apply base position plus transient shake offsets (avoid accumulating errors)
      cameraRef.current.position.set(
        cameraBaseRef.current.x + shakeX, // center X on 0
        cameraBaseRef.current.y + shakeY,
        cameraBaseRef.current.z
      );

      // Look at:
      if (!(gameOverZoomRef.current.active || gameState.isGameOver)) {
        // Normal mode: follow the top surface
        const topBlock = gameState.blocks[gameState.blocks.length - 1];
        if (topBlock) {
          const desiredTargetY = FixedMath.toFloat(topBlock.y + topBlock.height);
          // Lerp the lookAt target for smooth camera motion
          lookAtTargetRef.current.y += (desiredTargetY - lookAtTargetRef.current.y) * 0.12;
        }
      }
      const lookAtVec = new THREE.Vector3(lookAtTargetRef.current.x, lookAtTargetRef.current.y, 0);
      cameraRef.current.lookAt(lookAtVec);
      cameraRef.current.updateProjectionMatrix();
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
            console.log('[DEBUG] width mismatch: current.width=', gameState.currentBlock.width, 'top.width=', top.width, 'current.depth=', gameState.currentBlock.depth, 'top.depth=', top.depth);
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

      // sync orthographic shadow camera extents to the visible camera area (scaled)
      const viewHalfWidth = (cam.right - cam.left) / 2 / (cam.zoom || 1);
      const viewHalfHeight = (cam.top - cam.bottom) / 2 / (cam.zoom || 1);
      const margin = 6; // extra padding
      const sc = light.shadow && (light.shadow.camera as THREE.OrthographicCamera);
      if (sc) {
        sc.left = -viewHalfWidth - margin;
        sc.right = viewHalfWidth + margin;
        sc.top = viewHalfHeight + margin;
        sc.bottom = -viewHalfHeight - margin;
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
      // A block was placed
      AudioPlayer.playThud(0.6, 70);

      // If it was a perfect placement (combo increased), play chime
      // We don't have combo in this prop; approximate by checking last two blocks x align
      const last = gameState.blocks[gameState.blocks.length - 1];
      const below = gameState.blocks[gameState.blocks.length - 2];
      if (last && below && Math.abs(last.x - below.x) < 500) {
        AudioPlayer.playChime(0.2, 1200 + Math.random() * 200);
        // small camera bump
        shakeRef.current.intensity = 1.0;
        shakeRef.current.time = 0;
      }
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
      const margin = 1.0; // extra world units above/below
      const desiredHalfHeight = Math.max(2, (maxY - minY) / 2 + margin);

      const viewSpan = (cam.top - cam.bottom); // in camera units
      const targetZoom = viewSpan / (2 * desiredHalfHeight);

      const centerY = (minY + maxY) / 2;

      gameOverZoomRef.current = {
        active: true,
        start: typeof performance !== 'undefined' ? performance.now() : Date.now(),
        duration: 1000,
        startZoom: cam.zoom || 36,
        targetZoom: targetZoom,
        startBaseY: cameraBaseRef.current.y,
        targetBaseY: centerY,
        startLookY: lookAtTargetRef.current.y,
        targetLookY: centerY,
      };
    }
  }, [gameState && gameState.isGameOver, computeTowerBounds]);

  // Reset camera on new game start
  React.useEffect(() => {
    if (!gameState || !cameraRef.current) return;
    const cam = cameraRef.current;
    // Heuristic: when blocks reset to <=1 and not game over, treat as new game
    if (!gameState.isGameOver && gameState.blocks.length <= 1) {
      gameOverZoomRef.current.active = false;
      // restore defaults
      cam.zoom = 36;
      cam.updateProjectionMatrix();
      cameraBaseRef.current.y = 32;
      cameraBaseRef.current.z = 6;
      // Reset horizontal tracking to origin as well
      lookAtTargetRef.current.x = 0;
      cameraBaseRef.current.x = cameraOffsetXRef.current;
      lookAtTargetRef.current.y = 0;
      musicStageRef.current = 'start';
      shakeRef.current.intensity = 0;
      shakeRef.current.time = 0;
    }
  }, [gameState && gameState.blocks.length, gameState && gameState.isGameOver]);

  // Debug keyboard shortcuts to exercise music transitions: T=transition, C=crescendo, G=gameOverReturn
  React.useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key.toLowerCase() === 't') MusicManager.transitionToSection();
      if (e.key.toLowerCase() === 'c') MusicManager.crescendo();
      if (e.key.toLowerCase() === 'g') MusicManager.gameOverReturn();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  return (
    <>

      <OrthographicCamera
        ref={cameraRef}
        makeDefault
        zoom={36}
        position={[10, 15, 6]}
        near={0.1}
        far={1000}
      />

      {/* Environment and lighting to support PBR materials */}
      <hemisphereLight color={0xcceeff} groundColor={0x222233} intensity={0.5} />
      <directionalLight
        ref={mainLightRef}
        castShadow={true}
        // initial position will be overridden by useFrame alignment
        position={[3, 18, 6]}
        intensity={1.0}
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
      {/* Subtle rim fill */}
      <pointLight position={[-2, 3, -3]} intensity={0.25} castShadow={false} />

      {/* Lighting */}
      <ambientLight intensity={0.45} />
      <directionalLight position={[-8, 8, -6]} intensity={0.45} castShadow={false} />

      {/* Postprocessing effects (bloom for emissive outlines) */}
      <EffectsRenderer />

      {/* Floating ambient particles that react to placed blocks - rendered inside the blocks group below */}

      {/* Axes helper to show coordinate orientation: X=red, Y=green, Z=blue */}
      {/* <primitive ref={axesRef} object={new THREE.AxesHelper(2)} position={[10, 10, 0]} /> */}

      {/* Render all blocks */}
      <group>
        {/* No ghost stack: initial real blocks are seeded in simulation */}

        {gameState && gameState.blocks.map((block, index) => {
          const isNewTop = gameState.blocks.length > prevBlocksRef.current && index === gameState.blocks.length - 1;
          const spawnFrom = isNewTop ? lastActivePosRef.current ?? undefined : undefined;
          return (
            <GameBlock
              key={`block-${index}`}
              block={block}
              isActive={false}
              convertPosition={convertPosition}
              spawnFrom={spawnFrom}
            />
          );
        })}

        {/* Current moving block */}
        {gameState && gameState.currentBlock && (() => {
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
            />
          );
        })()}
        {/* Place floating particles in the same group as blocks so they align with the stack */}
        <FloatingParticles gameState={gameState} convertPosition={convertPosition} />
      </group>

      {/* Vaporize trimmed pieces */}
      {gameState && (
        <TrimEffects trimEffects={gameState.recentTrimEffects} convertPosition={convertPosition} currentTick={gameState.tick} />
      )}

      {/* Simple base platform */}
      <mesh position={[0, -0.1, 0]} receiveShadow>
        <boxGeometry args={[6, 0.2, 3]} />
        <meshStandardMaterial color="#666" />
      </mesh>

      {/* Simple background */}
      {/* <mesh position={[0, 0, -5]} receiveShadow>
        <planeGeometry args={[20, 20]} />
        <meshBasicMaterial color="#1a2036" />
      </mesh> */}
    </>
  );
};
