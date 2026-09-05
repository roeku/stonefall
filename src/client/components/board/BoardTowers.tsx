import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useFrame, useThree, type ThreeEvent } from '@react-three/fiber';
import * as THREE from 'three';
import type { TowerMapEntry } from '../../../shared/types/api';
import {
  BLOCK_BUDGET,
  MOBILE_BLOCK_BUDGET,
  buildBoardInstances,
  type BoardInstancePlan,
  type TowerFootprint,
} from './boardInstancing';

interface BoardTowersProps {
  towers: TowerMapEntry[];
  /** World point the camera is centred on: detail is spent nearest it, and build-in radiates from it. */
  focusX: number;
  focusZ: number;
  /** Session id of the tower being looked at. Everything else steps back while it is set. */
  selectedId?: string | null | undefined;
  /** Step every tower back, e.g. while placing, when the floor is the subject. */
  dimAll?: boolean | undefined;
  onTap?: ((tower: TowerMapEntry, footprint: TowerFootprint) => void) | undefined;
}

/** Rim brightness of the towers that are not the selected one. */
const DIMMED = 0.13;
/** Rim brightness of standing towers while the floor is the subject. */
const STEPPED_BACK = 0.3;

/**
 * Rewrites the mesh's instance colours so the selected tower keeps its colour and every other
 * rim steps back. In a dense city this is what makes the tapped tower findable at all; a halo
 * alone is lost among neighbours.
 */
const recolorForSelection = (
  mesh: THREE.InstancedMesh,
  plan: BoardInstancePlan,
  selectedId: string | null | undefined,
  dimAll: boolean
): void => {
  const attr = mesh.instanceColor;
  if (!attr) return;
  const out = attr.array as Float32Array;
  const selectedIndex =
    selectedId === null || selectedId === undefined
      ? -1
      : plan.footprints.findIndex((f) => f.id === selectedId);
  const dim = dimAll ? STEPPED_BACK : selectedIndex < 0 ? 1 : DIMMED;
  for (let i = 0; i < plan.count; i++) {
    const k = plan.towerOfInstance[i] === selectedIndex ? 1 : dim;
    out[i * 3] = plan.colors[i * 3]! * k;
    out[i * 3 + 1] = plan.colors[i * 3 + 1]! * k;
    out[i * 3 + 2] = plan.colors[i * 3 + 2]! * k;
  }
  attr.needsUpdate = true;
};

/** How far the build-in wave travels per second, in world units. */
const WAVE_SPEED = 500;
/** Longest a tower waits for the wave before building regardless. */
const WAVE_MAX_DELAY = 0.7;

/**
 * When each tower first appeared, by id, plus the clock the shader reads.
 *
 * Kept across plan rebuilds so a tower already standing stays standing when the list is rebuilt
 * around it, and only newcomers animate. One object with methods rather than refs, because the
 * plan is built during render and a ref must not be read there.
 */
class BuildClock {
  readonly uniform = { value: 0 };
  private readonly appearAt = new Map<string, number>();

  tick(now: number): void {
    this.uniform.value = now;
  }

  forgetExcept(live: ReadonlySet<string>): void {
    for (const id of this.appearAt.keys()) {
      if (!live.has(id)) this.appearAt.delete(id);
    }
  }

  appearanceOf(id: string, now: number, distance: number): number {
    const known = this.appearAt.get(id);
    if (known !== undefined) return known;
    const at = now + Math.min(WAVE_MAX_DELAY, distance / WAVE_SPEED);
    this.appearAt.set(id, at);
    return at;
  }
}

/**
 * Every placed tower on the board, as one instanced mesh.
 *
 * Replaces a 1,800-line streaming renderer that batched towers over many frames, grew each block
 * in on a timer proportional to its absolute height, and mounted its meshes lazily. The visible
 * result was towers that appeared truncated for seconds, stacked towers hanging in the air while
 * the tower beneath was still "growing", and on some loads nothing at all. None of that was a
 * rendering limit: the geometry here is a few hundred thousand triangles, which a phone draws in
 * one call.
 *
 * So: one plan, built synchronously when the tower list changes, uploaded once. The only thing
 * animated is a short build-in wave, and it runs on the GPU from a per-instance start time.
 */
