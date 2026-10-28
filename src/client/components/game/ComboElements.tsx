import React, { useEffect, useMemo } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import {
  ComboParticles,
  paletteOf,
  ELEMENT_TUNING,
  ELEMENTS,
  heatOf,
  SHAPE,
  type ComboElement,
  type ComboTower,
  type Emit,
} from './factionElements';

/** Something the scene wants the element to do, at a time (performance.now ms). */
export interface ComboBeat {
  kind: 'perfect' | 'tierUp' | 'break' | 'clear';
  at: number;
}

interface ComboElementsProps {
  element: ComboElement;
  /** The tower's colour, as #rrggbb. */
  color: string;
  /** The tower as the scene last saw it; read every frame. */
  tower: React.RefObject<ComboTower>;
  /** Beats the scene has queued; taken off the front as their time comes. */
  beats: React.RefObject<ComboBeat[]>;
}

const vertexShader = /* glsl */ `
  attribute vec3 iPos;
  attribute vec3 iDir;
  attribute vec4 iColor;
  attribute vec4 iParams;
  varying vec2 vUv;
  varying vec4 vColor;
  varying float vShape;
  void main() {
    vUv = uv;
    vColor = iColor;
    vShape = iParams.y;
    float size = iParams.x;
    vec4 a = modelViewMatrix * vec4(iPos, 1.0);
    vec3 p;
    if (vShape > 1.5 && vShape < 3.5) {
      // A line: from the particle along iDir, its width across it on the screen. Across is the
      // line turned a quarter clockwise, so the quad winds like every other and faces the camera.
      vec4 b = modelViewMatrix * vec4(iPos + iDir, 1.0);
      vec2 d = b.xy - a.xy;
      vec2 across = length(d) > 1e-5 ? normalize(vec2(d.y, -d.x)) : vec2(1.0, 0.0);
      p = mix(a.xyz, b.xyz, uv.y) + vec3(across * (uv.x - 0.5) * size, 0.0);
    } else {
      // A shape facing the camera, turned by iParams.z and narrowed by iParams.w (a petal
      // turning over).
      vec2 c = (uv - 0.5) * size;
      c.x *= iParams.w;
      float s = sin(iParams.z);
      float k = cos(iParams.z);
      p = a.xyz + vec3(c.x * k - c.y * s, c.x * s + c.y * k, 0.0);
    }
    gl_Position = projectionMatrix * vec4(p, 1.0);
  }
`;

const fragmentShader = /* glsl */ `
  varying vec2 vUv;
  varying vec4 vColor;
  varying float vShape;
  void main() {
    vec2 q = vUv * 2.0 - 1.0;
    float m = max(abs(q.x), abs(q.y));
    float a;
    if (vShape < 0.5) {
      a = 1.0 - smoothstep(0.7, 1.0, m);
    } else if (vShape < 1.5) {
      a = smoothstep(0.5, 0.66, m) * (1.0 - smoothstep(0.84, 1.0, m));
    } else if (vShape < 2.5) {
      // A streak: hottest at its head, gone at the end of its tail.
      a = (1.0 - smoothstep(0.3, 1.0, abs(q.x))) * (1.0 - vUv.y);
    } else if (vShape < 3.5) {
      a = 1.0 - smoothstep(0.3, 1.0, abs(q.x));
    } else if (vShape < 4.5) {
      float arms = max(
        (1.0 - smoothstep(0.04, 0.24, abs(q.x))) * (1.0 - abs(q.y)),
        (1.0 - smoothstep(0.04, 0.24, abs(q.y))) * (1.0 - abs(q.x))
      );
      a = max(arms * arms, 1.0 - smoothstep(0.0, 0.22, length(q)));
    } else {
      a = 1.0 - smoothstep(0.75, 1.0, abs(q.x) + abs(q.y));
    }
    gl_FragColor = vec4(vColor.rgb, vColor.a * a);
    #include <colorspace_fragment>
  }
`;

interface Buffers {
  iPos: THREE.InstancedBufferAttribute;
  iDir: THREE.InstancedBufferAttribute;
  iColor: THREE.InstancedBufferAttribute;
  iParams: THREE.InstancedBufferAttribute;
}

