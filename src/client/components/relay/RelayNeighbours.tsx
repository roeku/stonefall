import React, { useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import type { ThreeEvent } from '@react-three/fiber';
import { Html } from '@react-three/drei';
import * as THREE from 'three';
import type { RelayTowerSummary } from '../../../shared/types/api';
import { decodeColors } from '../../../shared/relay/rules';
import { factionHex, factionRgb } from '../../../shared/types/factions';
import { DEFAULT_CONFIG } from '../../../shared/simulation/types';
import { cellToWorld, worldToCell } from '../../../shared/types/worldGrid';
import { hexToRgb } from '../board/boardInstancing';
import { createRimMaterial } from '../board/rimMaterial';

/**
 * The other crews' towers, standing behind this one.
 *
 * A post with several towers is a race, and a race you cannot see is a queue with extra steps.
 * So the other towers stand in a V behind the one on screen, each at its own height in the
 * colours it was laid in, dimmed so the tower in front stays the subject. The run camera looks
 * at the top of the front tower from in front and to the side; from there the nearest rivals
 * rise either side of it, and a crew can see at a glance whether it is ahead.
 *
 * Drawn as full-width slabs from each tower's summary, never from its geometry: a neighbour is a
 * few hundred bytes a push, and at the distance neighbours are seen from a trim is invisible.
 */

/**
 * Where neighbours stand, as distance behind the front tower and distance to its side, in world
 * units, nearest first. "Behind" is away from the run camera, which looks from +x+z.
 */
const SLOTS: ReadonlyArray<readonly [number, number]> = [
  [52, -15],
  [52, 15],
  [104, -31],
  [104, 31],
  [156, -47],
  [156, 47],
];
const AWAY = { x: -Math.SQRT1_2, z: -Math.SQRT1_2 };
const RIGHT = { x: Math.SQRT1_2, z: -Math.SQRT1_2 };
const BLOCK_H = DEFAULT_CONFIG.BLOCK_HEIGHT / 1000;
const WIDTH = (DEFAULT_CONFIG.TOWER_WIDTH * 2) / 1000;
/** Most slabs one neighbour is drawn with; a taller tower draws neighbouring blocks as one. */
const MAX_SLABS = 320;
/** How far the neighbours' rims step back from the tower in front. */
const DIM = 0.5;
const NEUTRAL = hexToRgb(factionHex(null));

interface PlacedNeighbour {
  tower: RelayTowerSummary;
  x: number;
  z: number;
}

/**
 * Which towers stand where: the ones with a crew first, then the tallest, nearest the front.
 * Positions are snapped to the floor's cells so the neighbours stand on the grid like towers do.
 */
const placeNeighbours = (
  towers: readonly RelayTowerSummary[],
  focus: number,
  origin: { x: number; z: number }
): PlacedNeighbour[] =>
  towers
    .filter((t) => t.id !== focus)
    .sort((a, b) => b.crew - a.crew || b.height - a.height || a.id - b.id)
    .slice(0, SLOTS.length)
    .map((tower, i) => {
      const [away, side] = SLOTS[i]!;
      const wx = origin.x + AWAY.x * away + RIGHT.x * side;
      const wz = origin.z + AWAY.z * away + RIGHT.z * side;
      return { tower, x: cellToWorld(worldToCell(wx)), z: cellToWorld(worldToCell(wz)) };
    });

interface RelayNeighboursProps {
  towers: readonly RelayTowerSummary[];
  /** The tower in front, which is not a neighbour of itself. */
  focus: number;
  /** Where the tower in front stands. */
  origin: { x: number; z: number };
  /** Watch a neighbour by tapping it. Only offered to someone not holding a seat. */
  onPick?: ((tower: number) => void) | undefined;
}

export const RelayNeighbours: React.FC<RelayNeighboursProps> = ({
  towers,
  focus,
  origin,
  onPick,
}) => {
  const placed = useMemo(() => placeNeighbours(towers, focus, origin), [towers, focus, origin]);

  const built = useMemo(() => {
    const slabs: Array<{ x: number; y: number; z: number; h: number; rgb: typeof NEUTRAL }> = [];
    for (const n of placed) {
      const colors = decodeColors(n.tower.colors);
      const count = Math.max(1, n.tower.height);
      const per = Math.max(1, Math.ceil(count / MAX_SLABS));
      for (let i = 0; i < count; i += per) {
        const faction = colors[Math.min(count - 1, i + per - 1)] ?? colors[i] ?? null;
        const h = BLOCK_H * Math.min(per, count - i);
        slabs.push({
          x: n.x,
          y: i * BLOCK_H + h / 2,
          z: n.z,
          h,
          rgb: faction ? hexToRgb(factionHex(faction)) : NEUTRAL,
        });
      }
    }
    const geometry = new THREE.BoxGeometry(1, 1, 1);
    const material = createRimMaterial({ intensity: 1 });
    const mesh = new THREE.InstancedMesh(geometry, material, Math.max(1, slabs.length));
    const colors = new Float32Array(Math.max(1, slabs.length) * 3);
    const m = new THREE.Matrix4();
    slabs.forEach((s, i) => {
      m.makeScale(WIDTH, s.h, WIDTH);
      m.setPosition(s.x, s.y, s.z);
      mesh.setMatrixAt(i, m);
      colors[i * 3] = s.rgb.r * DIM;
      colors[i * 3 + 1] = s.rgb.g * DIM;
      colors[i * 3 + 2] = s.rgb.b * DIM;
    });
    mesh.instanceColor = new THREE.InstancedBufferAttribute(colors, 3);
    mesh.count = slabs.length;
    mesh.frustumCulled = false;
    return { mesh, geometry, material };
  }, [placed]);

  useEffect(
    () => () => {
      built.geometry.dispose();
      built.material.dispose();
      built.mesh.dispose();
    },
    [built]
  );

  // One invisible box per neighbour, for tapping it to watch.
  const hitRef = useRef<THREE.InstancedMesh>(null);
  useLayoutEffect(() => {
    const hit = hitRef.current;
    if (!hit) return;
    const m = new THREE.Matrix4();
    placed.forEach((n, i) => {
      const h = Math.max(4, n.tower.height * BLOCK_H);
      m.makeScale(WIDTH + 4, h, WIDTH + 4);
      m.setPosition(n.x, h / 2, n.z);
      hit.setMatrixAt(i, m);
    });
    hit.count = placed.length;
    hit.instanceMatrix.needsUpdate = true;
  }, [placed]);

  const handleTap = (e: ThreeEvent<MouseEvent>) => {
    if (!onPick || typeof e.instanceId !== 'number') return;
    const n = placed[e.instanceId];
    if (!n) return;
    e.stopPropagation();
    onPick(n.tower.id);
  };

  if (placed.length === 0) return null;
  return (
    <group name="relay-neighbours">
      <primitive object={built.mesh} raycast={() => null} />
      {onPick && (
        <instancedMesh
          key={`hit-${placed.length}`}
          ref={hitRef}
          args={[undefined, undefined, placed.length]}
          frustumCulled={false}
          onClick={handleTap}
        >
          <boxGeometry args={[1, 1, 1]} />
          <meshBasicMaterial transparent opacity={0} depthWrite={false} colorWrite={false} />
        </instancedMesh>
      )}
      {placed.map((n) => {
        const colors = decodeColors(n.tower.colors);
        const top = colors[colors.length - 1] ?? null;
        return (
          <Html
            key={n.tower.id}
            position={[n.x, n.tower.height * BLOCK_H + 3, n.z]}
            center
            zIndexRange={[4, 0]}
            style={{ pointerEvents: 'none' }}
          >
            <div
              className={`relay-tag${n.tower.crew > 0 ? '' : ' relay-tag--idle'}`}
              style={{ ['--rim-rgb' as string]: factionRgb(top) }}
            >
              <span className="relay-tag__id">Tower {n.tower.id}</span>
              <span className="relay-tag__height">{n.tower.height.toLocaleString()}</span>
            </div>
          </Html>
        );
      })}
    </group>
  );
};
