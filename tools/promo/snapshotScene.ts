/**
 * Rebuilds a frame of the live game (snapshot.mjs) with the promo pipeline's own copies of the
 * game's materials. Rendered at the snapshot's size and pixel ratio, it should match the
 * snapshot's screenshot; where it does not, the pipeline has drifted from the game.
 */
import * as THREE from 'three';
import { createRimMaterial } from '../../src/client/components/board/rimMaterial';
import {
  attachBodyFlash,
  attachRimFlash,
  createFlashUniforms,
  createStoneUniforms,
} from '../../src/client/components/game/blockFlash';
import { createFloor, tileMaterial, type Pipeline } from './pipeline';

type Vec = number[];
interface SnapMaterial {
  type: string;
  key: string | null;
  color: Vec | null;
  emissive: Vec | null;
  emissiveIntensity?: number;
  roughness?: number;
  metalness?: number;
  opacity: number;
  transparent: boolean;
  blending: THREE.Blending;
  side: THREE.Side;
  depthWrite: boolean;
  depthTest: boolean;
  toneMapped: boolean;
  vertexColors: boolean;
  size?: number;
  sizeAttenuation?: boolean;
  uniforms: Record<string, unknown>;
  vertexShader?: string;
  fragmentShader?: string;
}
interface SnapObject {
  kind: string;
  matrixWorld: Vec;
  renderOrder: number;
  frustumCulled: boolean;
  geometry: {
    type: string;
    parameters: Record<string, unknown> | null;
    attributes: Record<string, { itemSize: number; array: Vec; instanced: boolean }>;
  };
  material: SnapMaterial;
  count?: number;
  instanceMatrix?: Vec;
  instanceColor?: Vec | null;
}
export interface Snapshot {
  camera: { matrixWorld: Vec; fov: number; near: number; far: number; zoom: number };
  fog: { color: Vec; near: number; far: number } | null;
  background: Vec | null;
  objects: SnapObject[];
}

const uniformValue = (v: unknown): unknown => {
  if (v && typeof v === 'object') {
    const o = v as Record<string, Vec>;
    if (o.color) return new THREE.Color().setRGB(o.color[0]!, o.color[1]!, o.color[2]!);
    if (o.v3) return new THREE.Vector3(o.v3[0], o.v3[1], o.v3[2]);
    if (o.v2) return new THREE.Vector2(o.v2[0], o.v2[1]);
  }
  return v;
};

const linear = (c: Vec | null | undefined, fallback = [1, 1, 1]) =>
  new THREE.Color().setRGB(...((c ?? fallback) as [number, number, number]));

const boxFrom = (p: Record<string, unknown> | null) =>
  new THREE.BoxGeometry(Number(p?.width ?? 1), Number(p?.height ?? 1), Number(p?.depth ?? 1));

const bufferFrom = (g: SnapObject['geometry']) => {
  const geometry = new THREE.BufferGeometry();
  for (const [name, a] of Object.entries(g.attributes)) {
    if (a.instanced) continue;
    geometry.setAttribute(name, new THREE.Float32BufferAttribute(a.array, a.itemSize));
  }
  return geometry;
};

const place = (o: THREE.Object3D, s: SnapObject) => {
  o.matrixAutoUpdate = false;
  o.matrix.fromArray(s.matrixWorld);
  o.matrixWorldNeedsUpdate = true;
  o.renderOrder = s.renderOrder;
  o.frustumCulled = s.frustumCulled;
};

const basics = (m: THREE.Material, s: SnapMaterial) => {
  m.opacity = s.opacity;
  m.transparent = s.transparent;
  m.blending = s.blending;
  m.side = s.side;
  m.depthWrite = s.depthWrite;
  m.depthTest = s.depthTest;
  (m as THREE.MeshBasicMaterial).toneMapped = s.toneMapped;
};

