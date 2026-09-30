import React, { useEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { GrowthEffect } from '../../../shared/simulation';
import type { FactionTheme } from '../../constants/factions';

/**
 * A perfect buys back width on the idle axis, and this is the only place that says so.
 *
 * It used to be a green wireframe box with a green additive box inside it: a debug gizmo, in a
 * colour the game uses nowhere else, showing the box geometry's diagonals. The tower is the
 * player's colour and so is everything that happens to it, so the flare is the accent, and it
 * is drawn from EdgesGeometry -- silhouette edges only, no diagonals -- swelling out of the
 * block it just grew and fading in under half a second.
 */

interface GrowthEffectsProps {
  growthEffects: ReadonlyArray<GrowthEffect>;
  convertPosition: (fixedValue: number) => number;
  /** The simulation's tick now. Read every frame: the flare keeps the run's clock. */
  tick: () => number;
  theme?: FactionTheme | null | undefined;
}

/** Ticks the flare takes to swell and fade. The simulation keeps an effect around for 60. */
const LIFE_TICKS = 26;
/** How far past the block the outline swells, as a fraction of its size. */
const SWELL = 0.08;

const GrowthEffectItem: React.FC<{
  effect: GrowthEffect;
  convertPosition: (v: number) => number;
  tick: () => number;
  color: string;
}> = ({ effect, convertPosition, tick, color }) => {
  const group = useRef<THREE.Group>(null);
  const line = useRef<THREE.LineBasicMaterial>(null);
  const { x, y, z, width, height, depth } = useMemo(
    () => ({
      x: convertPosition(effect.block.x),
      y: convertPosition(effect.block.y),
      z: convertPosition(effect.block.z ?? 0),
      width: convertPosition(effect.block.width),
      height: convertPosition(effect.block.height),
      depth: convertPosition(effect.block.depth ?? effect.block.width),
    }),
    [effect, convertPosition]
  );

  const edges = useMemo(() => {
    const box = new THREE.BoxGeometry(width, height, depth);
    const geometry = new THREE.EdgesGeometry(box);
    box.dispose();
    return geometry;
  }, [width, height, depth]);

  useEffect(() => {
    return () => {
      edges.dispose();
    };
  }, [edges]);

  // Animated here rather than by re-rendering on every tick, which is what it used to take.
  useFrame(() => {
    const g = group.current;
    const m = line.current;
    if (!g || !m) return;
    // Age runs on simulation ticks, so the flare keeps the run's clock.
    const age = tick() - effect.tick;
    g.visible = age >= 0 && age <= LIFE_TICKS;
    if (!g.visible) return;
    // The swell eases out to its full size while the line fades on a curve, so it reads as the
    // block pushing outward rather than a box blinking off.
    const t = Math.min(1, Math.max(0, age / LIFE_TICKS));
    g.scale.setScalar(1 + SWELL * (1 - Math.pow(1 - t, 3)));
    m.opacity = Math.max(0, 1 - t * t);
  });

  return (
    // Hidden until the first frame has placed it on the clock.
    <group ref={group} position={[x, y + height / 2, z]} visible={false}>
      <lineSegments geometry={edges}>
        <lineBasicMaterial
          ref={line}
          attach="material"
          color={color}
          transparent
          opacity={0}
          toneMapped={false}
        />
      </lineSegments>
    </group>
  );
};

export const GrowthEffects: React.FC<GrowthEffectsProps> = ({
  growthEffects,
  convertPosition,
  tick,
  theme = null,
}) => {
  const color = theme?.accentSecondaryHex ?? '#8fdcff';
  return (
    <group>
      {growthEffects.map((effect, index) => (
        <GrowthEffectItem
          key={`${effect.tick}-${index}`}
          effect={effect}
          convertPosition={convertPosition}
          tick={tick}
          color={color}
        />
      ))}
    </group>
  );
};
