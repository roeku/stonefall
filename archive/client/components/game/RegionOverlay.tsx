import React from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import type { PlayerRegion } from '../../../shared/types/api';
import { DEFAULT_TOWER_GRID_SIZE } from '../../../shared/types/towerPlacement';
import { cellToWorld } from '../../../shared/types/worldGrid';

interface RegionOverlayProps {
  region: PlayerRegion;
  /** Brighter and pulsing while a tower is in hand; a quiet marker the rest of the time. */
  active: boolean;
}

const ACTIVE_COLOR = '#4ade80';
/**
 * Amber, not another blue.
 *
 * The first attempt used a sky blue a few degrees off the grid's own `#1e90ff`, and at low
 * opacity under bloom it was invisible -- the marker was drawing correctly and simply could not
 * be told apart from the floor it sat on. The plot boundary has to contrast with the grid, not
 * belong to it.
 */
const IDLE_COLOR = '#fbbf24';

/**
 * Marks out the player's own patch of the shared grid.
 *
 * Placement asks the player to "tap a cell in your area", and taps outside that area are ignored
 * -- correctly, since most of the grid belongs to other people. But with nothing drawn, the two
 * behaviours combine into something that looks broken: the game gives an instruction referring to
 * a place it never shows, then silently swallows taps aimed at the wrong half of an identical
 * floor. Drawing the boundary is what makes the rule visible rather than mysterious.
 *
 * Kept as flat ground decals so it never occludes a tower or fights the grid for attention.
 */
export const RegionOverlay: React.FC<RegionOverlayProps> = ({ region, active }) => {
  const centerX = cellToWorld(region.centerX);
  const centerZ = cellToWorld(region.centerZ);
  // radius is in cells and counts from the centre cell, so the span covers both sides plus it.
  const half = (region.radius * 2 + 1) * (DEFAULT_TOWER_GRID_SIZE / 2);

  const fillRef = React.useRef<THREE.MeshBasicMaterial>(null);
  const edgeRef = React.useRef<THREE.LineBasicMaterial>(null);
  const pulse = React.useRef(0);

  useFrame((_, delta) => {
    pulse.current += delta * 2.2;
    // Only the active state breathes. A resting marker that pulses reads as something demanding
    // attention, and this one is meant to sit in the background until it matters.
    const wave = active ? Math.sin(pulse.current) : 0;
    if (fillRef.current) fillRef.current.opacity = (active ? 0.14 : 0.07) + wave * 0.03;
    if (edgeRef.current) edgeRef.current.opacity = (active ? 0.95 : 0.6) + wave * 0.12;
  });

  const color = active ? ACTIVE_COLOR : IDLE_COLOR;

  // Boundary as a closed loop, plus corner brackets that stay legible when the loop is only a
  // few pixels of line at a distance.
  const outline = React.useMemo(() => {
    const g = new THREE.BufferGeometry();
    g.setAttribute(
      'position',
      new THREE.Float32BufferAttribute(
        [-half, 0, -half, half, 0, -half, half, 0, half, -half, 0, half],
        3
      )
    );
    return g;
  }, [half]);

  const brackets = React.useMemo(() => {
    const arm = half * 0.28;
    const pts: number[] = [];
    for (const sx of [-1, 1]) {
      for (const sz of [-1, 1]) {
        const cx = sx * half;
        const cz = sz * half;
        pts.push(cx, 0, cz, cx - sx * arm, 0, cz);
        pts.push(cx, 0, cz, cx, 0, cz - sz * arm);
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
    return g;
  }, [half]);

  React.useEffect(() => {
    return () => {
      outline.dispose();
      brackets.dispose();
    };
  }, [outline, brackets]);

  return (
    <group position={[centerX, 0, centerZ]}>
      {/* Sits just above the floor: coplanar with the grid it z-fights, and the flicker is far
          more distracting than the overlay is useful. */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.02, 0]}>
        <planeGeometry args={[half * 2, half * 2]} />
        <meshBasicMaterial
          ref={fillRef}
          color={color}
          transparent
          opacity={0.04}
          depthWrite={false}
          blending={THREE.AdditiveBlending}
        />
      </mesh>

      <lineLoop position={[0, 0.05, 0]} geometry={outline}>
        <lineBasicMaterial ref={edgeRef} color={color} transparent opacity={0.3} />
      </lineLoop>

      <lineSegments position={[0, 0.06, 0]} geometry={brackets}>
        <lineBasicMaterial color={color} transparent opacity={active ? 1 : 0.8} />
      </lineSegments>
    </group>
  );
};
