import React, { useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { Html } from '@react-three/drei';
import * as THREE from 'three';
import { factionHex, type FactionId } from '../../../shared/types/factions';
import { DEFAULT_TOWER_GRID_SIZE } from '../../../shared/types/towerPlacement';
import { cellToWorld } from '../../../shared/types/worldGrid';

/**
 * Words written on the world: the name of the cell being aimed at, SAFE on the keep, whose a
 * tower is and its bar.
 *
 * The chrome used to say all of this from the edges of the frame, in cards and pills, and the
 * player had to match the words to the place. Written on the place, there is nothing to match.
 * Drawn as DOM over the scene, so they are type like the rest of the chrome, and never
 * interactive: the taps belong to the board underneath.
 */

const HALF = DEFAULT_TOWER_GRID_SIZE / 2;

/**
 * A word on the ground at the front corner of a square of cells: the corner nearest the camera,
 * found every frame, because the board turns itself slowly and the front moves with it.
 */
export const GroundTag: React.FC<{
  /** The centre cell of the square. */
  x: number;
  z: number;
  /** How many cells out from the centre the square runs: 0 for one cell, 1 for a keep. */
  radius?: number | undefined;
  y: number;
  dim?: boolean | undefined;
  children: React.ReactNode;
}> = ({ x: cx, z: cz, radius = 0, y, dim = false, children }) => {
  const group = useRef<THREE.Group>(null);
  const { camera } = useThree();
  const minX = cellToWorld(cx - radius) - HALF;
  const maxX = cellToWorld(cx + radius) + HALF;
  const minZ = cellToWorld(cz - radius) - HALF;
  const maxZ = cellToWorld(cz + radius) + HALF;
  useFrame(() => {
    const g = group.current;
    if (!g) return;
    const { x, z } = camera.position;
    g.position.set(
      Math.abs(x - minX) < Math.abs(x - maxX) ? minX : maxX,
      y,
      Math.abs(z - minZ) < Math.abs(z - maxZ) ? minZ : maxZ
    );
  });
  return (
    // Starts on the corner facing the board's opening angle, so the first frame is not at zero.
    <group ref={group} position={[maxX, y, maxZ]}>
      <Html zIndexRange={[4, 0]} style={{ pointerEvents: 'none' }}>
        <span className={`ground-tag${dim ? ' ground-tag--dim' : ''}`}>{children}</span>
      </Html>
    </group>
  );
};

/**
 * A tag standing on a point, e.g. over the top of a tower: its bar, whose it is in their
 * colour, and the cell. Any line can be left out. `best` sets the score in gold, for the best of
 * a day that is over.
 */
export const TowerTag: React.FC<{
  x: number;
  y: number;
  z: number;
  score?: number | null | undefined;
  who?: string | null | undefined;
  faction?: FactionId | null | undefined;
  where?: string | null | undefined;
  best?: boolean | undefined;
}> = ({ x, y, z, score, who, faction, where, best = false }) => (
  <Html position={[x, y, z]} zIndexRange={[5, 0]} style={{ pointerEvents: 'none' }}>
    <div className="world-tag__at">
      <div className={`world-tag${best ? ' world-tag--best' : ''}`}>
        {score != null && <span className="world-tag__num">{score.toLocaleString()}</span>}
        {who && (
          <span
            className="world-tag__who"
            style={faction ? { color: factionHex(faction) } : undefined}
          >
            {who}
          </span>
        )}
        {where && <span className="world-tag__where">{where}</span>}
      </div>
    </div>
  </Html>
);
