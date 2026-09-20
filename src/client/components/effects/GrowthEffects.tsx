import React, { useEffect, useMemo } from 'react';
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
  currentTick: number;
  theme?: FactionTheme | null | undefined;
}

/** Ticks the flare takes to swell and fade. The simulation keeps an effect around for 60. */
const LIFE_TICKS = 26;
/** How far past the block the outline swells, as a fraction of its size. */
const SWELL = 0.08;

const GrowthEffectItem: React.FC<{
  effect: GrowthEffect;
  convertPosition: (v: number) => number;
  currentTick: number;
  color: string;
}> = ({ effect, convertPosition, currentTick, color }) => {
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

  // Age runs on simulation ticks, so the flare keeps the run's clock.
  const age = currentTick - effect.tick;
  if (age < 0 || age > LIFE_TICKS) return null;

  // The swell eases out to its full size while the line fades on a curve, so it reads as the
  // block pushing outward rather than a box blinking off.
  const t = Math.min(1, Math.max(0, age / LIFE_TICKS));
  const scale = 1 + SWELL * (1 - Math.pow(1 - t, 3));

  return (
    <group position={[x, y + height / 2, z]} scale={scale}>
      <lineSegments geometry={edges}>
        <lineBasicMaterial
          attach="material"
          color={color}
          transparent
          opacity={Math.max(0, 1 - t * t)}
          toneMapped={false}
        />
      </lineSegments>
    </group>
  );
};

export const GrowthEffects: React.FC<GrowthEffectsProps> = ({
  growthEffects,
  convertPosition,
  currentTick,
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
          currentTick={currentTick}
          color={color}
        />
      ))}
    </group>
  );
};
