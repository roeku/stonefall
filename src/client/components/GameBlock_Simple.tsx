import React, { useRef, useEffect, useMemo } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { Block } from '../../shared/simulation';

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
  lastPlacement?: {
    isPositionPerfect: boolean;
    noTrim: boolean;
    comboAfter: number;
  } | null | undefined;
  perfectEdgeEvent?: PerfectEdgeCascadeEvent | null;
}

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
  perfectEdgeEvent = null
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
  const activeOutlineRef = useRef<THREE.Mesh<THREE.BoxGeometry, THREE.MeshBasicMaterial> | null>(null);
  const prevFallingRef = useRef<boolean | undefined>(undefined);
  const bounceRef = useRef<{ time: number; intensity: number }>({ time: 0, intensity: 0 });
  const edgeMaterialRef = useRef<THREE.LineBasicMaterial | null>(null);
  const baseEdgeColorRef = useRef(new THREE.Color('#00f2fe'));
  const baseEdgeOpacityRef = useRef(1);
  const baseEmissiveIntensityRef = useRef(0.1);
  const cascadeStateRef = useRef<{ startSeconds: number; delay: number; duration: number; tier: number } | null>(null);
  const tempColorRef = useRef(new THREE.Color());
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

  // TRON: Legacy color system based on performance
  const tronColors = useMemo(() => {
    // Check if we have a perfect streak (combo > 0 and last placement was perfect)
    const hasPerfectStreak = combo > 0 && lastPlacement?.isPositionPerfect;

    // Check if last placement was a misplacement (broke combo)
    if (hasPerfectStreak) {
      // Cyan for perfect streaks
      return {
        baseColor: '#0a0a0a',
        edgeColor: '#00f2fe',
        emissiveColor: '#00f2fe',
        emissiveIntensity: 0.3
      };
    } else {
      // Default dark with subtle cyan
      return {
        baseColor: '#0a0a0a',
        edgeColor: '#00f2fe',
        emissiveColor: '#00f2fe',
        emissiveIntensity: 0.1
      };
    }
  }, [combo, lastPlacement?.isPositionPerfect]);

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

  // Update material colors based on TRON: Legacy system
  useEffect(() => {
    const mesh = meshRef.current;

    if (!mesh || !mesh.material) return;

    const meshMaterial = mesh.material instanceof THREE.MeshPhysicalMaterial
      ? mesh.material
      : null;

    if (!meshMaterial) {
      return;
    }

    if (color) {
      // Use externally provided color (from GameScene gradient system)
      meshMaterial.color.set(new THREE.Color(color));
      if (edgeMaterialRef.current) {
        const edgeColor = new THREE.Color(color);
        edgeMaterialRef.current.color.copy(edgeColor);
        baseEdgeColorRef.current.copy(edgeColor);
        baseEdgeOpacityRef.current = edgeMaterialRef.current.opacity ?? 1;
      }
    } else {
      // Use TRON: Legacy color system
      meshMaterial.color.set(new THREE.Color(tronColors.baseColor));
      meshMaterial.emissive.set(new THREE.Color(tronColors.emissiveColor));
      meshMaterial.emissiveIntensity = tronColors.emissiveIntensity;
      baseEmissiveIntensityRef.current = meshMaterial.emissiveIntensity;

      // Update edge color
      if (edgeMaterialRef.current) {
        const edgeColor = new THREE.Color(tronColors.edgeColor);
        edgeMaterialRef.current.color.copy(edgeColor);
        baseEdgeColorRef.current.copy(edgeColor);
        baseEdgeOpacityRef.current = edgeMaterialRef.current.opacity ?? 1;
      }

      // Update active outline color
      const activeOutline = activeOutlineRef.current;
      if (activeOutline && activeOutline.material && isActive) {
        activeOutline.material.color.set(new THREE.Color(tronColors.edgeColor));
      }
    }

    meshMaterial.roughness = 0.2;
    meshMaterial.metalness = 0.65;
    meshMaterial.needsUpdate = true;
    if (meshMaterial.emissiveIntensity != null) {
      baseEmissiveIntensityRef.current = meshMaterial.emissiveIntensity;
    }
  }, [blockIndex, isActive, color, tronColors]);

  useEffect(() => {
    if (!perfectEdgeEvent || isActive) {
      return;
    }
    if (!perfectEdgeEvent.totalBlocks) {
      return;
    }
    const stepsFromTop = (perfectEdgeEvent.totalBlocks - 1) - blockIndex;
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
      tier: perfectEdgeEvent.tier ?? 0
    };
    animationActiveRef.current = true;
  }, [perfectEdgeEvent, blockIndex, isActive]);

  useEffect(() => {
    animationActiveRef.current = true;
  }, [targetPosition.x, targetPosition.y, targetPosition.z, rotationY, isActive]);

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
    const edgeMat = edgeMaterialRef.current;
    const mesh = meshRef.current;
    const meshMaterial = mesh && mesh.material instanceof THREE.MeshStandardMaterial
      ? mesh.material
      : null;
    if (cascade && edgeMat && meshMaterial) {
      const nowSeconds = (typeof performance !== 'undefined' ? performance.now() : Date.now()) / 1000;
      const localTime = nowSeconds - cascade.startSeconds - cascade.delay;

      if (localTime < 0) {
        edgeMat.color.copy(baseEdgeColorRef.current);
        edgeMat.opacity = baseEdgeOpacityRef.current;
        meshMaterial.emissiveIntensity = baseEmissiveIntensityRef.current;
      } else {
        if (localTime >= cascade.duration) {
          edgeMat.color.copy(baseEdgeColorRef.current);
          edgeMat.opacity = baseEdgeOpacityRef.current;
          meshMaterial.emissiveIntensity = baseEmissiveIntensityRef.current;
          cascadeStateRef.current = null;
        } else {
          const progress = Math.max(0, Math.min(1, localTime / cascade.duration));
          const strength = Math.sin(progress * Math.PI);
          const tierBoost = Math.min(0.9, cascade.tier * 0.05);
          const glow = (1 - progress) * (1.3 + tierBoost) * strength;

          tempColorRef.current.copy(baseEdgeColorRef.current);
          tempColorRef.current.multiplyScalar(1 + glow * 0.6);
          edgeMat.color.copy(tempColorRef.current);
          edgeMat.opacity = Math.min(1, baseEdgeOpacityRef.current + glow * 0.35);

          meshMaterial.emissiveIntensity = baseEmissiveIntensityRef.current + glow * 1.2;
        }
      }
    }

    const positionDelta = Math.abs(targetPosition.x - g.position.x) + Math.abs(targetPosition.y - g.position.y) + Math.abs(targetPosition.z - g.position.z);
    const rotationDelta = Math.abs(rotationY - g.rotation.y);
    const bounceActive = bounceRef.current.intensity > 0;

    if (!isActive && !cascadeActive && !bounceActive && positionDelta < 0.0008 && rotationDelta < 0.0004) {
      g.position.set(targetPosition.x, targetPosition.y, targetPosition.z);
      g.rotation.y = rotationY;
      animationActiveRef.current = false;
    }
  }); return (
    <group ref={groupRef} rotation={[0, rotationY, 0]}>
      {/* Dark solid block */}
      <mesh
        ref={meshRef}
        castShadow={true}
        receiveShadow={true}
        geometry={geometry}
      >
        <meshStandardMaterial
          color={color ?? '#0a0a0a'}
          roughness={0.2}
          metalness={0.65}
          emissive={color ?? '#00f2fe'}
          emissiveIntensity={0.1}
          toneMapped={false}
        />
      </mesh>

      {/* TRON: Legacy glowing edges */}
      <lineSegments geometry={edgesGeometry}>
        <lineBasicMaterial
          ref={edgeMaterialRef}
          attach="material"
          color="#00f2fe"
          opacity={1.0}
          transparent={true}
          toneMapped={false}
          linewidth={2}
        />
      </lineSegments>

      {isActive && (
        <mesh ref={activeOutlineRef} scale={1.05} renderOrder={999} castShadow={false} receiveShadow={false}>
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
            <meshBasicMaterial
              color="#00ff00"
              wireframe={true}
              transparent={true}
              opacity={0.8}
            />
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
            <meshBasicMaterial
              color="#ffffff"
              transparent={true}
              opacity={0.9}
            />
          </mesh>
        </group>
      )}
    </group>
  );
};
