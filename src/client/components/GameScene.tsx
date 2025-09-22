import React, { useRef, useMemo, useState } from 'react';
import { useFrame } from '@react-three/fiber';
import { OrthographicCamera } from '@react-three/drei';
import * as THREE from 'three';
import { GameState, FixedMath } from '../../shared/simulation';
import { GameBlock } from './GameBlock';
import { DropParticles, PerfectDropEffects } from './ParticleEffects';
import { TrimEffects } from './TrimEffects';
import { AmbientParticles } from './AmbientParticles';
import { PerfectPlacementGlow } from './PerfectPlacementGlow';
import { SlicingEffect } from './SlicingEffect';

interface GameSceneProps {
  gameState: GameState | null;
  onTimeScale?: (scale: number) => void;
}

const CameraController: React.FC<{ gameState: GameState | null }> = ({ gameState }) => {
  const cameraRef = useRef<THREE.OrthographicCamera>(null);
  const shakeRef = useRef<{ intensity: number; duration: number; elapsed: number }>({
    intensity: 0,
    duration: 0,
    elapsed: 0
  });
  const basePosition = useRef<THREE.Vector3>(new THREE.Vector3(4, 6, 4));

  // Function to trigger camera shake
  const _triggerShake = (intensity: number, duration: number) => {
    shakeRef.current = { intensity, duration, elapsed: 0 };
  };
  // Mark as used for now to avoid TS unused warnings (will be used by effects)
  void _triggerShake;

  useFrame((_, delta) => {
    if (!cameraRef.current) return;

    // Handle camera shake
    if (shakeRef.current.intensity > 0) {
      shakeRef.current.elapsed += delta;

      if (shakeRef.current.elapsed >= shakeRef.current.duration) {
        // Reset to base position
        cameraRef.current.position.copy(basePosition.current);
        shakeRef.current.intensity = 0;
      } else {
        // Apply shake offset
        const progress = shakeRef.current.elapsed / shakeRef.current.duration;
        const currentIntensity = shakeRef.current.intensity * (1 - progress);

        const shakeX = (Math.random() - 0.5) * currentIntensity;
        const shakeY = (Math.random() - 0.5) * currentIntensity * 0.5; // Less vertical shake
        const shakeZ = (Math.random() - 0.5) * currentIntensity;

        cameraRef.current.position.set(
          basePosition.current.x + shakeX,
          basePosition.current.y + shakeY,
          basePosition.current.z + shakeZ
        );
      }
    } else if (gameState && gameState.blocks.length > 0) {
      // Normal smooth following behavior
      const towerHeight = Math.max(...gameState.blocks.map(block =>
        FixedMath.toFloat(block.y + block.height)
      ));
      const towerCenterY = towerHeight / 2;

      const targetY = Math.max(5, towerCenterY + 2);
      const currentY = cameraRef.current.position.y;
      const smoothY = THREE.MathUtils.lerp(currentY, targetY, 0.03);

      // Update base position for shake reference
      basePosition.current.setY(smoothY);
      cameraRef.current.position.setY(smoothY);

      // Dynamic zoom adjusted for smaller blocks
      const baseZoom = 50;
      const heightFactor = Math.min(2, Math.max(0.5, towerHeight / 8));
      const targetZoom = baseZoom / heightFactor;
      const currentZoom = cameraRef.current.zoom;
      const smoothZoom = THREE.MathUtils.lerp(currentZoom, targetZoom, 0.02);

      cameraRef.current.zoom = smoothZoom;
      cameraRef.current.updateProjectionMatrix();
    }
  });

  return (
    <OrthographicCamera
      ref={cameraRef}
      makeDefault
      zoom={60}
      position={[4, 6, 4]}
      lookAt={[0, 2, 0]}
      left={-8}
      right={8}
      top={12}
      bottom={-4}
      near={0.1}
      far={1000}
    />
  );
};