/** Builds every object of the snapshot into the pipeline's scene and sets its camera. */
export const buildSnapshot = (p: Pipeline, snap: Snapshot): string[] => {
  const notes: string[] = [];
  const { scene, camera } = p;
  if (snap.background) scene.background = linear(snap.background);
  scene.fog = snap.fog ? new THREE.Fog(linear(snap.fog.color), snap.fog.near, snap.fog.far) : null;

  for (const s of snap.objects) {
    const m = s.material;
    const key = m.key ?? '';
    const u = m.uniforms;

    if (m.type === 'ShaderMaterial' && 'cellSize' in u) {
      const floor = createFloor({ fadeDistance: Number(u.fadeDistance) });
      for (const [k, v] of Object.entries(u)) {
        const target = floor.material.uniforms[k];
        if (target) target.value = uniformValue(v);
      }
      place(floor.mesh, s);
      scene.add(floor.mesh);
      continue;
    }

    if (m.type === 'ShaderMaterial') {
      // A shader the game wrote inline (the plot beacon): rebuilt from its own source.
      const material = new THREE.ShaderMaterial({
        vertexShader: m.vertexShader!,
        fragmentShader: m.fragmentShader!,
        uniforms: Object.fromEntries(
          Object.entries(u).map(([k, v]) => [k, { value: uniformValue(v) }])
        ),
      });
      basics(material, m);
      const g = s.geometry;
      const geometry =
        g.type === 'CylinderGeometry'
          ? new THREE.CylinderGeometry(
              Number(g.parameters!.radiusTop),
              Number(g.parameters!.radiusBottom),
              Number(g.parameters!.height),
              Number(g.parameters!.radialSegments),
              Number(g.parameters!.heightSegments),
              Boolean(g.parameters!.openEnded)
            )
          : g.type === 'PlaneGeometry'
            ? new THREE.PlaneGeometry(Number(g.parameters!.width), Number(g.parameters!.height))
            : bufferFrom(g);
      const mesh = new THREE.Mesh(geometry, material);
      place(mesh, s);
      scene.add(mesh);
      notes.push(`shader ${g.type}`);
      continue;
    }

    if (key.startsWith('block-body-flash')) {
      const flash = createFlashUniforms();
      const stone = createStoneUniforms();
      for (const [k, v] of Object.entries(u)) {
        const target =
          (flash as unknown as Record<string, { value: unknown }>)[k] ??
          (stone as unknown as Record<string, { value: unknown }>)[k];
        if (target) target.value = uniformValue(v);
      }
      const material = new THREE.MeshStandardMaterial({
        color: linear(m.color),
        emissive: linear(m.emissive),
        emissiveIntensity: m.emissiveIntensity ?? 0,
        roughness: m.roughness ?? 1,
        metalness: m.metalness ?? 0,
        toneMapped: m.toneMapped,
      });
      basics(material, m);
      attachBodyFlash(material, flash, key.endsWith('stone') ? stone : undefined);
      const mesh = new THREE.Mesh(boxFrom(s.geometry.parameters), material);
      place(mesh, s);
      scene.add(mesh);
      continue;
    }

    if (key === 'block-rim-flash') {
      const flash = createFlashUniforms();
      for (const [k, v] of Object.entries(u)) {
        const target = (flash as unknown as Record<string, { value: unknown }>)[k];
        if (target) target.value = uniformValue(v);
      }
      const material = new THREE.LineBasicMaterial({ color: linear(m.color) });
      basics(material, m);
      attachRimFlash(material, flash);
      const source = (
        s.geometry.parameters?.geometry as { parameters: Record<string, unknown> } | undefined
      )?.parameters;
      const box = boxFrom(source ?? null);
      const lines = new THREE.LineSegments(new THREE.EdgesGeometry(box), material);
      place(lines, s);
      scene.add(lines);
      continue;
    }

    if (key.startsWith('rim-')) {
      // rim-{grow|static}-{compress|flat}-{stones|plain}-{intensity}
      const [, grow, compress, stones, intensity] = key.split('-');
      const material = createRimMaterial({
        grow: grow === 'grow' ? { time: { value: Number(u.uTime ?? 1e6) } } : undefined,
        compress: compress === 'compress' ? { value: Number(u.uCompress ?? 0) } : undefined,
        stones: stones === 'stones',
        intensity: Number(intensity),
      });
      const geometry = new THREE.BoxGeometry(1, 1, 1);
      for (const [name, a] of Object.entries(s.geometry.attributes)) {
        if (a.instanced)
          geometry.setAttribute(
            name,
            new THREE.InstancedBufferAttribute(new Float32Array(a.array), a.itemSize)
          );
      }
      const mesh = new THREE.InstancedMesh(geometry, material, Math.max(1, s.count ?? 1));
      mesh.instanceMatrix.array.set(s.instanceMatrix ?? []);
      if (s.instanceColor)
        mesh.instanceColor = new THREE.InstancedBufferAttribute(
          new Float32Array(s.instanceColor),
          3
        );
      mesh.count = s.count ?? 0;
      place(mesh, s);
      scene.add(mesh);
      continue;
    }

    if (key.startsWith('tile-')) {
      const [, fill, edge, breathe] = key.split('-');
      const material = tileMaterial(
        Number(fill),
        Number(edge),
        { value: Number(u.uTime ?? 0) },
        breathe === 'true'
      );
      const size = Number(s.geometry.parameters?.width ?? 7.3);
      const geometry = new THREE.PlaneGeometry(size, size).rotateX(-Math.PI / 2);
      const mesh = new THREE.InstancedMesh(geometry, material, Math.max(1, s.count ?? 1));
      mesh.instanceMatrix.array.set(s.instanceMatrix ?? []);
      if (s.instanceColor)
        mesh.instanceColor = new THREE.InstancedBufferAttribute(
          new Float32Array(s.instanceColor),
          3
        );
      mesh.count = s.count ?? 0;
      place(mesh, s);
      scene.add(mesh);
      continue;
    }

    if (s.kind === 'InstancedMesh' && m.opacity === 0) continue; // the board's invisible hit boxes

    if (s.kind === 'Mesh' && m.type === 'MeshBasicMaterial') {
      const material = new THREE.MeshBasicMaterial({ color: linear(m.color) });
      basics(material, m);
      const mesh = new THREE.Mesh(
        s.geometry.type === 'BoxGeometry' ? boxFrom(s.geometry.parameters) : bufferFrom(s.geometry),
        material
      );
      place(mesh, s);
      scene.add(mesh);
      continue;
    }

    if (s.kind === 'Points') {
      const material = new THREE.PointsMaterial({
        color: linear(m.color),
        size: m.size ?? 1,
        sizeAttenuation: m.sizeAttenuation ?? true,
        vertexColors: m.vertexColors,
      });
      basics(material, m);
      const points = new THREE.Points(bufferFrom(s.geometry), material);
      place(points, s);
      scene.add(points);
      continue;
    }

    if (s.kind === 'LineLoop' || s.kind === 'Line' || s.kind === 'LineSegments') {
      const material = new THREE.LineBasicMaterial({ color: linear(m.color) });
      basics(material, m);
      const Ctor =
        s.kind === 'LineLoop'
          ? THREE.LineLoop
          : s.kind === 'Line'
            ? THREE.Line
            : THREE.LineSegments;
      const line = new Ctor(bufferFrom(s.geometry), material);
      place(line, s);
      scene.add(line);
      continue;
    }

    notes.push(`skipped ${s.kind} ${m.type} ${key}`);
  }

  const mw = new THREE.Matrix4().fromArray(snap.camera.matrixWorld);
  mw.decompose(camera.position, camera.quaternion, camera.scale);
  camera.fov = snap.camera.fov;
  camera.near = snap.camera.near;
  camera.far = snap.camera.far;
  camera.zoom = snap.camera.zoom;
  camera.updateProjectionMatrix();
  camera.updateMatrixWorld(true);
  return notes;
};