/** Writes what is alive to the front of the buffers, for one draw of all of it. */
const draw = (
  particles: ComboParticles,
  t: ComboTower,
  geometry: THREE.InstancedBufferGeometry,
  attrs: Buffers
): void => {
  const pos = attrs.iPos.array as Float32Array;
  const dir = attrs.iDir.array as Float32Array;
  const col = attrs.iColor.array as Float32Array;
  const par = attrs.iParams.array as Float32Array;
  let n = 0;
  for (const p of particles.pool) {
    if (!p.alive) continue;
    const life = p.age / p.life;
    const size = p.size0 + (p.size1 - p.size0) * life;
    let alpha = (1 - life) * (p.fadeIn > 0 ? Math.min(1, life / p.fadeIn) : 1);
    if (p.flicker) alpha *= 1 - p.flicker * Math.random();
    pos[n * 3] = p.x;
    pos[n * 3 + 1] = p.y;
    pos[n * 3 + 2] = p.z;
    if (p.shape === SHAPE.SEGMENT) {
      dir[n * 3] = p.dx;
      dir[n * 3 + 1] = p.dy;
      dir[n * 3 + 2] = p.dz;
    } else if (p.shape === SHAPE.STREAK) {
      // Trailing behind it: its velocity, plus its turn round the tower if it has one.
      let vx = p.vx;
      let vz = p.vz;
      if (p.orbit) {
        vx -= p.orbit * (p.z - t.cz);
        vz += p.orbit * (p.x - t.cx);
      }
      dir[n * 3] = -vx * p.tail;
      dir[n * 3 + 1] = -p.vy * p.tail;
      dir[n * 3 + 2] = -vz * p.tail;
    }
    const g = p.glow;
    col[n * 4] = (p.c0[0] + (p.c1[0] - p.c0[0]) * life) * g;
    col[n * 4 + 1] = (p.c0[1] + (p.c1[1] - p.c0[1]) * life) * g;
    col[n * 4 + 2] = (p.c0[2] + (p.c1[2] - p.c0[2]) * life) * g;
    col[n * 4 + 3] = alpha;
    par[n * 4] = size;
    par[n * 4 + 1] = p.shape;
    par[n * 4 + 2] = p.rot;
    par[n * 4 + 3] = p.flip ? Math.cos(p.age * p.flip + p.phase) : 1;
    n++;
  }
  geometry.instanceCount = n;
  for (const attr of Object.values(attrs)) {
    attr.clearUpdateRanges();
    attr.addUpdateRange(0, n * attr.itemSize);
    attr.needsUpdate = true;
  }
};

/**
 * The faction's element round a combo (factionElements.ts): one instanced draw of every particle
 * alive, each a quad the shader cuts into its shape, added over the scene and hidden behind the
 * tower where it passes behind it.
 */
export const ComboElements: React.FC<ComboElementsProps> = ({ element, color, tower, beats }) => {
  const particles = useMemo(() => new ComboParticles(), []);
  const palette = useMemo(() => paletteOf(color), [color]);

  const { geometry, material, mesh, attrs } = useMemo(() => {
    const n = ELEMENT_TUNING.POOL;
    const g = new THREE.InstancedBufferGeometry();
    const quad = new THREE.PlaneGeometry(1, 1);
    g.index = quad.index;
    g.setAttribute('position', quad.getAttribute('position'));
    g.setAttribute('uv', quad.getAttribute('uv'));
    const attrs = {
      iPos: new THREE.InstancedBufferAttribute(new Float32Array(n * 3), 3),
      iDir: new THREE.InstancedBufferAttribute(new Float32Array(n * 3), 3),
      iColor: new THREE.InstancedBufferAttribute(new Float32Array(n * 4), 4),
      iParams: new THREE.InstancedBufferAttribute(new Float32Array(n * 4), 4),
    };
    for (const [name, attr] of Object.entries(attrs)) {
      attr.setUsage(THREE.DynamicDrawUsage);
      g.setAttribute(name, attr);
    }
    g.instanceCount = 0;
    const m = new THREE.ShaderMaterial({
      vertexShader,
      fragmentShader,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      toneMapped: false,
      // Particles have no back; this only keeps a quad from vanishing if it ever winds the
      // other way, which is how every line was once culled unseen.
      side: THREE.DoubleSide,
    });
    const mesh = new THREE.Mesh(g, m);
    mesh.frustumCulled = false;
    mesh.raycast = () => {};
    mesh.renderOrder = 2;
    return { geometry: g, material: m, mesh, attrs };
  }, []);
  useEffect(
    () => () => {
      geometry.dispose();
      material.dispose();
    },
    [geometry, material]
  );

  useFrame((_, delta) => {
    const t = tower.current;
    const queue = beats.current;
    const now = performance.now();
    const dt = Math.min(0.05, Math.max(0, delta));
    const behaviour = ELEMENTS[element];
    const heat = heatOf(t.tier);
    const emit: Emit = {
      tower: t,
      palette,
      heat,
      lo: Math.max(t.from, t.to - ELEMENT_TUNING.REACH),
      spawn: particles.spawn,
    };

    while (queue.length > 0 && queue[0]!.at <= now) {
      const beat = queue.shift()!;
      if (beat.kind === 'clear') particles.clear();
      else if (beat.kind === 'break') behaviour.fizzle(emit, particles.alive());
      else if (beat.kind === 'perfect') behaviour.perfect(emit);
      else behaviour.tierUp(emit);
    }
    if (t.running) behaviour.ambient(emit, dt);
    particles.step(dt, t);

    draw(particles, t, geometry, attrs);
  });

  return <primitive object={mesh} />;
};
