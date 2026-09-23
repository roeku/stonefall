import React, { useEffect, useMemo, useState } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import type { TowerMapEntry } from '../../../shared/types/api';
import { factionHex } from '../../../shared/types/factions';
import { DEFAULT_CONFIG } from '../../../shared/simulation/types';
import { GROUND_Y } from './BoardFloor';
import { hexToRgb, towerBox } from './boardInstancing';
import { createRimMaterial } from './rimMaterial';

/**
 * A tower coming down.
 *
 * When a take lands, or a player changes sides and everything they stood up goes with it, the
 * tower is already gone from the board data; without this it would blink out, and the biggest
 * thing that can happen on the map would happen with no motion at all. So its last known
 * geometry is kept for a couple of seconds and demolished: it shudders and flares, the base
 * gives way and bursts outward, the column above drops into it and breaks into its blocks, the
 * blocks bounce, scatter and settle as rubble, dust rolls out across the tiles, and the rubble
 * sinks into the floor while the winner rises where it stood.
 *
 * Blocks are simulated on the CPU, a few hundred at most per tower (a thousand-block spire is
 * broken into chunks of several blocks), and drawn as one instanced mesh per tower in the same
 * rim material as the board, squashed by the same height curve, so a tower felled on the map
 * falls from the height it was drawn at rather than from its true height.
 */

export interface Crumble {
  key: string;
  entry: TowerMapEntry;
  /** performance.now() when it began. */
  at: number;
}

/** How long a crumble takes from first shudder to the rubble gone, ms. */
export const CRUMBLE_MS = 2700;

/**
 * Most pieces one tower breaks into. Past this, neighbouring blocks break away together. High
 * enough that most towers break into exactly the blocks they are drawn with: a merged piece has
 * half the glowing edges, and the tower visibly changed character the instant it began to go.
 */
const MAX_CHUNKS = 400;
/** The shudder before it goes, seconds. */
const SHUDDER = 0.18;
/** How long the top takes to reach the ground once it goes, seconds, whatever the height. */
const FALL_SECONDS = 0.95;
/** When the rubble starts to sink, seconds. */
const SINK_AT = 1.75;
const DUST = 56;
const FIXED = 1000;
const BLOCK_H = DEFAULT_CONFIG.BLOCK_HEIGHT / FIXED;
const WHITE = new THREE.Color('#ffffff');

// Scratch objects for the frame loop, so a collapse allocates nothing per frame.
const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
const _p = new THREE.Vector3();
const _s = new THREE.Vector3();
const _c = new THREE.Color();

/** A small deterministic generator, so a tower breaks the same way on every screen. */
const seeded = (key: string): (() => number) => {
  let h = 2166136261;
  for (let i = 0; i < key.length; i++) h = Math.imul(h ^ key.charCodeAt(i), 16777619);
  let a = h >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};

interface Piece {
  x: number;
  y: number;
  z: number;
  w: number;
  h: number;
  d: number;
  vx: number;
  vy: number;
  vz: number;
  rx: number;
  ry: number;
  rz: number;
  wx: number;
  wy: number;
  wz: number;
  /** Seconds after the shudder this piece lets go. */
  delay: number;
  bounces: number;
  resting: boolean;
  /** 0 at the base, 1 at the top. */
  u: number;
}

interface Mote {
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  /** Seconds after the crumble began that it appears. */
  born: number;
  life: number;
}

interface Plan {
  pieces: Piece[];
  dust: Mote[];
  gravity: number;
  /** Scales every kick, so a spire's rubble spreads as far as its height suggests. */
  scale: number;
  color: THREE.Color;
}

