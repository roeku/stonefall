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
 * geometry is kept for a couple of seconds and demolished.
 *
 * Demolished, not blown up. A tower is a stack of heavy blocks, and heavy things do not burst
 * outward and bounce: the first version threw every block out from the base and let it bounce
 * twice, and a felled tower read as a cloud of wireframe confetti over the neighbours' plots.
 * Now it goes the way a building does. It shudders and flares; the base gives; the column above
 * drops straight down into it, leaning a little further the lower it gets, each section a beat
 * behind the one under it so the column cracks apart at its joints on the way down; and each
 * section breaks into its blocks as it reaches the rubble. The cracks are what show it falling:
 * a column of identical blocks sliding down reads as standing still, because at speed one block
 * looks like the next. The rubble piles up at its foot, slides a little way down the pile and
 * stops within about a cell, dust rolls out as each section lands, and the heap sinks into the
 * floor while the winner rises where it stood.
 *
 * Everything standing in a cell comes down together: a keep's stacked towers are one column,
 * and felled one at a time, the upper ones hung in the air while they waited their turn.
 *
 * Blocks are simulated on the CPU, a few hundred at most per tower (a thousand-block spire is
 * broken into chunks of several blocks), and drawn as one instanced mesh per tower in the same
 * rim material as the board, squashed by the same height curve, so a tower felled on the map
 * falls from the height it was drawn at rather than from its true height.
 */

export interface Crumble {
  key: string;
  /** Everything standing in one cell, stacked or not. */
  entries: readonly TowerMapEntry[];
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
/**
 * Sections the column comes down in, one per this many world units of height, up to a most.
 * Each falls a beat behind the one under it and breaks into its blocks as it reaches the rubble.
 */
const SECTION_HEIGHT = 20;
const MAX_SECTIONS = 10;
/**
 * The beat between one section starting to fall and the one above it, seconds, at most; and the
 * widest a crack between sections opens, world units, which shortens the beat on a tall column.
 * A fixed beat opened ten-block gaps in a keep's stacked spire, and its top came down as a row
 * of separate sticks rather than as one cracking column.
 */
const SECTION_LAG = 0.03;
const WIDEST_CRACK = 7;
/** The shudder before it goes, seconds. */
const SHUDDER = 0.18;
/** How long the top takes to reach the ground once it goes, seconds, whatever the height. */
const FALL_SECONDS = 0.95;
/** How far the falling column has leaned by the time the top comes down, radians. */
const MAX_LEAN = 0.16;
/** Share of an impact's speed a block keeps as its one bounce. Stone does not spring. */
const RESTITUTION = 0.12;
/** Slower impacts than this, world units a second, stop dead rather than bounce. */
const BOUNCE_MIN = 3;
/** Fastest a block is pushed sideways out of the rubble, world units a second. */
const SPILL = 9;
/** How quickly rubble sliding down the pile stops, and how quickly on the flat past it, per second. */
const SLIDE_DRAG = 5;
const FLAT_DRAG = 12;
/** Most a block tumbles as it comes loose, radians a second. */
const TUMBLE = 3;
/** Widest the rubble spreads from the tower's middle, world units: inside its own cell. */
const MAX_SPREAD = 6;
/** When the rubble starts to sink, seconds. */
const SINK_AT = 1.75;
const DUST = 56;
const FIXED = 1000;
const BLOCK_H = DEFAULT_CONFIG.BLOCK_HEIGHT / FIXED;
const WHITE = new THREE.Color('#ffffff');

// Scratch objects for the frame loop, so a collapse allocates nothing per frame.
const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _qIdentity = new THREE.Quaternion();
const _e = new THREE.Euler();
const _p = new THREE.Vector3();
const _s = new THREE.Vector3();
const _c = new THREE.Color();
const _axis = new THREE.Vector3();

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
  /** Where it stood: centre, tower-local, world units. */
  x0: number;
  y0: number;
  z0: number;
  w: number;
  h: number;
  d: number;
  /** Half its thinnest side: how high its middle sits when it lies on something. */
  half: number;
  /** Which section of the column it comes down with. Section 0 is the base. */
  section: number;
  /** Its tower's colour, in the raw channels the board draws it with. */
  color: THREE.Color;
  /** Loose, rather than riding the column; and when it came loose, seconds. */
  free: boolean;
  freedAt: number;
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  /** The lean it broke away with, and the tumble it picked up since. */
  tilt: THREE.Quaternion;
  ax: number;
  ay: number;
  az: number;
  wx: number;
  wy: number;
  wz: number;
  bounced: boolean;
  /** Down on the rubble, sliding or still. */
  resting: boolean;
  /** Its own random numbers, drawn once, so every screen breaks it the same way. */
  r1: number;
  r2: number;
  r3: number;
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
  /** Bottom first. */
  pieces: Piece[];
  /** World height of the bottom of each section as it stood. */
  sectionBase: number[];
  /** The pile the column comes down into: how far it spreads, and how high it stands at the middle. */
  heapRadius: number;
  heapHeight: number;
  dust: Mote[];
  gravity: number;
  /** Bigger towers throw their rubble a little further, up to the edge of their cell. */
  scale: number;
  lean: { x: number; z: number };
  /** The beat between one section starting to fall and the one above it, seconds. */
  lag: number;
  /** The colour most of it is, for the dust. */
  color: THREE.Color;
}

