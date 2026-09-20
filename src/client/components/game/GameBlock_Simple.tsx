import React, { useRef, useEffect, useLayoutEffect, useMemo } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { Block } from '../../../shared/simulation';
import type { FactionTheme } from '../../constants/factions';
import { attachBodyFlash, attachRimFlash, createFlashUniforms } from './blockFlash';

export interface PerfectEdgeCascadeEvent {
  key: number;
  start: number;
  tier: number;
  totalBlocks: number;
}

interface GameBlockProps {
  block: Block;
  isActive: boolean;
  convertPosition: (fixedValue: number) => number;
  highlight?: 'perfect' | 'cut' | null;
  spawnFrom?: { x: number; y: number; z: number } | undefined;
  color?: string; // optional externally provided color
  blockIndex?: number; // index in tower for color progression
  enableDebugWireframe?: boolean; // debug wireframe mode
  combo?: number; // current combo streak for color determination
  lastPlacement?:
    | {
        isPositionPerfect: boolean;
        noTrim: boolean;
        comboAfter: number;
      }
    | null
    | undefined;
  perfectEdgeEvent?: PerfectEdgeCascadeEvent | null;
  playerTheme?: FactionTheme | null | undefined;
  /** Set on the block that just landed: it flashes and squashes into place. */
  landed?: { at: number; perfect: boolean } | undefined;
}

const WHITE = new THREE.Color('#ffffff');

/**
 * Peak emissive a landing adds at the seam, before the gradient falls it off toward the top
 * face. A perfect is worth roughly twice a plain landing, and both are well past the bloom
 * threshold at the seam while leaving the top face the block's own colour.
 */
const LANDING_FLASH = 0.8;
const LANDING_FLASH_PERFECT = 1.6;
/** Peak the chain wave adds as it passes a block, per unit of its own glow curve. */
const CASCADE_FLASH = 0.42;