/** Break a tower into pieces and give each one its start. */
const planCollapse = (entry: TowerMapEntry): Plan => {
  const rnd = seeded(entry.sessionId);
  const baseY = (entry.stackBaseY ?? 0) / FIXED;

  // The blocks, bottom first. A tower drawn as a silhouette has no blocks, only a height; it
  // breaks into full-width slabs of block height, which is what it would have been.
  type Slab = { x: number; y: number; z: number; w: number; h: number; d: number };
  let slabs: Slab[] = entry.towerBlocks
    .filter((b) => Number.isFinite(b.y) && b.width > 0 && b.height > 0)
    .map((b) => ({
      x: b.x / FIXED,
      y: b.y / FIXED,
      z: (b.z ?? 0) / FIXED,
      w: b.width / FIXED,
      h: b.height / FIXED,
      d: (b.depth ?? b.width) / FIXED,
    }))
    .sort((a, b) => a.y - b.y);
  if (slabs.length === 0) {
    const box = towerBox(undefined, entry.height);
    if (box) {
      const n = Math.max(1, Math.round((box.maxY - box.minY) / BLOCK_H));
      const w = box.maxX - box.minX;
      slabs = Array.from({ length: n }, (_, i) => ({
        x: 0,
        y: i * BLOCK_H,
        z: 0,
        w,
        h: BLOCK_H,
        d: w,
      }));
    }
  }

  // Neighbouring blocks break away together once there are too many to throw one by one.
  const per = Math.max(1, Math.ceil(slabs.length / MAX_CHUNKS));
  const chunks: Slab[] = [];
  for (let i = 0; i < slabs.length; i += per) {
    const group = slabs.slice(i, i + per);
    const bottom = group[0]!.y;
    const last = group[group.length - 1]!;
    chunks.push({
      x: group.reduce((s, b) => s + b.x, 0) / group.length,
      y: bottom,
      z: group.reduce((s, b) => s + b.z, 0) / group.length,
      w: Math.max(...group.map((b) => b.w)),
      h: last.y + last.h - bottom,
      d: Math.max(...group.map((b) => b.d)),
    });
  }

  const highest = chunks[chunks.length - 1];
  const top = highest ? baseY + highest.y + highest.h : 1;
  const gravity = Math.max(30, (2 * top) / (FALL_SECONDS * FALL_SECONDS));
  const scale = Math.min(4, Math.max(0.7, Math.sqrt(top / 24)));
  // The column leans one way as it goes, so it reads as a tower falling, not a lift descending.
  const lean = rnd() * Math.PI * 2;
  const leanX = Math.cos(lean);
  const leanZ = Math.sin(lean);

  const pieces: Piece[] = chunks.map((c, i) => {
    const u = chunks.length > 1 ? i / (chunks.length - 1) : 0;
    const out = rnd() * Math.PI * 2;
    const base = u < 0.14;
    const burst = base ? (4 + rnd() * 7) * scale : (0.4 + rnd() * 1.2) * scale;
    const drift = (1 - (base ? 1 : 0)) * u * 2.2 * scale;
    return {
      x: c.x,
      y: baseY + c.y + c.h / 2,
      z: c.z,
      w: c.w,
      h: c.h,
      d: c.d,
      vx: Math.cos(out) * burst + leanX * drift,
      vy: base ? 3 + rnd() * 5 : 0,
      vz: Math.sin(out) * burst + leanZ * drift,
      rx: 0,
      ry: 0,
      rz: 0,
      wx: (rnd() - 0.5) * (base ? 9 : 4),
      wy: (rnd() - 0.5) * 3,
      wz: (rnd() - 0.5) * (base ? 9 : 4),
      delay: base ? 0 : 0.04 + (1 - u) * 0.05 + rnd() * 0.05,
      bounces: 0,
      resting: false,
      u,
    };
  });

  // Two rolls of dust: one as the base goes, a bigger one as the column lands in it.
  const width = chunks[0]?.w ?? 8;
  const dust: Mote[] = Array.from({ length: DUST }, (_, i) => {
    const second = i >= DUST * 0.4;
    const a = rnd() * Math.PI * 2;
    const r = width * (0.45 + rnd() * 0.3);
    // Fast enough to roll out past the heap: dust that settles inside the rubble is never seen.
    const speed = (second ? 14 + rnd() * 14 : 9 + rnd() * 9) * Math.sqrt(scale);
    return {
      x: Math.cos(a) * r,
      y: 0.4 + rnd() * 1.2,
      z: Math.sin(a) * r,
      vx: Math.cos(a) * speed,
      vy: 1.5 + rnd() * (second ? 6 : 3),
      vz: Math.sin(a) * speed,
      born: SHUDDER + (second ? FALL_SECONDS * 0.8 : 0.05) + rnd() * 0.12,
      life: 1.1 + rnd() * 0.6,
    };
  });

  // The same raw channels the standing towers are drawn with (see `rimColorFor`). Parsing the hex
  // through THREE.Color converts it to linear first, and the tower turned a deeper, bluer colour
  // the instant it started to fall.
  const rgb = hexToRgb(factionHex(entry.faction ?? null));
  return { pieces, dust, gravity, scale, color: new THREE.Color(rgb.r, rgb.g, rgb.b) };
};

/** A soft round sprite for the dust, drawn once. */
let dustSprite: THREE.Texture | null = null;
const getDustSprite = (): THREE.Texture => {
  if (dustSprite) return dustSprite;
  const size = 64;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
    g.addColorStop(0, 'rgba(255,255,255,1)');
    g.addColorStop(0.35, 'rgba(255,255,255,0.45)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, size, size);
  }
  dustSprite = new THREE.CanvasTexture(canvas);
  return dustSprite;
};

