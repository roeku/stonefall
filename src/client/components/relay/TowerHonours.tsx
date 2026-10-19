import React, { useEffect, useMemo, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { Html } from '@react-three/drei';
import * as THREE from 'three';
import { FixedMath } from '../../../shared/simulation';
import type { Block } from '../../../shared/simulation/types';
import { Avatar } from './Avatar';

/**
 * Who built a colour's tower, marked on it: beside the stretch of blocks each of the best turns
 * laid, a bracket the height of that stretch and the builder's face, with how many blocks the turn
 * stacked and its longest run of perfects (shared/relay/rules.ts `noteBestTurn`).
 *
 * On a colour's tower every block is the same colour, so the tower alone cannot say who carried
 * it. The marks do, where the work is: a fifteen-block turn is a long bracket, a two-block one a
 * notch. The best turn is gold. The viewer's own best is marked whatever its rank.
 *
 * Drawn inside the tower's group, so the brackets squash with it when the whole tower is shown.
 * The camera turns round the tower while it waits, so every frame the marks are moved to the side
 * of the tower that is the screen's left: the right is the crew's, down the edge, and the towers
 * behind. A face that would sit on a better-ranked one, or on the chrome, steps back until there
 * is room for it.
 */

export interface Honour {
  userId: string;
  name: string;
  avatar: string | null;
  from: number;
  to: number;
  laid: number;
  streak: number;
  /** 1 is the tower's best turn. */
  rank: number;
  mine: boolean;
}

/** Every number the marks are tuned by. World units unless said. */
const HONOURS = {
  /** How far off the tower's face the bracket stands. */
  GAP: 1.1,
  /** The bracket: its thickness, and the ticks at its ends pointing in at the tower. */
  BAR: 0.3,
  TICK: 1,
  /** Screen pixels a face needs to itself, up and down. */
  ROOM_PX: 38,
  /** Screen pixels kept clear at the top left, for the colour's readout, and at the foot. */
  CLEAR_TOP_PX: 108,
  CLEAR_LEFT_PX: 190,
  CLEAR_FOOT_PX: 132,
  /** Perfects in a row worth saying. */
  STREAK_FROM: 3,
};

const GOLD = '#ffd166';
const INK = '#f3f7fa';

const OneHonour: React.FC<{
  h: Honour;
  blocks: readonly Block[];
  faction: string;
  label: React.MutableRefObject<Map<string, HTMLDivElement>>;
}> = ({ h, blocks, faction, label }) => {
  const group = useRef<THREE.Group>(null);
  const face = useRef<THREE.Group>(null);
  const first = blocks[h.from];
  const last = blocks[Math.min(h.to, blocks.length) - 1];
  const camera = useThree((s) => s.camera);
  const size = useThree((s) => s.size);
  const right = useMemo(() => new THREE.Vector3(), []);
  const end = useMemo(() => new THREE.Vector3(), []);

  const box = useMemo(() => new THREE.BoxGeometry(1, 1, 1), []);
  const colour = h.rank === 1 ? GOLD : INK;
  const material = useMemo(
    () =>
      new THREE.MeshBasicMaterial({
        color: colour,
        transparent: true,
        opacity: h.rank === 1 ? 1 : 0.85,
        toneMapped: false,
      }),
    [colour, h.rank]
  );
  useEffect(
    () => () => {
      box.dispose();
      material.dispose();
    },
    [box, material]
  );

  const bottom = first ? FixedMath.toFloat(first.y - first.height / 2) : 0;
  const top = last ? FixedMath.toFloat(last.y + last.height / 2) : 0;
  const span = Math.max(0.4, top - bottom);
  const mid = last ?? first;
  const cx = mid ? FixedMath.toFloat(mid.x) : 0;
  const cz = mid ? FixedMath.toFloat(mid.z ?? 0) : 0;
  const half = mid ? FixedMath.toFloat(Math.max(mid.width, mid.depth ?? mid.width)) / 2 : 4;

  // To the screen's left of the tower, whichever way the camera has turned. The group's own x is
  // the screen's right, so the ticks point along it, in at the tower.
  useFrame(() => {
    const g = group.current;
    if (!g) return;
    right.setFromMatrixColumn(camera.matrixWorld, 0);
    right.setY(0);
    if (right.lengthSq() < 1e-6) right.set(1, 0, 0);
    right.normalize();
    const off = half + HONOURS.GAP;
    g.position.set(cx - right.x * off, (bottom + top) / 2, cz - right.z * off);
    g.rotation.set(0, Math.atan2(-right.z, right.x), 0);

    // The face rides its bracket: at its middle, or as near as it can get to it while clear of
    // the chrome at the top and the foot, so a stretch half under the readout still says whose.
    const f = face.current;
    if (!f) return;
    g.updateMatrixWorld();
    const screenY = (y: number) => {
      end.set(0, y, 0);
      g.localToWorld(end).project(camera);
      return (-end.y * 0.5 + 0.5) * size.height;
    };
    const sTop = screenY(span / 2);
    const sBottom = screenY(-span / 2);
    if (!(sBottom - sTop > 1)) {
      f.position.y = 0;
      return;
    }
    const clear = Math.min(
      Math.max((sTop + sBottom) / 2, HONOURS.CLEAR_TOP_PX + HONOURS.ROOM_PX / 2),
      size.height - HONOURS.CLEAR_FOOT_PX - HONOURS.ROOM_PX / 2
    );
    const at = Math.min(Math.max(clear, sTop), sBottom);
    f.position.y = ((sBottom - at) / (sBottom - sTop) - 0.5) * span;
  });

  if (!first || !last) return null;
  return (
    <group ref={group}>
      {/* The bracket: the stretch's height, ticks at its ends turned in at the tower. */}
      <mesh
        geometry={box}
        material={material}
        scale={[HONOURS.BAR, span, HONOURS.BAR]}
        raycast={() => null}
      />
      {[-1, 1].map((end) => (
        <mesh
          key={end}
          geometry={box}
          material={material}
          position={[HONOURS.TICK / 2, (end * span) / 2, 0]}
          scale={[HONOURS.TICK, HONOURS.BAR, HONOURS.BAR]}
          raycast={() => null}
        />
      ))}
      <group ref={face}>
        <Html position={[-0.3, 0, 0]} zIndexRange={[4, 0]} style={{ pointerEvents: 'none' }}>
          <div
            ref={(el) => {
              if (el) label.current.set(h.userId, el);
              else label.current.delete(h.userId);
            }}
            className={`honour${h.rank === 1 ? ' honour--first' : ''}${h.mine ? ' honour--mine' : ''}`}
            style={{ ['--rim-rgb' as string]: faction }}
          >
            <Avatar className="honour__face" src={h.avatar} name={h.name} />
            <span className="honour__words">
              <span className="honour__laid">
                +{h.laid}
                {h.streak >= HONOURS.STREAK_FROM && (
                  <span className="honour__streak">{h.streak}×</span>
                )}
              </span>
              <span className="honour__name">{h.mine ? 'you' : h.name}</span>
            </span>
          </div>
        </Html>
      </group>
    </group>
  );
};

export const TowerHonours: React.FC<{
  honours: readonly Honour[];
  blocks: readonly Block[];
  /** The tower's colour as "r, g, b", for the rings round the faces. */
  faction: string;
}> = ({ honours, blocks, faction }) => {
  const labels = useRef(new Map<string, HTMLDivElement>());
  const size = useThree((s) => s.size);
  const ranked = useMemo(() => [...honours].sort((a, b) => a.rank - b.rank), [honours]);

  // Faces that would sit on a better one step back: best first, each kept only with room round it.
  useFrame(() => {
    const taken: number[] = [];
    for (const h of ranked) {
      const el = labels.current.get(h.userId);
      if (!el) continue;
      const r = el.getBoundingClientRect();
      const y = r.top + r.height / 2;
      const offscreen = r.bottom < 0 || r.top > size.height + 40 || r.right < 0;
      const onChrome =
        (r.top < HONOURS.CLEAR_TOP_PX && r.left < HONOURS.CLEAR_LEFT_PX) ||
        r.bottom > size.height - HONOURS.CLEAR_FOOT_PX;
      const room = taken.every((t) => Math.abs(t - y) >= HONOURS.ROOM_PX);
      // The viewer's own shows wherever there is no chrome under it: it is theirs to find.
      const show = !offscreen && !onChrome && (room || h.mine);
      el.style.opacity = show ? '1' : '0';
      if (show) taken.push(y);
    }
  });

  return (
    <group name="tower-honours">
      {ranked.map((h) => (
        <OneHonour key={h.userId} h={h} blocks={blocks} faction={faction} label={labels} />
      ))}
    </group>
  );
};