export const GameBlock: React.FC<GameBlockProps> = ({
  block,
  isActive,
  convertPosition,
  highlight: _highlight = null,
  spawnFrom,
  color,
  blockIndex = 0,
  enableDebugWireframe = false,
  combo = 0,
  lastPlacement = null,
  perfectEdgeEvent = null,
  playerTheme = null,
  landed,
}) => {
  // Convert block properties to Three.js units
  const targetPosition = {
    x: convertPosition(block.x),
    y: convertPosition(block.y + block.height / 2), // Center the block on its position
    z: convertPosition(block.z ?? 0),
  };

  // Keep depth stable and based on block height (not width) so trimmed widths
  // don't visually squash the block on the Z axis. Use a constant multiplier
  // so blocks remain visually consistent regardless of width trimming.
  const blockWidth = convertPosition(block.width);
  const blockHeight = convertPosition(block.height);
  const depth = Math.max(0.4, convertPosition(block.depth ?? block.width));

  const width = blockWidth;
  const height = blockHeight;
  const size: [number, number, number] = [width, height, depth];

  // Convert fixed-point rotation (millidegrees) to radians
  const rotationY = (block.rotation / 1000) * (Math.PI / 180); // millidegrees to radians

  // Refs for smooth interpolation and bounce on placement
  const groupRef = useRef<THREE.Group | null>(null);
  const meshRef = useRef<THREE.Mesh<THREE.BoxGeometry, THREE.MeshStandardMaterial> | null>(null);
  const activeOutlineRef = useRef<THREE.Mesh<THREE.BoxGeometry, THREE.MeshBasicMaterial> | null>(
    null
  );
  const prevFallingRef = useRef<boolean | undefined>(undefined);
  const bounceRef = useRef<{ time: number; intensity: number }>({ time: 0, intensity: 0 });
  const cascadeStateRef = useRef<{
    startSeconds: number;
    delay: number;
    duration: number;
    tier: number;
  } | null>(null);
  const animationActiveRef = useRef<boolean>(true);

  const geometry = useMemo<THREE.BoxGeometry>(() => {
    return new THREE.BoxGeometry(width, height, depth);
  }, [width, height, depth]);

  const edgesGeometry = useMemo<THREE.EdgesGeometry>(() => {
    const baseGeometry = new THREE.BoxGeometry(width, height, depth);
    const geom = new THREE.EdgesGeometry(baseGeometry);
    baseGeometry.dispose();
    return geom;
  }, [width, height, depth]);

  useEffect(() => {
    return () => {
      geometry.dispose();
    };
  }, [geometry]);

  useEffect(() => {
    return () => {
      edgesGeometry.dispose();
    };
  }, [edgesGeometry]);

  // One set of flash uniforms per block, shared by its body and its rim so a single number per
  // frame drives both. The gradient itself lives in the shader; see blockFlash.
  const flashUniforms = useMemo(() => createFlashUniforms(), []);

  const bodyMaterial = useMemo<THREE.MeshStandardMaterial>(() => {
    const material = new THREE.MeshStandardMaterial({
      color: '#1a1a2e',
      roughness: 0.3,
      metalness: 0.7,
      emissive: '#00f2fe',
      emissiveIntensity: 0.3,
      toneMapped: false,
    });
    attachBodyFlash(material, flashUniforms);
    return material;
  }, [flashUniforms]);

  const rimMaterial = useMemo<THREE.LineBasicMaterial>(() => {
    const material = new THREE.LineBasicMaterial({
      color: '#00f2fe',
      opacity: 1,
      transparent: true,
      toneMapped: false,
    });
    attachRimFlash(material, flashUniforms);
    return material;
  }, [flashUniforms]);

  useEffect(() => {
    return () => {
      bodyMaterial.dispose();
      rimMaterial.dispose();
    };
  }, [bodyMaterial, rimMaterial]);

  // The gradient is computed from local Y, so it needs the block's height in world units.
  useLayoutEffect(() => {
    flashUniforms.uFlashHeight.value = Math.max(height, 0.0001);
  }, [flashUniforms, height]);

  // TRON: Legacy color system based on performance
  const accentColor = playerTheme?.accentHex ?? '#00f2fe';
  const accentSecondary = playerTheme?.accentSecondaryHex ?? '#00f2fe';
  const baseBlockColor = playerTheme?.blockBaseHex ?? '#0a0a0a';
  const emissiveBase = playerTheme?.blockEmissiveHex ?? accentColor;

  const tronColors = useMemo(() => {
    // Check if we have a perfect streak (combo > 0 and last placement was perfect)
    const hasPerfectStreak = combo > 0 && lastPlacement?.isPositionPerfect;

    // Check if last placement was a misplacement (broke combo)
    if (hasPerfectStreak) {
      // Cyan for perfect streaks
      return {
        baseColor: baseBlockColor,
        edgeColor: accentSecondary,
        emissiveColor: accentSecondary,
        emissiveIntensity: 0.3,
      };
    } else {
      // Default dark with subtle cyan
      return {
        baseColor: baseBlockColor,
        edgeColor: accentColor,
        emissiveColor: emissiveBase,
        emissiveIntensity: 0.1,
      };
    }
  }, [
    accentColor,
    accentSecondary,
    baseBlockColor,
    emissiveBase,
    combo,
    lastPlacement?.isPositionPerfect,
  ]);

  // Initialize position from spawn point (if provided) so newly-placed blocks
  // visually originate from the moving block and animate into their final spot.
  React.useEffect(() => {
    const g = groupRef.current;
    if (!g) return;
    if (spawnFrom) {
      g.position.x = spawnFrom.x;
      g.position.y = spawnFrom.y;
      g.position.z = spawnFrom.z;
      animationActiveRef.current = true;
    } else {
      // If no spawnFrom provided and this is an active block, position it at the target immediately
      if (isActive) {
        g.position.x = targetPosition.x;
        g.position.y = targetPosition.y;
        g.position.z = targetPosition.z;
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [spawnFrom]);

  // Detect transition from falling -> placed to trigger bounce
  useEffect(() => {
    if (isActive) {
      prevFallingRef.current = !!block.isFalling;
      bounceRef.current.time = 0;
      bounceRef.current.intensity = 0;
      return;
    }

    if (prevFallingRef.current === undefined) {
      prevFallingRef.current = !!block.isFalling;
      return;
    }
    if (prevFallingRef.current && !block.isFalling) {
      bounceRef.current.time = 0;
      bounceRef.current.intensity = 0.12; // small placement bounce
      animationActiveRef.current = true;
    }
    prevFallingRef.current = !!block.isFalling;
  }, [block.isFalling, isActive]);

  // Update material colors based on TRON: Legacy system. Before paint, so a block that spawns
  // this frame is never drawn in the material's placeholder colour first.
  useLayoutEffect(() => {
    const activeOutline = activeOutlineRef.current;

    const blockFillColor = color ?? tronColors.baseColor;
    bodyMaterial.color.set(new THREE.Color(blockFillColor));
    bodyMaterial.emissive.set(new THREE.Color(tronColors.emissiveColor));
    bodyMaterial.emissiveIntensity = tronColors.emissiveIntensity;
    bodyMaterial.roughness = 0.2;
    bodyMaterial.metalness = 0.65;
    bodyMaterial.needsUpdate = true;

    // The rim follows the body colour when one is given: a streak's blocks share one colour,
    // and on the relay tower every block keeps the colour of whoever laid it.
    const edgeColor = new THREE.Color(color ?? tronColors.edgeColor);
    rimMaterial.color.copy(edgeColor);

    // The flash burns the block's own colour pushed most of the way to white, so the seam reads
    // hot without the block losing whose tower it is.
    flashUniforms.uFlashColor.value.copy(edgeColor).lerp(WHITE, 0.6);

    if (activeOutline && activeOutline.material && 'color' in activeOutline.material) {
      (activeOutline.material as THREE.MeshBasicMaterial).color.set(
        new THREE.Color(tronColors.edgeColor)
      );
    }
  }, [blockIndex, isActive, color, tronColors, bodyMaterial, rimMaterial, flashUniforms]);

  useEffect(() => {
    if (!perfectEdgeEvent || isActive) {
      return;
    }
    if (!perfectEdgeEvent.totalBlocks) {
      return;
    }
    const stepsFromTop = perfectEdgeEvent.totalBlocks - 1 - blockIndex;
    if (stepsFromTop < 0) {
      return;
    }

    const delayPerBlock = 0.06;
    const durationBase = 0.9;
    const durationPerBlock = 0.05;
    const startSeconds = perfectEdgeEvent.start / 1000;

    cascadeStateRef.current = {
      startSeconds,
      delay: stepsFromTop * delayPerBlock,
      duration: durationBase + stepsFromTop * durationPerBlock,
      tier: perfectEdgeEvent.tier ?? 0,
    };
    animationActiveRef.current = true;
  }, [perfectEdgeEvent, blockIndex, isActive]);

  useEffect(() => {
    animationActiveRef.current = true;
  }, [targetPosition.x, targetPosition.y, targetPosition.z, rotationY, isActive]);

  useEffect(() => {
    if (landed) animationActiveRef.current = true;
  }, [landed]);

  // Smoothly interpolate position and rotation each frame
  useFrame((_, delta) => {
    const g = groupRef.current;
    if (!g) return;

    if (!isActive && !animationActiveRef.current) {
      return;
    }

    const normalizedDelta = Math.min(Math.max(delta, 0), 0.08); // clamp huge frame gaps
    const frameFactor = Math.max(1, normalizedDelta * 60);
    const baseHorizontalSpeed = block.isFalling ? 0.98 : 0.45;
    const baseVerticalSpeed = block.isFalling ? 0.96 : 0.6;
    const baseRotationSpeed = block.isFalling ? 0.95 : 0.5;
    const lerp = 1 - Math.pow(1 - baseHorizontalSpeed, frameFactor);
    const lerpY = 1 - Math.pow(1 - baseVerticalSpeed, frameFactor);
    const lerpRot = 1 - Math.pow(1 - baseRotationSpeed, frameFactor);

    // Interpolate position
    g.position.x += (targetPosition.x - g.position.x) * lerp;
    g.position.y += (targetPosition.y - g.position.y) * lerpY;
    g.position.z += (targetPosition.z - g.position.z) * lerp;

    // Interpolate rotation Y smoothly
    const rotTarget = rotationY;
    g.rotation.y += (rotTarget - g.rotation.y) * lerpRot;

    // Apply placement bounce if active
    if (!isActive && bounceRef.current.intensity > 0) {
      bounceRef.current.time += delta * 3.5; // speed up the bounce timeline
      const t = bounceRef.current.time;
      const intensity = bounceRef.current.intensity * Math.max(0, 1 - t);
      // simple ease-out sine bounce
      const offset = Math.sin(Math.min(1, t) * Math.PI) * intensity * 0.6;
      g.position.y += offset;
      if (t >= 1) {
        bounceRef.current.intensity = 0;
        bounceRef.current.time = 0;
      }
    }

    const cascade = cascadeStateRef.current;
    const cascadeActive = !!cascade;

    // Two things light a block -- the landing itself and the chain wave that runs down the
    // tower behind it -- and both feed the one gradient, brightest at the seam. Adding them
    // here rather than writing the material twice keeps a landing inside a chain from stacking
    // two full-strength flashes on the same block.
    let flash = 0;
    let rimFlash = 0;

    // Landing: the block squashes flat on impact and springs back, and the seam flares.
    // The whole thing is a quarter of a second; a perfect hits harder.
    let landing = false;
    if (landed && !isActive) {
      const t = (performance.now() - landed.at) / (landed.perfect ? 320 : 240);
      if (t >= 0 && t < 1) {
        landing = true;
        const amp = landed.perfect ? 0.34 : 0.22;
        // Damped spring: squashed first, overshooting past 1, settling.
        const spring = 1 - amp * Math.exp(-t * 5.5) * Math.cos(t * Math.PI * 3.2);
        g.scale.set(1 + (1 - spring) * 0.6, spring, 1 + (1 - spring) * 0.6);
        flash +=
          Math.max(0, 1 - t * 1.4) * (landed.perfect ? LANDING_FLASH_PERFECT : LANDING_FLASH);
        rimFlash += Math.max(0, 1 - t * 1.6);
      } else if (t >= 1 && g.scale.y !== 1) {
        g.scale.set(1, 1, 1);
      }
    }

    if (cascade) {
      const nowSeconds =
        (typeof performance !== 'undefined' ? performance.now() : Date.now()) / 1000;
      const localTime = nowSeconds - cascade.startSeconds - cascade.delay;

      if (localTime >= cascade.duration) {
        cascadeStateRef.current = null;
      } else if (localTime >= 0) {
        const progress = Math.max(0, Math.min(1, localTime / cascade.duration));
        const strength = Math.sin(progress * Math.PI);
        const tierBoost = Math.min(0.9, cascade.tier * 0.05);
        const glow = (1 - progress) * (1.3 + tierBoost) * strength;

        flash += glow * CASCADE_FLASH;
        rimFlash += glow * 0.22;
      }
    }

    flashUniforms.uFlash.value = flash;
    flashUniforms.uRimFlash.value = Math.min(1, rimFlash);

    const positionDelta =
      Math.abs(targetPosition.x - g.position.x) +
      Math.abs(targetPosition.y - g.position.y) +
      Math.abs(targetPosition.z - g.position.z);
    const rotationDelta = Math.abs(rotationY - g.rotation.y);
    const bounceActive = bounceRef.current.intensity > 0;

    if (
      !isActive &&
      !cascadeActive &&
      !bounceActive &&
      !landing &&
      positionDelta < 0.0008 &&
      rotationDelta < 0.0004
    ) {
      g.position.set(targetPosition.x, targetPosition.y, targetPosition.z);
      g.rotation.y = rotationY;
      animationActiveRef.current = false;
    }
  });
  return (
    <group ref={groupRef} rotation={[0, rotationY, 0]}>
      {/* Dark solid block */}
      <mesh
        ref={meshRef}
        castShadow={false}
        receiveShadow={false}
        geometry={geometry}
        material={bodyMaterial}
      />

      {/* TRON: Legacy glowing edges */}
      <lineSegments geometry={edgesGeometry} material={rimMaterial} />

      {isActive && (
        <mesh
          ref={activeOutlineRef}
          scale={1.05}
          renderOrder={999}
          castShadow={false}
          receiveShadow={false}
        >
          <boxGeometry args={size} />
          <meshBasicMaterial
            color="#00f2fe"
            toneMapped={false}
            transparent
            opacity={0.3}
            side={2}
          />
        </mesh>
      )}

      {/* Debug wireframe overlay */}
      {enableDebugWireframe && (
        <group>
          {/* Main wireframe outline */}
          <mesh geometry={geometry}>
            <meshBasicMaterial color="#00ff00" wireframe={true} transparent={true} opacity={0.8} />
          </mesh>

          {/* Corner markers */}
          {[
            // Bottom corners
            [-size[0] / 2, -size[1] / 2, -size[2] / 2],
            [size[0] / 2, -size[1] / 2, -size[2] / 2],
            [-size[0] / 2, -size[1] / 2, size[2] / 2],
            [size[0] / 2, -size[1] / 2, size[2] / 2],
            // Top corners
            [-size[0] / 2, size[1] / 2, -size[2] / 2],
            [size[0] / 2, size[1] / 2, -size[2] / 2],
            [-size[0] / 2, size[1] / 2, size[2] / 2],
            [size[0] / 2, size[1] / 2, size[2] / 2],
          ].map((pos, cornerIndex) => (
            <mesh key={cornerIndex} position={pos as [number, number, number]}>
              <sphereGeometry args={[0.05, 8, 8]} />
              <meshBasicMaterial color="#ff0000" />
            </mesh>
          ))}

          {/* Center marker */}
          <mesh>
            <sphereGeometry args={[0.08, 8, 8]} />
            <meshBasicMaterial color="#0000ff" />
          </mesh>

          {/* Block index text using a simple plane */}
          <mesh position={[0, size[1] / 2 + 0.2, 0]} rotation={[-Math.PI / 2, 0, 0]}>
            <planeGeometry args={[0.5, 0.3]} />
            <meshBasicMaterial color="#ffffff" transparent={true} opacity={0.9} />
          </mesh>
        </group>
      )}
    </group>
  );
};

// Memoize GameBlock to prevent unnecessary re-renders
// Only re-render if block reference, active state, or visual props change
export const GameBlockMemo = React.memo(GameBlock, (prevProps, nextProps) => {
  // If block reference is the same, no re-render needed (biggest optimization)
  if (
    prevProps.block === nextProps.block &&
    prevProps.isActive === nextProps.isActive &&
    prevProps.color === nextProps.color &&
    prevProps.combo === nextProps.combo &&
    prevProps.blockIndex === nextProps.blockIndex &&
    prevProps.enableDebugWireframe === nextProps.enableDebugWireframe &&
    prevProps.perfectEdgeEvent === nextProps.perfectEdgeEvent
  ) {
    return true; // Props are equal, skip re-render
  }

  return false; // Props changed, re-render
});