/** The running state of one collapse, advanced by the frame loop. A class, so frames may write. */
class Collapse {
  private last = 0;
  constructor(
    readonly plan: Plan,
    readonly startedAt: number
  ) {}

  /** Advance to `now` (ms), writing instance transforms and colours, and the dust. */
  step(now: number, mesh: THREE.InstancedMesh, dust: THREE.Points, dustColor: THREE.Color): void {
    const t = (now - this.startedAt) / 1000;
    const dt = Math.min(1 / 30, Math.max(0, t - this.last));
    this.last = t;
    const { pieces, gravity, scale, color } = this.plan;
    const colors = mesh.instanceColor!.array as Float32Array;

    const sink = t > SINK_AT ? (t - SINK_AT) * (t - SINK_AT) * 14 : 0;
    const fade = t > SINK_AT ? Math.max(0, 1 - (t - SINK_AT) / (CRUMBLE_MS / 1000 - SINK_AT)) : 1;

    pieces.forEach((piece, i) => {
      const local = t - SHUDDER - piece.delay;
      let jitterX = 0;
      let jitterZ = 0;
      if (local < 0) {
        // Standing, shuddering: the whole tower trembles harder toward the moment it goes.
        const k = Math.min(1, t / SHUDDER);
        jitterX = Math.sin(t * 95 + piece.u * 7) * 0.14 * k * scale;
        jitterZ = Math.cos(t * 83 + piece.u * 5) * 0.14 * k * scale;
      } else if (!piece.resting) {
        piece.vy -= gravity * dt;
        piece.x += piece.vx * dt;
        piece.y += piece.vy * dt;
        piece.z += piece.vz * dt;
        piece.rx += piece.wx * dt;
        piece.ry += piece.wy * dt;
        piece.rz += piece.wz * dt;
        const floor = GROUND_Y + Math.min(piece.h, piece.w, piece.d) / 2;
        if (piece.y <= floor) {
          piece.y = floor;
          const impact = Math.abs(piece.vy);
          if (piece.bounces < 2 && impact > 3) {
            piece.bounces += 1;
            piece.vy = Math.min(impact * 0.3, 7 * scale);
            // Landing in the heap throws it outward from the tower's foot.
            const len = Math.hypot(piece.x, piece.z) || 1;
            const kick = Math.min(6, impact * 0.08) * scale;
            piece.vx = piece.vx * 0.55 + (piece.x / len) * kick;
            piece.vz = piece.vz * 0.55 + (piece.z / len) * kick;
            piece.wx *= 0.6;
            piece.wz *= 0.6;
          } else {
            piece.resting = true;
            piece.vy = 0;
          }
        }
      } else {
        // Rubble slides to a stop.
        const drag = Math.max(0, 1 - 5 * dt);
        piece.vx *= drag;
        piece.vz *= drag;
        piece.wx *= drag;
        piece.wy *= drag;
        piece.wz *= drag;
        piece.x += piece.vx * dt;
        piece.z += piece.vz * dt;
        piece.rx += piece.wx * dt;
        piece.rz += piece.wz * dt;
      }

      _p.set(piece.x + jitterX, piece.y - sink, piece.z + jitterZ);
      _q.setFromEuler(_e.set(piece.rx, piece.ry, piece.rz));
      _s.set(piece.w, piece.h, piece.d);
      _m.compose(_p, _q, _s);
      mesh.setMatrixAt(i, _m);

      // Flares white as it goes, cools to its colour as it falls, dims as rubble, then fades.
      // Already part lit on the first frame, so the hand-over from the standing tower is a flare
      // rather than a flicker.
      const flare =
        local < 0
          ? 0.35 + 0.4 * Math.min(1, t / SHUDDER)
          : 0.75 * Math.exp(-Math.max(0, local) * 3.2);
      const rest = piece.resting ? 0.55 : 1;
      _c.copy(color)
        .lerp(WHITE, flare)
        .multiplyScalar(rest * fade);
      colors[i * 3] = _c.r;
      colors[i * 3 + 1] = _c.g;
      colors[i * 3 + 2] = _c.b;
    });
    mesh.instanceMatrix.needsUpdate = true;
    mesh.instanceColor!.needsUpdate = true;

    const positions = dust.geometry.getAttribute('position') as THREE.BufferAttribute;
    const alphas = dust.geometry.getAttribute('aAlpha') as THREE.BufferAttribute;
    this.plan.dust.forEach((mote, i) => {
      const age = t - mote.born;
      if (age < 0 || age > mote.life) {
        positions.setXYZ(i, 0, -1000, 0);
        alphas.setX(i, 0);
        return;
      }
      const drag = Math.exp(-age * 1.7);
      const travel = (1 - drag) / 1.7;
      positions.setXYZ(
        i,
        mote.x + mote.vx * travel,
        mote.y + mote.vy * travel,
        mote.z + mote.vz * travel
      );
      const k = age / mote.life;
      alphas.setX(i, (1 - k) * (1 - k) * 0.8);
    });
    positions.needsUpdate = true;
    alphas.needsUpdate = true;
    const dustMaterial = dust.material as THREE.ShaderMaterial;
    dustMaterial.uniforms.uColor!.value.copy(dustColor);
  }
}

