import React, { useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { OrthographicCamera } from '@react-three/drei';
import * as THREE from 'three';
import { AudioPlayer } from './AudioPlayer';
import { GameState, FixedMath } from '../../shared/simulation';
import { GameBlock } from './GameBlock_Simple';
import { EffectsRenderer } from './EffectsRenderer';
import { VaporParticles } from './VaporParticles';

interface GameSceneProps {
  gameState: GameState | null;
  onTimeScale?: (scale: number) => void;
}

export const GameScene: React.FC<GameSceneProps> = ({ gameState }) => {
  const cameraRef = useRef<THREE.OrthographicCamera>(null);
  useThree();

  const prevBlocksRef = useRef<number>(0);
  const shakeRef = useRef({ intensity: 0, time: 0 });
  const cameraBaseRef = useRef({ x: 6, y: 20, z: 6 });
  const lookAtTargetRef = useRef({ x: 0, y: 0, z: 0 });

  // Convert fixed-point coordinates to Three.js world coordinates
  const convertPosition = (fixedValue: number): number => {
    return FixedMath.toFloat(fixedValue);
  };

  // Controlled cinematic follow: small vertical adjustment, fixed distance
  useFrame(() => {
    if (cameraRef.current && gameState && gameState.blocks.length > 0) {
      // Use the last placed block (top of the stack) as the focus target
      const topBlock = gameState.blocks[gameState.blocks.length - 1];
      if (!topBlock) return;
      const topY = FixedMath.toFloat(topBlock.y + topBlock.height / 2);

      // Higher base offset for a better orthographic composition
      const desiredBaseY = topY + 2.4; // raised offset
      const desiredBaseZ = 6.0;

      // Smoothly update the camera base (this is the stable camera position without shake)
      cameraBaseRef.current.y += (desiredBaseY - cameraBaseRef.current.y) * 0.08;
      cameraBaseRef.current.z += (desiredBaseZ - cameraBaseRef.current.z) * 0.06;

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

      // Look at the current moving block center Y if present, otherwise fallback to top surface
      const desiredTargetY = FixedMath.toFloat(topBlock.y + topBlock.height);

      // Lerp the lookAt target for smooth camera motion
      lookAtTargetRef.current.y += (desiredTargetY - lookAtTargetRef.current.y) * 0.12;
      const lookAtVec = new THREE.Vector3(0, lookAtTargetRef.current.y, 0);
      cameraRef.current.lookAt(lookAtVec);
      cameraRef.current.updateProjectionMatrix();
    }
  });

  // Audio feedback: whoosh while falling, thunk/chime on placement
  React.useEffect(() => {
    if (!gameState) return;

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
        castShadow
        position={[3, 6, 2]}
        intensity={1.0}
        shadow-mapSize-width={1024}
        shadow-mapSize-height={1024}
      />
      {/* Subtle rim fill */}
      <pointLight position={[-2, 3, -3]} intensity={0.25} />

      {/* Lighting */}
      <ambientLight intensity={0.6} />
      <directionalLight position={[-5, 5, 5]} intensity={0.8} />

      {/* Postprocessing effects (bloom for emissive outlines) */}
      <EffectsRenderer />

      {/* Render all blocks */}
      <group>
        {gameState && gameState.blocks.map((block, index) => (
          <GameBlock
            key={`block-${index}`}
            block={block}
            isActive={false}
            convertPosition={convertPosition}
          />
        ))}

        {/* Current moving block */}
        {gameState && gameState.currentBlock && (
          <GameBlock
            key="current-block"
            block={gameState.currentBlock}
            isActive={true}
            convertPosition={convertPosition}
          />
        )}
      </group>

      {/* Vaporize trimmed pieces */}
      {gameState && (
        <VaporParticles trimEffects={gameState.recentTrimEffects} convertPosition={convertPosition} currentTick={gameState.tick} />
      )}

      {/* Simple base platform */}
      <mesh position={[0, -0.1, 0]}>
        <boxGeometry args={[6, 0.2, 3]} />
        <meshStandardMaterial color="#666" />
      </mesh>

      {/* Simple background */}
      <mesh position={[0, 0, -5]}>
        <planeGeometry args={[20, 20]} />
        <meshBasicMaterial color="#1a2036" />
      </mesh>
    </>
  );
};