export const GameScene: React.FC<GameSceneProps> = ({ gameState }) => {
  const groupRef = useRef<THREE.Group>(null);

  // Particle effects state
  const [dropParticles, setDropParticles] = useState<{
    active: boolean;
    position: [number, number, number];
  }>({ active: false, position: [0, 0, 0] });

  const [perfectEffect, setPerfectEffect] = useState<{
    active: boolean;
    position: [number, number, number];
  }>({ active: false, position: [0, 0, 0] });

  const [perfectGlow, setPerfectGlow] = useState<{
    active: boolean;
    position: [number, number, number];
    blockWidth: number;
    blockHeight: number;
  }>({
    active: false,
    position: [0, 0, 0],
    blockWidth: 1,
    blockHeight: 1
  });

  const [slicingEffect, setSlicingEffect] = useState<{
    active: boolean;
    position: [number, number, number];
    direction: 'vertical' | 'horizontal';
    blockWidth: number;
    blockHeight: number;
  }>({
    active: false,
    position: [0, 0, 0],
    direction: 'vertical',
    blockWidth: 1,
    blockHeight: 1
  });

  const lastBlockCountRef = useRef<number>(0);

  // Convert fixed-point coordinates to Three.js world coordinates
  const convertPosition = (fixedValue: number): number => {
    return FixedMath.toFloat(fixedValue);
  };

  // Track block drops for particle effects and perfect placement detection
  useFrame(() => {
    if (!gameState) return;

    const currentBlockCount = gameState.blocks.length;

    // Trigger effects when a new block is placed
    if (currentBlockCount > lastBlockCountRef.current && currentBlockCount > 0) {
      const lastBlock = gameState.blocks[currentBlockCount - 1];
      if (lastBlock) {
        const blockPosition: [number, number, number] = [
          convertPosition(lastBlock.x),
          convertPosition(lastBlock.y),
          0,
        ];

        const blockWidth = convertPosition(lastBlock.width);
        const blockHeight = convertPosition(lastBlock.height);

        // Trigger drop particles
        setDropParticles({ active: true, position: blockPosition });

        // Check for perfect drop and trigger appropriate effects
        if (currentBlockCount > 1) {
          const previousBlock = gameState.blocks[currentBlockCount - 2];
          if (previousBlock) {
            const overlap = Math.min(
              FixedMath.toFloat(lastBlock.x + lastBlock.width),
              FixedMath.toFloat(previousBlock.x + previousBlock.width)
            ) - Math.max(
              FixedMath.toFloat(lastBlock.x),
              FixedMath.toFloat(previousBlock.x)
            );

            const perfectThreshold = FixedMath.toFloat(lastBlock.width) * 0.95;
            if (overlap >= perfectThreshold) {
              // Perfect placement - trigger azure glow
              setPerfectGlow({
                active: true,
                position: blockPosition,
                blockWidth,
                blockHeight
              });
              setPerfectEffect({ active: true, position: blockPosition });
            } else if (overlap > 0) {
              // Partial placement - trigger slicing effect
              setSlicingEffect({
                active: true,
                position: [blockPosition[0], blockPosition[1] + blockHeight / 2, blockPosition[2]],
                direction: 'vertical',
                blockWidth,
                blockHeight
              });
            }
          }
        }
      }
    }

    lastBlockCountRef.current = currentBlockCount;
  });

  // Effects for block trimming - memoize to prevent recreation every frame
  const trimEffects = useMemo(() => {
    if (!gameState?.recentTrimEffects) return [];
    return gameState.recentTrimEffects;
  }, [gameState?.recentTrimEffects]);

  if (!gameState) {
    return (
      <>
        <CameraController gameState={null} />
        <ambientLight intensity={0.6} />
        <directionalLight position={[10, 10, 5]} intensity={0.8} />

        {/* Loading state or empty scene */}
        <mesh position={[0, 0, 0]}>
          <boxGeometry args={[0.1, 0.1, 0.1]} />
          <meshStandardMaterial color="#333" />
        </mesh>
      </>
    );
  }

  return (
    <>
      <CameraController gameState={gameState} />

      {/* Enhanced lighting setup for soft photorealistic shadows */}
      <ambientLight intensity={0.4} color="#E8E4DF" />

      {/* Main key light - top-left for subtle highlights and soft shadows */}
      <directionalLight
        position={[8, 12, 6]}
        intensity={1.2}
        color="#FFFFFF"
        castShadow
        shadow-mapSize={[2048, 2048]}
        shadow-camera-left={-20}
        shadow-camera-right={20}
        shadow-camera-top={20}
        shadow-camera-bottom={-20}
        shadow-camera-near={0.1}
        shadow-camera-far={50}
        shadow-bias={-0.0001}
      />

      {/* Fill light for reducing harsh shadows */}
      <directionalLight
        position={[-5, 8, -5]}
        intensity={0.3}
        color="#B8C5D9"
      />

      {/* Rim light for edge definition */}
      <pointLight
        position={[0, 15, 8]}
        intensity={0.4}
        color="#F0F8FF"
        distance={30}
        decay={2}
      />

      {/* Game blocks */}
      <group ref={groupRef}>
        {gameState.blocks.map((block, index) => (
          <GameBlock
            key={`${block.x}-${block.y}-${index}`}
            block={block}
            isActive={gameState.currentBlock?.x === block.x && gameState.currentBlock?.y === block.y}
            convertPosition={convertPosition}
          />
        ))}

        {/* Current block if it exists */}
        {gameState.currentBlock && (
          <GameBlock
            key="current-block"
            block={gameState.currentBlock}
            isActive={true}
            convertPosition={convertPosition}
          />
        )}
      </group>

      {/* Trim effects */}
      <TrimEffects
        trimEffects={trimEffects}
        convertPosition={convertPosition}
        currentTick={gameState.tick}
      />

      {/* Particle effects */}
      {dropParticles.active && (
        <DropParticles
          active={true}
          position={dropParticles.position}
          onComplete={() => setDropParticles({ active: false, position: [0, 0, 0] })}
        />
      )}

      {perfectEffect.active && (
        <PerfectDropEffects
          active={true}
          position={perfectEffect.position}
          onComplete={() => setPerfectEffect({ active: false, position: [0, 0, 0] })}
        />
      )}

      {/* Perfect placement azure glow */}
      {perfectGlow.active && (
        <PerfectPlacementGlow
          active={true}
          contactPosition={perfectGlow.position}
          blockWidth={perfectGlow.blockWidth}
          blockHeight={perfectGlow.blockHeight}
          onComplete={() => setPerfectGlow({
            active: false,
            position: [0, 0, 0],
            blockWidth: 1,
            blockHeight: 1
          })}
        />
      )}

      {/* Slicing effect for partial placements */}
      {slicingEffect.active && (
        <SlicingEffect
          active={true}
          cutPosition={slicingEffect.position}
          cutDirection={slicingEffect.direction}
          blockWidth={slicingEffect.blockWidth}
          blockHeight={slicingEffect.blockHeight}
          onComplete={() => setSlicingEffect({
            active: false,
            position: [0, 0, 0],
            direction: 'vertical',
            blockWidth: 1,
            blockHeight: 1
          })}
        />
      )}

      {/* Ambient particles for atmosphere */}
      <AmbientParticles />

      {/* Enhanced background with radial gradient */}
      <mesh position={[0, 0, -8]} rotation={[0, 0, 0]}>
        <planeGeometry args={[60, 60]} />
        <meshBasicMaterial>
          <canvasTexture
            attach="map"
            image={(() => {
              const canvas = document.createElement('canvas');
              canvas.width = 512;
              canvas.height = 512;
              const ctx = canvas.getContext('2d')!;

              // Create radial gradient
              const gradient = ctx.createRadialGradient(
                256, 380, 0,    // Inner circle (tower base area)
                256, 380, 300  // Outer circle
              );

              gradient.addColorStop(0, '#202A46');    // Brighter center
              gradient.addColorStop(0.6, '#1A2036');  // Mockup base color
              gradient.addColorStop(1, '#141B2A');    // Darker edges

              ctx.fillStyle = gradient;
              ctx.fillRect(0, 0, 512, 512);

              return canvas;
            })()}
          />
        </meshBasicMaterial>
      </mesh>

      {/* Game boundaries visualization - scaled for new dimensions */}
      <group>
        {/* Left wall */}
        <mesh position={[-2.1, 0, 0]}>
          <boxGeometry args={[0.1, 20, 0.1]} />
          <meshStandardMaterial color="#333" transparent opacity={0.3} />
        </mesh>

        {/* Right wall */}
        <mesh position={[2.1, 0, 0]}>
          <boxGeometry args={[0.1, 20, 0.1]} />
          <meshStandardMaterial color="#333" transparent opacity={0.3} />
        </mesh>

        {/* Base platform */}
        <mesh position={[0, -0.5, 0]}>
          <boxGeometry args={[4.4, 0.1, 2]} />
          <meshStandardMaterial color="#444" />
        </mesh>
      </group>
    </>
  );
};
