import React, { useEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';

export interface LandingRing {
  key: number;
  x: number;
  y: number;
  z: number;
  width: number;
  depth: number;
  /** Time the block landed, ms. */
  at: number;
  perfect: boolean;
}

interface LandingRingsProps {
  rings: ReadonlyArray<LandingRing>;
}

const POOL = 6;
const LIFE_MS = 420;

/** Places, sizes and fades one ring for this frame; hides it when it has nothing to show. */
const styleRing = (
  loop: THREE.LineLoop,
  mat: THREE.LineBasicMaterial,
  ring: LandingRing | undefined,
  pass: number,
  now: number
): void => {
  const t = ring ? (now - ring.at - pass * 70) / LIFE_MS : -1;
  if (!ring || (pass === 1 && !ring.perfect) || t < 0 || t > 1) {
    mat.opacity = 0;
    loop.visible = false;
    return;
  }
  loop.visible = true;
  const ease = 1 - Math.pow(1 - t, 3);
  const grow = 1 + ease * (ring.perfect ? 1.6 : 0.9) * (pass === 1 ? 1.4 : 1);
  loop.position.set(ring.x, ring.y + 0.03, ring.z);
  loop.scale.set(ring.width * grow, 1, ring.depth * grow);
  mat.color.set(ring.perfect ? '#ffffff' : '#6ff3ff');
  mat.opacity = (1 - t) * (pass === 1 ? 0.7 : 1);
};

/**
 * A shockwave on the plane a block lands on: a square the block's own size that expands and
 * fades. Perfect landings throw a second, larger ring so a chain reads as escalating.
 *
 * Instantaneous feedback for the one action the game has. The thud and the hit stop say a block
 * landed; this says where, and how well.
 */
export const LandingRings: React.FC<LandingRingsProps> = ({ rings }) => {
  const loops = useRef<Array<THREE.LineLoop | null>>([]);
  const geometry = useMemo(() => {
    const g = new THREE.BufferGeometry();
    g.setAttribute(
      'position',
      new THREE.Float32BufferAttribute([-0.5, 0, -0.5, 0.5, 0, -0.5, 0.5, 0, 0.5, -0.5, 0, 0.5], 3)
    );
    return g;
  }, []);
  const materials = useMemo(
    () =>
      Array.from(
        { length: POOL * 2 },
        () =>
          new THREE.LineBasicMaterial({
            color: '#ffffff',
            transparent: true,
            opacity: 0,
            toneMapped: false,
          })
      ),
    []
  );
  useEffect(
    () => () => {
      geometry.dispose();
      materials.forEach((m) => m.dispose());
    },
    [geometry, materials]
  );

  useFrame(() => {
    const now = performance.now();
    for (let i = 0; i < POOL; i++) {
      const ring = rings[rings.length - 1 - i];
      for (let pass = 0; pass < 2; pass++) {
        const loop = loops.current[i * 2 + pass];
        if (!loop) continue;
        styleRing(loop, materials[i * 2 + pass]!, ring, pass, now);
      }
    }
  });

  return (
    <group name="landing-rings">
      {materials.map((mat, i) => (
        <lineLoop
          key={i}
          ref={(el) => {
            loops.current[i] = el;
          }}
          geometry={geometry}
          material={mat}
          visible={false}
          raycast={() => null}
        />
      ))}
    </group>
  );
};
