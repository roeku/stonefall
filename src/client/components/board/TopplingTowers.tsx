import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import type { TowerMapEntry } from '../../../shared/types/api';
import { factionHex } from '../../../shared/types/factions';
import { towerBox } from './boardInstancing';
import { createRimMaterial } from './rimMaterial';

export interface Topple {
  key: string;
  entry: TowerMapEntry;
  /** performance.now() when it began. */
  at: number;
  /** Which way it leans as it goes, radians of yaw for the fall direction. */
  direction: number;
}

/** How long a topple takes, ms. */
export const TOPPLE_MS = 900;

/** The falling tower's material, with its opacity behind a method a frame may call. */
class Fade {
  readonly material: THREE.MeshBasicMaterial;
  constructor(hex: string) {
    this.material = createRimMaterial({ intensity: 1 });
    this.material.color = new THREE.Color(hex);
    this.material.transparent = true;
  }
  set(opacity: number): void {
    this.material.opacity = opacity;
  }
  dispose(): void {
    this.material.dispose();
  }
}

interface TopplingTowersProps {
  topples: readonly Topple[];
}

/**
 * A tower coming down.
 *
 * When a take lands, the beaten tower is already gone from the board data; without this it
 * would simply not be there on the next frame, and the biggest thing that can happen on the map
 * would happen with no motion at all. So the last known geometry is kept for a second and
 * felled: it leans, drops through the floor and dims, and the winner is standing where it was
 * before the dust settles. Regular meshes rather than instances, because there is only ever a
 * handful of these and they exist for under a second.
 */
const Falling: React.FC<{ topple: Topple }> = ({ topple }) => {
  const group = useRef<THREE.Group>(null);
  const { entry } = topple;
  const box = useMemo(() => towerBox(entry.towerBlocks, entry.height), [entry]);

  // Held in state, behind a method, so a frame may fade it without a re-render.
  const [fade] = useState(() => new Fade(factionHex(entry.faction ?? null)));
  const material = fade.material;
  useEffect(() => () => fade.dispose(), [fade]);

  const blocks = useMemo(
    () =>
      entry.towerBlocks.length > 0
        ? entry.towerBlocks.map((b, i) => ({
            key: i,
            x: b.x / 1000,
            y: b.y / 1000,
            z: (b.z ?? 0) / 1000,
            w: b.width / 1000,
            h: b.height / 1000,
            d: (b.depth ?? b.width) / 1000,
          }))
        : box
          ? [
              {
                key: 0,
                x: 0,
                y: 0,
                z: 0,
                w: box.maxX - box.minX,
                h: box.maxY - box.minY,
                d: box.maxZ - box.minZ,
              },
            ]
          : [],
    [entry.towerBlocks, box]
  );

  useFrame(() => {
    const g = group.current;
    if (!g) return;
    const t = Math.min(1, (performance.now() - topple.at) / TOPPLE_MS);
    // Lean first, then drop: the top goes over, then the whole thing goes through the floor.
    const lean = Math.min(1, t * 1.6);
    const eased = lean * lean;
    g.rotation.set(0, topple.direction, 0);
    g.rotateX(eased * 0.55);
    const sink = Math.max(0, t - 0.35) / 0.65;
    const height = box ? box.maxY : 4;
    g.position.y = (entry.stackBaseY ?? 0) / 1000 - sink * sink * (height + 2);
    fade.set(1 - t * t);
  });

  return (
    <group
      ref={group}
      position={[entry.worldX ?? 0, (entry.stackBaseY ?? 0) / 1000, entry.worldZ ?? 0]}
    >
      {blocks.map((b) => (
        <mesh
          key={b.key}
          position={[b.x, b.y + b.h / 2, b.z]}
          material={material}
          raycast={() => null}
        >
          <boxGeometry args={[b.w, b.h, b.d]} />
        </mesh>
      ))}
    </group>
  );
};

export const TopplingTowers: React.FC<TopplingTowersProps> = ({ topples }) => (
  <group name="toppling">
    {topples.map((t) => (
      <Falling key={t.key} topple={t} />
    ))}
  </group>
);