/** Break a cell's towers into pieces and sections, and say how it leans and where its rubble goes. */
const planCollapse = (entries: readonly TowerMapEntry[]): Plan => {
  const rnd = seeded(entries.map((e) => e.sessionId).join('|'));

  // Every block in the cell, bottom first, each in its own tower's colour: the same raw channels
  // the standing towers are drawn with (see `rimColorFor`). Parsing the hex through THREE.Color
  // converts it to linear first, and a tower turned a deeper, bluer colour the instant it began
  // to fall. A tower drawn as a silhouette has no blocks, only a height; it breaks into full-width
  // slabs of block height, which is what it would have been.
  type Slab = {
    x: number;
    y: number;
    z: number;
    w: number;
    h: number;
    d: number;
    color: THREE.Color;
  };
  const slabs: Slab[] = entries
    .flatMap((entry): Slab[] => {
      const baseY = (entry.stackBaseY ?? 0) / FIXED;
      const rgb = hexToRgb(factionHex(entry.faction ?? null));
      const color = new THREE.Color(rgb.r, rgb.g, rgb.b);
      const blocks = entry.towerBlocks
        .filter((b) => Number.isFinite(b.y) && b.width > 0 && b.height > 0)
        .map((b) => ({
          x: b.x / FIXED,
          y: baseY + b.y / FIXED,
          z: (b.z ?? 0) / FIXED,
          w: b.width / FIXED,
          h: b.height / FIXED,
          d: (b.depth ?? b.width) / FIXED,
          color,
        }));
      if (blocks.length > 0) return blocks;
      const box = towerBox(undefined, entry.height);
      if (!box) return [];
      const n = Math.max(1, Math.round((box.maxY - box.minY) / BLOCK_H));
      const w = box.maxX - box.minX;
      return Array.from({ length: n }, (_, i) => ({
        x: 0,
        y: baseY + i * BLOCK_H,
        z: 0,
        w,
        h: BLOCK_H,
        d: w,
        color,
      }));
    })
    .sort((a, b) => a.y - b.y);

  // Neighbouring blocks break away together once there are too many to break one by one.
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
      color: group[0]!.color,
    });
  }

  const highest = chunks[chunks.length - 1];
  const top = highest ? highest.y + highest.h : 1;
  const tall = top - (chunks[0]?.y ?? 0);
  const gravity = Math.max(30, (2 * top) / (FALL_SECONDS * FALL_SECONDS));
  // A crack opens at the speed difference between neighbouring sections, which by the end of the
  // fall is gravity times the beat between them.
  const lag = Math.min(SECTION_LAG, WIDEST_CRACK / (gravity * FALL_SECONDS));
  const scale = Math.min(3, Math.max(0.7, Math.sqrt(tall / 24)));
  const leanAngle = rnd() * Math.PI * 2;
  const lean = { x: Math.cos(leanAngle), z: Math.sin(leanAngle) };
  const foot = (chunks[0]?.w ?? 4) / 2;
  const heapRadius = Math.min(MAX_SPREAD, foot + 2.2 + 0.6 * scale);
  const heapHeight = Math.min(heapRadius * 0.8, 0.12 * tall + 0.5);

  // Sections by block, bottom up; blocks are all one height, so these are sections by height.
  const sections = Math.max(
    1,
    Math.min(MAX_SECTIONS, chunks.length, Math.round(tall / SECTION_HEIGHT))
  );
  const sectionBase: number[] = Array.from({ length: sections }, () => Infinity);

  const pieces: Piece[] = chunks.map((c, i) => {
    const section = Math.min(sections - 1, Math.floor((i / chunks.length) * sections));
    const y0 = c.y + c.h / 2;
    sectionBase[section] = Math.min(sectionBase[section]!, c.y);
    return {
      x0: c.x,
      y0,
      z0: c.z,
      w: c.w,
      h: c.h,
      d: c.d,
      half: Math.min(c.w, c.h, c.d) / 2,
      section,
      color: c.color,
      free: false,
      freedAt: 0,
      x: c.x,
      y: y0,
      z: c.z,
      vx: 0,
      vy: 0,
      vz: 0,
      tilt: new THREE.Quaternion(),
      ax: 0,
      ay: 0,
      az: 0,
      wx: 0,
      wy: 0,
      wz: 0,
      bounced: false,
      resting: false,
      r1: rnd(),
      r2: rnd(),
      r3: rnd(),
    };
  });

  // A small roll of dust as the base gives, then more as each section comes down into the
  // rubble: sections land ever faster, at the square roots of the fall.
  const dust: Mote[] = Array.from({ length: DUST }, (_, i) => {
    const landing = i >= DUST * 0.3;
    const a = rnd() * Math.PI * 2;
    const r = foot * (0.7 + rnd() * 0.6);
    const when = landing
      ? FALL_SECONDS * Math.sqrt(0.15 + rnd() * 0.85) + rnd() * (sections - 1) * lag
      : rnd() * 0.12;
    // Fast enough to roll out past the rubble: dust that settles inside the heap is never seen.
    const speed = (landing ? 8 + rnd() * 8 : 5 + rnd() * 5) * Math.sqrt(scale);
    return {
      x: Math.cos(a) * r,
      y: 0.4 + rnd() * (landing ? heapHeight : 1),
      z: Math.sin(a) * r,
      vx: Math.cos(a) * speed,
      vy: 1 + rnd() * (landing ? 3 : 1.5),
      vz: Math.sin(a) * speed,
      born: SHUDDER + when,
      life: 1 + rnd() * 0.5,
    };
  });

  return {
    pieces,
    sectionBase,
    heapRadius,
    heapHeight,
    dust,
    gravity,
    scale,
    lean,
    lag,
    color: chunks[0]?.color ?? new THREE.Color(1, 1, 1),
  };
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
  /** Seconds simulated so far. */
  private last = 0;
  /** Sections broken so far, bottom up. */
  private broken = 0;
  /** Each section as of the last step: how far it has dropped, how fast, and its lean. */
  private readonly drop: number[];
  private readonly speed: number[];
  private readonly lean: THREE.Quaternion[];
  /** How high the rubble stands at the middle now. */
  private heap = 0;

  /**
   * When it began, ms. Put back to the first frame drawn if that came late: the switch that
   * fells a holding costs the page a couple of hundred milliseconds, and the whole shudder,
   * the warning that the tower is going, was being spent before anything was drawn.
   */
  private startedAt: number;
  private drawn = false;

  constructor(
    readonly plan: Plan,
    at: number
  ) {
    this.startedAt = at;
    const n = plan.sectionBase.length;
    this.drop = Array.from({ length: n }, () => 0);
    this.speed = Array.from({ length: n }, () => 0);
    this.lean = Array.from({ length: n }, () => new THREE.Quaternion());
  }

  /** Advance to `now` (ms), writing instance transforms and colours, and the dust. */
  step(now: number, mesh: THREE.InstancedMesh, dust: THREE.Points, dustColor: THREE.Color): void {
    if (!this.drawn) {
      this.drawn = true;
      this.startedAt = Math.max(this.startedAt, now - 1000 / 60);
    }
    const t = (now - this.startedAt) / 1000;
    // In steps no longer than a 60 Hz frame, so a slow frame cannot drop rubble through the pile.
    const span = Math.min(0.1, Math.max(0, t - this.last));
    const steps = Math.max(1, Math.ceil(span * 60));
    for (let k = 1; k <= steps; k++) this.advance(t - span + (span * k) / steps, span / steps);
    this.last = Math.max(this.last, t);
    this.draw(t, mesh);
    this.drawDust(t, dust, dustColor);
  }

  /** The rubble's surface under a point, at the middle of a piece lying on it. */
  private floorAt(piece: Piece): number {
    const { heapRadius } = this.plan;
    const r = Math.hypot(piece.x, piece.z);
    return GROUND_Y + this.heap * Math.max(0, 1 - r / heapRadius) + piece.half;
  }

  /** Where a piece riding the column is now: dropped, and turned about the top of the rubble. */
  private posed(piece: Piece, out: THREE.Vector3): THREE.Vector3 {
    const pivot = GROUND_Y + this.heap;
    return out
      .set(piece.x0, piece.y0 - this.drop[piece.section]! - pivot, piece.z0)
      .applyQuaternion(this.lean[piece.section]!)
      .setY(out.y + pivot);
  }

  private advance(t: number, dt: number): void {
    if (t < SHUDDER) return;
    const { pieces, sectionBase, gravity, heapHeight, lean } = this.plan;
    const fallT = t - SHUDDER;
    const sections = sectionBase.length;
    _axis.set(lean.z, 0, -lean.x);
    for (let s = 0; s < sections; s++) {
      const own = Math.max(0, fallT - s * this.plan.lag);
      this.drop[s] = 0.5 * gravity * own * own;
      this.speed[s] = gravity * own;
      this.lean[s]!.setFromAxisAngle(_axis, MAX_LEAN * Math.min(1, own / FALL_SECONDS) ** 2);
    }
    // The rubble grows with what has come down: the base as it gives, then the column.
    const whole = FALL_SECONDS + (sections - 1) * this.plan.lag;
    this.heap =
      heapHeight * Math.min(1, (fallT / whole) ** 2 + Math.min(1, fallT / 0.25) / sections);

    // Sections break, bottom up, as they reach the rubble. The base goes first, at once.
    while (
      this.broken < sections &&
      (this.broken === 0 ||
        sectionBase[this.broken]! - this.drop[this.broken]! <= GROUND_Y + this.heap)
    ) {
      this.loosen(this.broken, t);
      this.broken++;
    }

    for (const piece of pieces) if (piece.free) this.tumble(piece, dt);
  }

  /** Break a section into its blocks where it stands, each keeping the column's fall. */
  private loosen(section: number, t: number): void {
    const { pieces, lean, scale } = this.plan;
    const base = section === 0;
    for (const piece of pieces) {
      if (piece.section !== section) continue;
      this.posed(piece, _p);
      piece.free = true;
      piece.freedAt = t;
      piece.x = _p.x;
      piece.y = _p.y;
      piece.z = _p.z;
      piece.tilt.copy(this.lean[section]!);
      // Pushed out of the rubble, a little toward the lean. The base only gives way; the column
      // lands on it and spreads it.
      const near = Math.hypot(_p.x, _p.z) < 0.3;
      const out = (near ? piece.r1 * Math.PI * 2 : Math.atan2(_p.z, _p.x)) + (piece.r1 - 0.5) * 1.4;
      const push = (0.35 + 0.65 * piece.r2) * SPILL * Math.sqrt(scale) * (base ? 0.5 : 1);
      const toward = base ? 0 : 0.25;
      piece.vx = (Math.cos(out) * (1 - toward) + lean.x * toward) * push;
      piece.vz = (Math.sin(out) * (1 - toward) + lean.z * toward) * push;
      piece.vy = base ? 0 : -this.speed[section]!;
      piece.wx = (piece.r2 - 0.5) * TUMBLE;
      piece.wy = (piece.r1 - 0.5) * TUMBLE;
      piece.wz = (piece.r3 - 0.5) * TUMBLE;
    }
  }

  private tumble(piece: Piece, dt: number): void {
    const { gravity, heapRadius } = this.plan;
    if (!piece.resting) {
      piece.vy -= gravity * dt;
      piece.x += piece.vx * dt;
      piece.y += piece.vy * dt;
      piece.z += piece.vz * dt;
      piece.ax += piece.wx * dt;
      piece.ay += piece.wy * dt;
      piece.az += piece.wz * dt;
      const floor = this.floorAt(piece);
      if (piece.y <= floor && piece.vy < 0) {
        piece.y = floor;
        if (!piece.bounced && -piece.vy > BOUNCE_MIN) {
          // One small kick off the rubble, then it stays down.
          piece.bounced = true;
          piece.vy = -piece.vy * RESTITUTION;
          piece.vx *= 0.7;
          piece.vz *= 0.7;
          piece.wx *= 0.5;
          piece.wy *= 0.5;
          piece.wz *= 0.5;
        } else {
          piece.resting = true;
          piece.vy = 0;
        }
      }
      return;
    }
    // Down: it slides down the pile and grinds to a stop, sooner on the flat past it. Rubble that
    // lands after it may bury it; it never climbs back up the pile.
    const drag = Math.exp(
      -(Math.hypot(piece.x, piece.z) < heapRadius ? SLIDE_DRAG : FLAT_DRAG) * dt
    );
    piece.vx *= drag;
    piece.vz *= drag;
    piece.wx *= drag;
    piece.wy *= drag;
    piece.wz *= drag;
    piece.x += piece.vx * dt;
    piece.z += piece.vz * dt;
    piece.ax += piece.wx * dt;
    piece.ay += piece.wy * dt;
    piece.az += piece.wz * dt;
    piece.y = Math.min(piece.y, this.floorAt(piece));
  }

  private draw(t: number, mesh: THREE.InstancedMesh): void {
    const { pieces, scale } = this.plan;
    const colors = mesh.instanceColor!.array as Float32Array;
    const shudder = t <= 0 ? 0 : Math.min(1, t / SHUDDER);
    const sink = t > SINK_AT ? (t - SINK_AT) * (t - SINK_AT) * 14 : 0;
    const fade = t > SINK_AT ? Math.max(0, 1 - (t - SINK_AT) / (CRUMBLE_MS / 1000 - SINK_AT)) : 1;
    // Already part lit on the first frame, so the hand-over from the standing tower is a flare
    // rather than a flicker; it cools as the tower comes down. Waiting its turn in a row of
    // falls, it is just the tower it was.
    const flare =
      t <= 0 ? 0 : t < SHUDDER ? 0.35 + 0.4 * shudder : 0.75 * Math.exp(-(t - SHUDDER) * 2.6);

    pieces.forEach((piece, i) => {
      _s.set(piece.w, piece.h, piece.d);
      if (piece.free) {
        _q.setFromEuler(_e.set(piece.ax, piece.ay, piece.az)).premultiply(piece.tilt);
        _m.compose(_p.set(piece.x, piece.y - sink, piece.z), _q, _s);
      } else if (t < SHUDDER) {
        // Standing, and shuddering harder toward the moment it goes.
        const k = 0.12 * shudder * scale;
        _p.set(
          piece.x0 + Math.sin(t * 95 + piece.y0) * k,
          piece.y0,
          piece.z0 + Math.cos(t * 83 + piece.y0 * 0.7) * k
        );
        _m.compose(_p, _qIdentity, _s);
      } else {
        _m.compose(this.posed(piece, _p), this.lean[piece.section]!, _s);
      }
      mesh.setMatrixAt(i, _m);

      // Rubble dims as it settles, rather than blinking darker the moment it stops.
      const settled = piece.free ? Math.min(1, (t - piece.freedAt) / 0.6) : 0;
      _c.copy(piece.color)
        .lerp(WHITE, flare)
        .multiplyScalar((1 - 0.4 * settled) * fade);
      colors[i * 3] = _c.r;
      colors[i * 3 + 1] = _c.g;
      colors[i * 3 + 2] = _c.b;
    });
    mesh.instanceMatrix.needsUpdate = true;
    mesh.instanceColor!.needsUpdate = true;
  }

  private drawDust(t: number, dust: THREE.Points, dustColor: THREE.Color): void {
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
  const { entries } = crumble;
  const [collapse] = useState(() => new Collapse(planCollapse(entries), crumble.at));
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
    <group position={[entries[0]?.worldX ?? 0, 0, entries[0]?.worldZ ?? 0]}>
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
