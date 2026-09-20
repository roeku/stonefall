import React, { useEffect, useMemo, useState } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { DEFAULT_TOWER_GRID_SIZE } from '../../../shared/types/towerPlacement';
import type { Tile } from './tilePlan';
import { GROUND_Y } from './BoardFloor';

/**
 * The map's colour: one flat tile per held cell, drawn on the floor.
 *
 * A tile is a square inset from the cell's grid lines with a faint fill and a brighter edge,
 * additively blended so it reads as light on the floor rather than paint on it. Towers stand on
 * top; the tile is what says whose ground they stand on, and what the map is made of once the
 * camera is far enough that towers are needles.
 */
interface TileLayerProps {
  tiles: readonly Tile[];
  /** Fill brightness inside the tile. */
  fill: number;
  /** Edge brightness. */
  edge: number;
  /** Set for the reach layer: breathes, so it reads as possibility rather than ownership. */
  breathe?: boolean | undefined;
  y?: number | undefined;
}

const INSET = 0.7;

const createTileMaterial = (
  fill: number,
  edge: number,
  time: { value: number },
  breathe: boolean
) => {
  const material = new THREE.MeshBasicMaterial({
    color: 0xffffff,
    toneMapped: false,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = time;
    shader.vertexShader = shader.vertexShader
      .replace('void main() {', 'varying vec2 vTileUv;\nvoid main() {')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\n vTileUv = uv;');
    shader.fragmentShader = shader.fragmentShader
      .replace('void main() {', 'varying vec2 vTileUv;\nuniform float uTime;\nvoid main() {')
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
        float dEdge = min(min(vTileUv.x, 1.0 - vTileUv.x), min(vTileUv.y, 1.0 - vTileUv.y));
        float wEdge = fwidth(dEdge) * 1.6;
        float rim = 1.0 - smoothstep(wEdge, wEdge * 2.6, dEdge);
        float pulse = ${breathe ? '0.8 + 0.2 * sin(uTime * 2.2)' : '1.0'};
        float a = (${fill.toFixed(3)} + rim * ${edge.toFixed(3)}) * pulse;
        diffuseColor.rgb *= a;
        diffuseColor.a = 1.0;`
      );
  };
  material.customProgramCacheKey = () => `tile-${fill}-${edge}-${breathe}`;
  return material;
};

/** The clock the breathing layer reads. A class, so a frame may write it without a re-render. */
class TileClock {
  readonly uniform = { value: 0 };
  tick(now: number): void {
    this.uniform.value = now;
  }
}

const TileLayer: React.FC<TileLayerProps> = ({
  tiles,
  fill,
  edge,
  breathe = false,
  y = GROUND_Y + 0.03,
}) => {
  const [clock] = useState(() => new TileClock());
  const time = clock.uniform;
  const built = useMemo(() => {
    const size = DEFAULT_TOWER_GRID_SIZE - INSET;
    const geometry = new THREE.PlaneGeometry(size, size);
    geometry.rotateX(-Math.PI / 2);
    const material = createTileMaterial(fill, edge, time, breathe);
    const mesh = new THREE.InstancedMesh(geometry, material, Math.max(1, tiles.length));
    const m = new THREE.Matrix4();
    const colors = new Float32Array(Math.max(1, tiles.length) * 3);
    tiles.forEach((t, i) => {
      m.makeTranslation(t.worldX, y, t.worldZ);
      mesh.setMatrixAt(i, m);
      colors[i * 3] = t.rgb.r;
      colors[i * 3 + 1] = t.rgb.g;
      colors[i * 3 + 2] = t.rgb.b;
    });
    mesh.instanceColor = new THREE.InstancedBufferAttribute(colors, 3);
    mesh.count = tiles.length;
    mesh.frustumCulled = false;
    mesh.renderOrder = -50;
    return { mesh, geometry, material };
  }, [tiles, fill, edge, breathe, y, time]);

  useEffect(
    () => () => {
      built.geometry.dispose();
      built.material.dispose();
      built.mesh.dispose();
    },
    [built]
  );

  useFrame((state) => {
    clock.tick(state.clock.elapsedTime);
  });

  if (tiles.length === 0) return null;
  return <primitive object={built.mesh} raycast={() => null} />;
};

interface TerritoryTilesProps {
  keeps: readonly Tile[];
  land: readonly Tile[];
  reach: readonly Tile[];
  /** Brighter reach while a cell is being chosen. */
  emphasiseReach?: boolean | undefined;
}

export const TerritoryTiles: React.FC<TerritoryTilesProps> = ({
  keeps,
  land,
  reach,
  emphasiseReach = false,
}) => (
  <group name="territory">
    <TileLayer tiles={keeps} fill={0.16} edge={0.55} />
    <TileLayer tiles={land} fill={0.11} edge={0.5} y={GROUND_Y + 0.025} />
    <TileLayer
      tiles={reach}
      fill={emphasiseReach ? 0.09 : 0.035}
      edge={emphasiseReach ? 0.3 : 0.12}
      breathe
      y={GROUND_Y + 0.02}
    />
  </group>
);