const dustMaterialFor = (scale: number): THREE.ShaderMaterial =>
  new THREE.ShaderMaterial({
    uniforms: {
      uColor: { value: new THREE.Color('#ffffff') },
      uMap: { value: getDustSprite() },
      uSize: { value: 15 * Math.sqrt(scale) },
    },
    vertexShader: `
      attribute float aAlpha;
      uniform float uSize;
      varying float vAlpha;
      void main() {
        vAlpha = aAlpha;
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        // Each puff swells as it thins, so the dust reads as rolling out rather than blinking.
        gl_PointSize = uSize * (300.0 / max(1.0, -mv.z)) * (1.8 - aAlpha);
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: `
      uniform vec3 uColor;
      uniform sampler2D uMap;
      varying float vAlpha;
      void main() {
        float a = texture2D(uMap, gl_PointCoord).a * vAlpha;
        gl_FragColor = vec4(uColor * a, a);
      }`,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    toneMapped: false,
  });

const Collapsing: React.FC<{ crumble: Crumble; compress: { value: number } }> = ({
  crumble,
  compress,
}) => {
  const { entry } = crumble;
  const [collapse] = useState(() => new Collapse(planCollapse(entry), crumble.at));
  const plan = collapse.plan;

  const built = useMemo(() => {
    const geometry = new THREE.BoxGeometry(1, 1, 1);
    const material = createRimMaterial({ compress });
    const count = Math.max(1, plan.pieces.length);
    const mesh = new THREE.InstancedMesh(geometry, material, count);
    mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(count * 3), 3);
    mesh.count = plan.pieces.length;
    mesh.frustumCulled = false;

    const dustGeometry = new THREE.BufferGeometry();
    dustGeometry.setAttribute(
      'position',
      new THREE.BufferAttribute(new Float32Array(plan.dust.length * 3).fill(-1000), 3)
    );
    dustGeometry.setAttribute(
      'aAlpha',
      new THREE.BufferAttribute(new Float32Array(plan.dust.length), 1)
    );
    const dustMaterial = dustMaterialFor(plan.scale);
    const dust = new THREE.Points(dustGeometry, dustMaterial);
    dust.frustumCulled = false;
    const dustColor = plan.color.clone().lerp(WHITE, 0.55);
    return { mesh, geometry, material, dust, dustGeometry, dustMaterial, dustColor };
  }, [plan, compress]);

  useEffect(
    () => () => {
      built.geometry.dispose();
      built.material.dispose();
      built.mesh.dispose();
      built.dustGeometry.dispose();
      built.dustMaterial.dispose();
    },
    [built]
  );

  useFrame(() => {
    collapse.step(performance.now(), built.mesh, built.dust, built.dustColor);
  });

  return (
    <group position={[entry.worldX ?? 0, 0, entry.worldZ ?? 0]}>
      <primitive object={built.mesh} raycast={() => null} />
      <primitive object={built.dust} raycast={() => null} />
    </group>
  );
};

/** The squash, eased toward its target the way the standing towers' is. */
class Squash {
  readonly uniform: { value: number };
  constructor(start: number) {
    this.uniform = { value: start };
  }
  ease(target: number, dt: number): void {
    const t = 1 - Math.exp(-5 * dt);
    this.uniform.value += (target - this.uniform.value) * t;
    if (Math.abs(this.uniform.value - target) < 0.002) this.uniform.value = target;
  }
}

interface CrumblingTowersProps {
  crumbles: readonly Crumble[];
  /** The standing towers' height squash, 0 to 1, so rubble falls from where towers are drawn. */
  compress: number;
}

export const CrumblingTowers: React.FC<CrumblingTowersProps> = ({ crumbles, compress }) => {
  const [squash] = useState(() => new Squash(compress));
  useFrame((_, delta) => squash.ease(compress, Math.min(delta, 0.1)));
  return (
    <group name="crumbling">
      {crumbles.map((c) => (
        <Collapsing key={c.key} crumble={c} compress={squash.uniform} />
      ))}
    </group>
  );
};