export const BoardTowers: React.FC<BoardTowersProps> = ({
  towers,
  focusX,
  focusZ,
  selectedId,
  dimAll = false,
  onTap,
}) => {
  const { size, clock } = useThree();
  const budget = Math.min(size.width, size.height) < 600 ? MOBILE_BLOCK_BUDGET : BLOCK_BUDGET;

  const [buildClock] = useState(() => new BuildClock());

  const plan = useMemo(() => {
    const now = clock.elapsedTime;
    buildClock.forgetExcept(new Set(towers.map((t) => t.sessionId)));
    return buildBoardInstances(towers, { x: focusX, z: focusZ }, budget, (id, distance) =>
      buildClock.appearanceOf(id, now, distance)
    );
  }, [towers, focusX, focusZ, budget, clock, buildClock]);

  const built = useMemo(() => {
    const geometry = new THREE.BoxGeometry(1, 1, 1);
    geometry.setAttribute('aDelay', new THREE.InstancedBufferAttribute(plan.delays, 1));

    const material = new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: false });
    material.onBeforeCompile = (shader) => {
      shader.uniforms.uTime = buildClock.uniform;
      shader.vertexShader = shader.vertexShader
        .replace(
          'void main() {',
          'attribute float aDelay;\nuniform float uTime;\nvarying vec2 vRimUv;\nvoid main() {'
        )
        .replace(
          '#include <begin_vertex>',
          `#include <begin_vertex>
          // Grow from the block's own base, eased, so a tower climbs into place.
          float grow = clamp((uTime - aDelay) * 3.0, 0.0, 1.0);
          grow = grow * grow * (3.0 - 2.0 * grow);
          transformed.y = (transformed.y + 0.5) * grow - 0.5;
          vRimUv = uv;`
        );
      shader.fragmentShader = shader.fragmentShader
        .replace('void main() {', 'varying vec2 vRimUv;\nvoid main() {')
        .replace(
          '#include <color_fragment>',
          `#include <color_fragment>
          // Light only the rim of each face. Face UVs run 0..1, so the distance to the nearest
          // UV border is the distance to a real edge; the diagonal a wireframe would draw is
          // interior and never lights up. fwidth keeps the line about a pixel and a half wide
          // at any distance.
          float dEdge = min(min(vRimUv.x, 1.0 - vRimUv.x), min(vRimUv.y, 1.0 - vRimUv.y));
          float wEdge = fwidth(dEdge) * 1.5;
          float rim = 1.0 - smoothstep(wEdge, wEdge * 2.0, dEdge);
          diffuseColor.rgb *= rim;`
        );
    };
    material.customProgramCacheKey = () => 'board-tower-rim';

    const mesh = new THREE.InstancedMesh(geometry, material, Math.max(1, plan.count));
    mesh.instanceMatrix = new THREE.InstancedBufferAttribute(plan.matrices, 16);
    // A copy, because selection rewrites it in place.
    mesh.instanceColor = new THREE.InstancedBufferAttribute(plan.colors.slice(), 3);
    mesh.count = plan.count;
    // The default bounding sphere is the unit box at the origin, which would cull the whole
    // city the moment the origin left the frame.
    mesh.frustumCulled = false;
    return { mesh, geometry, material };
  }, [plan, buildClock]);

  useEffect(
    () => () => {
      built.geometry.dispose();
      built.material.dispose();
      built.mesh.dispose();
    },
    [built]
  );

  useFrame((state) => {
    buildClock.tick(state.clock.elapsedTime);
  });

  useLayoutEffect(() => {
    recolorForSelection(built.mesh, plan, selectedId, dimAll);
  }, [built, plan, selectedId, dimAll]);

  // One invisible box per tower for tapping. Raycasting the block mesh itself would test every
  // block on every pointer event; a few hundred tower-sized boxes is nothing.
  const hitRef = useRef<THREE.InstancedMesh>(null);
  useLayoutEffect(() => {
    const hit = hitRef.current;
    if (!hit) return;
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const p = new THREE.Vector3();
    const s = new THREE.Vector3();
    plan.footprints.forEach((f, i) => {
      p.set(f.centerX, f.centerY, f.centerZ);
      // Padded sideways so a thin spire is still tappable with a thumb.
      s.set(Math.max(3, f.width + 1.5), Math.max(3, f.height), Math.max(3, f.depth + 1.5));
      m.compose(p, q, s);
      hit.setMatrixAt(i, m);
    });
    hit.count = plan.footprints.length;
    hit.instanceMatrix.needsUpdate = true;
  }, [plan]);

  const handleTap = (e: ThreeEvent<MouseEvent>) => {
    if (!onTap || typeof e.instanceId !== 'number') return;
    const footprint = plan.footprints[e.instanceId];
    const tower = footprint ? towers[footprint.index] : undefined;
    if (!footprint || !tower) return;
    e.stopPropagation();
    onTap(tower, footprint);
  };

  return (
    <group name="board-towers">
      <primitive object={built.mesh} />
      {onTap && plan.footprints.length > 0 && (
        <instancedMesh
          key={`hit-${plan.footprints.length}`}
          ref={hitRef}
          args={[undefined, undefined, plan.footprints.length]}
          frustumCulled={false}
          onClick={handleTap}
        >
          <boxGeometry args={[1, 1, 1]} />
          <meshBasicMaterial transparent opacity={0} depthWrite={false} colorWrite={false} />
        </instancedMesh>
      )}
    </group>
  );
};
