import React, { useEffect, useMemo } from 'react';
import { Html } from '@react-three/drei';
import * as THREE from 'three';
import { FixedMath } from '../../../shared/simulation';
import type { Block } from '../../../shared/simulation/types';

/** A score passed during a run, pinned to the block that passed it. */
export interface RunPass {
  key: number;
  /** Index into the run's blocks of the block whose landing carried the score past the bar. */
  blockIndex: number;
  /** Who was passed, as the tag says it: "u/name", "Your tower", or "Best" for the own best. */
  label: string;
  /** Their colour, as #rrggbb; gold for the player's own best. */
  color: string;
  /** The same colour as "r, g, b", for the chrome's CSS. Null when it is not a faction's. */
  rgb: string | null;
  /** The player's own best, rather than a rival. Announced as a new best, not as a pass. */
  own: boolean;
}

/** How many rings stay up at once. Older ones are below the frame by then anyway. */
const SHOWN = 6;
/** How far a ring stands off the block's faces, in world units. */
const MARGIN = 0.5;

/**
 * A thin ring round the tower at every block that passed somebody, in their colour, with their
 * name beside it.
 *
 * A pass used to be a word in the middle of the screen and then nothing: the tower carried no
 * trace of it. Now the tower keeps the story of the run, one ring per rival passed, and the
 * finished tower shows where each one fell behind. Drawn in simulation space, inside the group
 * the run is offset onto its cell by, so it sits on the blocks exactly.
 */
export const PassRings: React.FC<{
  passes: readonly RunPass[];
  blocks: readonly Block[];
}> = ({ passes, blocks }) => {
  const square = useMemo(() => {
    const g = new THREE.BufferGeometry();
    g.setAttribute(
      'position',
      new THREE.Float32BufferAttribute([-0.5, 0, -0.5, 0.5, 0, -0.5, 0.5, 0, 0.5, -0.5, 0, 0.5], 3)
    );
    return g;
  }, []);
  useEffect(() => () => square.dispose(), [square]);

  return (
    <group name="pass-rings">
      {passes.slice(-SHOWN).map((p) => {
        const b = blocks[p.blockIndex];
        if (!b) return null;
        const x = FixedMath.toFloat(b.x);
        const y = FixedMath.toFloat(b.y + b.height / 2);
        const z = FixedMath.toFloat(b.z ?? 0);
        const w = FixedMath.toFloat(b.width) + MARGIN;
        const d = FixedMath.toFloat(b.depth ?? b.width) + MARGIN;
        return (
          <group key={p.key} position={[x, y, z]}>
            {/* Two loops a hair apart: a WebGL line is one pixel, which a phone's density
                thins to nothing. */}
            {[0, 0.12].map((grow) => (
              <lineLoop
                key={grow}
                geometry={square}
                scale={[w + grow, 1, d + grow]}
                raycast={() => null}
              >
                <lineBasicMaterial color={p.color} transparent opacity={0.95} toneMapped={false} />
              </lineLoop>
            ))}
            {/* The run camera looks in from +x +z, so screen right is the +x -z corner: the name
                sits just off it. */}
            <Html
              position={[w / 2, 0, -d / 2]}
              zIndexRange={[5, 0]}
              style={{ pointerEvents: 'none' }}
            >
              <span className="pass-tag" style={{ color: p.color }}>
                {p.label}
              </span>
            </Html>
          </group>
        );
      })}
    </group>
  );
};
