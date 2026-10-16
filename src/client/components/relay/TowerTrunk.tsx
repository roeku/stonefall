import React, { useEffect, useMemo } from 'react';
import * as THREE from 'three';
import type { Block } from '../../../shared/simulation/types';
import { hexToRgb } from '../board/boardInstancing';
import { createRimMaterial } from '../board/rimMaterial';

/**
 * The body of a relay tower: every block below the top few, as one instanced mesh.
 *
 * A relay tower runs to thousands of blocks, and the run's blocks are a component each with a
 * frame hook of its own. That is fine for the dozen the run camera sees, and hopeless for a tower
 * seen whole. So the scene keeps run blocks for the top, where blocks land, and draws everything
 * under them here, the way the other crews' towers are drawn (RelayNeighbours): a rim per block,
 * in the colour it was laid in, one draw for the lot.
 *
 * It is also where a player finds their part of the tower. With `lit` given, those blocks keep
 * their colour and every other block steps back, so a player's turns run up the tower as bright
 * bands among everyone else's.
 */

/** Blocks at the top of the tower the scene draws as run blocks; the trunk draws the rest. */
export const TRUNK_TOP = 30;

/** How far blocks that are not the player's step back while theirs are lit. */
const STEPPED_BACK = 0.22;
/** A lit block, a little over its own colour, so a single one is findable on a tall tower. */
const LIT = 1.25;
const NEUTRAL = '#8a93a6';

interface TowerTrunkProps {
  blocks: readonly Block[];
  /** Draw blocks [0, upTo); the scene draws the rest. */
  upTo: number;
  /** Body colour per block index, as the scene's palette has it. */
  palette: ReadonlyArray<string | null | undefined> | undefined;
  /** Runs of the player's own blocks, [first, last + 1). Null when nothing is being singled out. */
  lit: ReadonlyArray<readonly [number, number]> | null;
  /**
   * Seen from far off, the tower whole: blocks are drawn this many to a slab at most, so a
   * tower of thousands is a few hundred clean bands of colour rather than rims a fraction of a
   * pixel apart, which shimmer. A slab with any of the player's blocks in it is theirs, lit.
   */
  maxSlabs?: number | undefined;
}

const isLit = (runs: ReadonlyArray<readonly [number, number]>, i: number): boolean =>
  runs.some(([a, b]) => i >= a && i < b);

export const TowerTrunk: React.FC<TowerTrunkProps> = ({ blocks, upTo, palette, lit, maxSlabs }) => {
  const material = useMemo(() => createRimMaterial({ intensity: 1 }), []);
  const geometry = useMemo(() => new THREE.BoxGeometry(1, 1, 1), []);
  useEffect(
    () => () => {
      material.dispose();
      geometry.dispose();
    },
    [material, geometry]
  );

  // Blocks under the top few never change once laid (a heal only ever touches the top), so the
  // trunk is rebuilt when it grows, not on every frame the scene renders.
  const mesh = useMemo(() => {
    const total = Math.max(0, Math.min(upTo, blocks.length));
    const per = maxSlabs ? Math.max(1, Math.ceil(total / maxSlabs)) : 1;
    const count = Math.max(1, Math.ceil(total / per));
    const m = new THREE.InstancedMesh(geometry, material, count);
    const colors = new Float32Array(count * 3);
    const mat = new THREE.Matrix4();
    let n = 0;
    for (let i = 0; i < total; i += per) {
      const end = Math.min(total, i + per);
      const first = blocks[i];
      const last = blocks[end - 1];
      const mid = blocks[Math.floor((i + end - 1) / 2)];
      if (!first || !last || !mid) continue;
      const foot = first.y / 1000;
      const h = (last.y + last.height) / 1000 - foot;
      mat.makeScale(mid.width / 1000, h, (mid.depth ?? mid.width) / 1000);
      mat.setPosition(mid.x / 1000, foot + h / 2, (mid.z ?? 0) / 1000);
      m.setMatrixAt(n, mat);
      // The slab's colour: the player's own block in it, if there is one, else its top block's.
      let shown = end - 1;
      let theirs = false;
      if (lit) {
        for (let j = i; j < end; j++) {
          if (isLit(lit, j)) {
            shown = j;
            theirs = true;
            break;
          }
        }
      }
      const rgb = hexToRgb(palette?.[shown] ?? NEUTRAL);
      const k = lit ? (theirs ? LIT : STEPPED_BACK) : 1;
      colors[n * 3] = rgb.r * k;
      colors[n * 3 + 1] = rgb.g * k;
      colors[n * 3 + 2] = rgb.b * k;
      n += 1;
    }
    m.instanceColor = new THREE.InstancedBufferAttribute(colors, 3);
    m.count = n;
    m.frustumCulled = false;
    return m;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [upTo, palette, lit, maxSlabs, geometry, material]);

  useEffect(
    () => () => {
      mesh.dispose();
    },
    [mesh]
  );

  if (upTo <= 0) return null;
  return <primitive object={mesh} raycast={() => null} />;
};
