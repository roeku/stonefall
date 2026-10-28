import * as THREE from 'three';
import type { FactionId } from '../../../shared/types/factions';

/**
 * Each colour's combo, as an element.
 *
 * The combo's corners (comboLight.ts) say a streak is running in every colour alike. On top of
 * that, each faction's streak burns in its own element: Ember's tower catches fire, Cobalt's
 * crackles with lightning, Cyan's runs with water, and so on round the eight. Every element is
 * the same four moments -- it burns while the combo runs, flares on each perfect, bursts when the
 * streak earns a new name, and dies when it breaks -- and burns harder the higher the tier.
 *
 * They are all drawn by one particle system in one shape language, the game's: pixels, hollow
 * squares, hard streaks and line segments in the tower's own colour, lit past the bloom
 * threshold. Fire is square embers, not soft flames; water is hollow-square bubbles and streaked
 * drops. So a colour's element reads as that colour's, and all eight read as one game.
 *
 * Particles keep to the tower's sides and the air round it, and come off the top's rim rather
 * than its face: the top face is what the next block is aimed at.
 *
 * Space is the run's own (world units, the floor at 0), time is seconds. ComboElements draws it.
 */

export type ComboElement =
  | 'fire'
  | 'lightning'
  | 'water'
  | 'light'
  | 'data'
  | 'wind'
  | 'void'
  | 'petals';

export const ELEMENT_OF: Record<FactionId, ComboElement> = {
  ember: 'fire',
  gold: 'light',
  lime: 'data',
  jade: 'wind',
  cyan: 'water',
  cobalt: 'lightning',
  violet: 'void',
  rose: 'petals',
};

/** A tower nobody has chosen a colour for is drawn in cyan, so it runs with water. */
export const elementOf = (id: FactionId | null | undefined): ComboElement =>
  id ? ELEMENT_OF[id] : 'water';

/** The shapes the shader draws (ComboElements). */
export const SHAPE = {
  /** A filled pixel. */
  SQUARE: 0,
  /** A hollow square. */
  RING: 1,
  /** A line trailing behind the particle's motion. */
  STREAK: 2,
  /** A fixed line from the particle to (dx, dy, dz) past it. */
  SEGMENT: 3,
  /** A four-pointed glint. */
  GLINT: 4,
  /** A diamond that can flip, for petals and leaves. */
  DIAMOND: 5,
} as const;

/** Linear RGB. */
export type RGB = readonly [number, number, number];

/** An element's colours, all from the tower's own: white-hot, itself, and burnt down. */
export interface Palette {
  hot: RGB;
  mid: RGB;
  deep: RGB;
}

export interface Particle {
  alive: boolean;
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  /** Upward acceleration, units/s²: buoyancy when positive, gravity when negative. */
  ay: number;
  /** Share of its velocity lost per second. */
  drag: number;
  age: number;
  life: number;
  size0: number;
  size1: number;
  shape: number;
  rot: number;
  spin: number;
  /** Radians a second its width swings through, for a petal turning over; 0 never. */
  flip: number;
  c0: RGB;
  c1: RGB;
  /** Brightness over its colour. */
  glow: number;
  /** How much its brightness jitters frame to frame, 0..1. */
  flicker: number;
  /** Share of its life it takes to fade in. */
  fadeIn: number;
  /** A SEGMENT's line. */
  dx: number;
  dy: number;
  dz: number;
  /** A STREAK's tail, as seconds of its velocity. */
  tail: number;
  /** Turning round the tower's upright, radians a second, and pull toward it, units a second. */
  orbit: number;
  pull: number;
  /** A pulled particle this close to the upright is taken in. */
  absorb: number;
  /** Sideways sway, units a second, and where in its sway it starts. */
  wobble: number;
  phase: number;
  /** A data stream's head leaves a pixel behind every `trail` seconds; 0 leaves none. */
  trail: number;
  trailClock: number;
}

const linear = (hex: string, toward: string, t: number): RGB => {
  const c = new THREE.Color(hex).lerp(new THREE.Color(toward), t);
  return [c.r, c.g, c.b];
};

/** An element's colours from the tower's: white-hot, its own, and burnt down toward the night. */
export const paletteOf = (hex: string): Palette => ({
  hot: linear(hex, '#ffffff', 0.45),
  mid: linear(hex, hex, 0),
  deep: linear(hex, '#000814', 0.55),
});

/** The tower the combo is on, as the scene last saw it. */
export interface ComboTower {
  /** The upright the top block stands on, and the top block's half extents. */
  cx: number;
  cz: number;
  hw: number;
  hd: number;
  /** The streak: the foot of its first block, the top, and its tier. */
  from: number;
  to: number;
  tier: number;
  /** Whether the combo is running. Elements only burn while it is. */
  running: boolean;
}

export const comboTowerOff = (): ComboTower => ({
  cx: 0,
  cz: 0,
  hw: 2,
  hd: 2,
  from: 0,
  to: 0,
  tier: 0,
  running: false,
});

/** What an element is handed to work with. */
export interface Emit {
  tower: ComboTower;
  palette: Palette;
  /** How hard it burns: 0 at the first combo tier, 1 by Pinnacle. */
  heat: number;
  /** The bottom of the streak the camera can see; it runs from here to the top. */
  lo: number;
  spawn(p: Partial<Particle>): Particle | null;
}

export interface ElementBehaviour {
  /** While the combo runs, this frame. */
  ambient(e: Emit, dt: number): void;
  /** Each perfect in a combo. */
  perfect(e: Emit): void;
  /** A new streak name, as the corners' charge reaches the top. */
  tierUp(e: Emit): void;
  /** The combo broke or the run fell: what is alive dies its element's way. */
  fizzle(e: Emit, alive: readonly Particle[]): void;
}

export const ELEMENT_TUNING = {
  /** How far below the top the element reaches, world units: about what the run camera shows. */
  REACH: 15,
  /**
   * How far under the top an element that keeps low stays, world units: a couple of blocks, so
   * nothing it draws is near the edges the next block is lined up on.
   */
  TOP_CLEAR: 4,
  /** The tier at which an element is at full heat. */
  FULL_HEAT_TIER: 10,
  /** Particles alive at once, across the element. */
  POOL: 900,
} as const;

/**
 * 0 at Plumb, 1 at Pinnacle, rising fastest early: most combos are short, and a player should
 * see their fire grow from the first few names, not only from the fortieth perfect.
 */
export const heatOf = (tier: number): number =>
  Math.min(1, Math.sqrt(Math.max(0, tier - 1) / (ELEMENT_TUNING.FULL_HEAT_TIER - 1)));

// ---------------------------------------------------------------------------------------------
// Helpers

const rnd = (a: number, b: number): number => a + Math.random() * (b - a);
const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;
/** A whole count for `rate` per second over `dt`, carrying the fraction by chance. */
const count = (rate: number, dt: number): number => Math.floor(rate * dt + Math.random());
const pick = <T>(items: readonly T[]): T => items[Math.floor(Math.random() * items.length)]!;

/** A height in the visible part of the streak, more often near the top, where the eyes are. */
const inStreak = (e: Emit, bias = 1.5): number =>
  e.tower.to - (e.tower.to - e.lo) * Math.pow(Math.random(), bias);

/**
 * The part of the tower in frame an element keeps to when it stays low: from the bottom of what
 * the camera shows to TOP_CLEAR under the top. The whole tower, not only the streak, so a short
 * streak still has room; a tower too short for that keeps to its lower half.
 */
const lowZone = (e: Emit): { lo: number; hi: number } => {
  const t = e.tower;
  const lo = Math.max(0, t.to - ELEMENT_TUNING.REACH);
  const hi = t.to - ELEMENT_TUNING.TOP_CLEAR;
  return hi > lo + 1 ? { lo, hi } : { lo: 0, hi: Math.max(0.5, t.to * 0.5) };
};

const clampTo = (y: number, z: { lo: number; hi: number }): number =>
  Math.min(z.hi, Math.max(z.lo, y));

interface Spot {
  x: number;
  y: number;
  z: number;
  /** The outward direction there, across. */
  nx: number;
  nz: number;
}

/**
 * A point on the tower's side faces at height y. The run camera looks in from +x +z, so the two
 * faces it sees get most of them; a few go round the back to give the effect depth.
 */
const onFace = (t: ComboTower, y: number, out = 0.04): Spot => {
  const side = Math.random();
  if (side < 0.42) return { x: t.cx + t.hw + out, y, z: t.cz + rnd(-t.hd, t.hd), nx: 1, nz: 0 };
  if (side < 0.84) return { x: t.cx + rnd(-t.hw, t.hw), y, z: t.cz + t.hd + out, nx: 0, nz: 1 };
  if (side < 0.92) return { x: t.cx - t.hw - out, y, z: t.cz + rnd(-t.hd, t.hd), nx: -1, nz: 0 };
  return { x: t.cx + rnd(-t.hw, t.hw), y, z: t.cz - t.hd - out, nx: 0, nz: -1 };
};

const CORNERS: ReadonlyArray<readonly [number, number]> = [
  [1, 1],
  [1, 1],
  [1, -1],
  [-1, 1],
];

/** A point on one of the three uprights the camera sees, the front one most often. */
const onCorner = (t: ComboTower, y: number, which?: readonly [number, number]): Spot => {
  const [sx, sz] = which ?? pick(CORNERS);
  return {
    x: t.cx + sx * t.hw,
    y,
    z: t.cz + sz * t.hd,
    nx: sx * Math.SQRT1_2,
    nz: sz * Math.SQRT1_2,
  };
};

/** A point round the tower at radius r from its upright, mostly on the camera's side. */
const around = (t: ComboTower, r: number, y: number): Spot => {
  const a = Math.PI / 4 + rnd(-1.9, 1.9);
  return {
    x: t.cx + Math.cos(a) * r,
    y,
    z: t.cz + Math.sin(a) * r,
    nx: Math.cos(a),
    nz: Math.sin(a),
  };
};

const radius = (t: ComboTower): number => Math.hypot(t.hw, t.hd);

/**
 * A lightning bolt from a to b: a jagged line of segments, each a particle that strobes and is
 * gone in a blink, with a few forks at higher heat.
 */
const bolt = (
  e: Emit,
  a: readonly [number, number, number],
  b: readonly [number, number, number],
  opts: { width?: number; life?: number; forks?: number; jag?: number; glow?: number } = {}
): void => {
  const [ax, ay, az] = a;
  const [bx, by, bz] = b;
  const len = Math.hypot(bx - ax, by - ay, bz - az);
  const n = Math.max(4, Math.min(16, Math.round(len / 0.55)));
  const jag = (opts.jag ?? 0.16) * len;
  const life = opts.life ?? rnd(0.16, 0.26);
  const pts: Array<[number, number, number]> = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const off = i === 0 || i === n ? 0 : jag * Math.sin(Math.PI * t);
    pts.push([
      lerp(ax, bx, t) + rnd(-off, off),
      lerp(ay, by, t) + rnd(-off, off) * 0.6,
      lerp(az, bz, t) + rnd(-off, off),
    ]);
  }
  for (let i = 0; i < n; i++) {
    const [px, py, pz] = pts[i]!;
    const [qx, qy, qz] = pts[i + 1]!;
    e.spawn({
      x: px,
      y: py,
      z: pz,
      dx: qx - px,
      dy: qy - py,
      dz: qz - pz,
      shape: SHAPE.SEGMENT,
      size0: opts.width ?? 0.16,
      size1: opts.width ?? 0.16,
      life,
      c0: e.palette.hot,
      c1: e.palette.mid,
      glow: opts.glow ?? 3.4,
      flicker: 0.5,
    });
  }
  for (let f = 0; f < (opts.forks ?? 0); f++) {
    const from = pts[1 + Math.floor(Math.random() * (n - 1))]!;
    const fl = len * rnd(0.2, 0.4);
    bolt(e, from, [from[0] + rnd(-fl, fl), from[1] + rnd(-fl, fl * 0.5), from[2] + rnd(-fl, fl)], {
      ...opts,
      forks: 0,
      width: (opts.width ?? 0.16) * 0.7,
      life,
    });
  }
};

/** Sparks thrown from a point: pixels that fall. */
const sparks = (e: Emit, x: number, y: number, z: number, n: number, speed = 3): void => {
  for (let i = 0; i < n; i++) {
    e.spawn({
      x,
      y,
      z,
      vx: rnd(-speed, speed),
      vy: rnd(-0.5, speed),
      vz: rnd(-speed, speed),
      ay: -12,
      shape: SHAPE.SQUARE,
      size0: 0.09,
      size1: 0.03,
      life: rnd(0.25, 0.45),
      c0: e.palette.hot,
      c1: e.palette.mid,
      glow: 2.6,
      flicker: 0.3,
    });
  }
};

/** Everything alive goes out within `within` seconds. */
const shorten = (alive: readonly Particle[], within: number): void => {
  for (const p of alive) p.life = Math.min(p.life, p.age + rnd(within * 0.4, within));
};

// ---------------------------------------------------------------------------------------------
// The eight

/** Flame colours: the core yellowing toward white, the tail burning down to the night. */
const flame = (e: Emit): { core: RGB; tail: RGB } => ({
  core: [
    lerp(e.palette.hot[0], 1, 0.15),
    lerp(e.palette.hot[1], 0.85, 0.35),
    lerp(e.palette.hot[2], 0.35, 0.4),
  ],
  tail: e.palette.deep,
});

/**
 * Ember: the streak catches fire. Burning pixels come off its uprights, flame licks run up them,
 * and embers rise out of it and drift. The fire grows with the streak: a few flames at Plumb,
 * the top ablaze by Square.
 */
const fire: ElementBehaviour = {
  ambient(e, dt) {
    const { core, tail } = flame(e);
    // Burning pixels thrown off the uprights, where they show against the dark.
    for (let i = count(lerp(14, 90, e.heat), dt); i > 0; i--) {
      const s = onCorner(e.tower, inStreak(e, 2.4));
      e.spawn({
        ...s,
        vx: s.nx * rnd(0.1, 0.5),
        vy: rnd(1.4, 2.8) + 1.4 * e.heat,
        vz: s.nz * rnd(0.1, 0.5),
        ay: rnd(2.5, 4.5),
        wobble: rnd(0.3, 0.8),
        phase: rnd(0, 6.3),
        shape: SHAPE.SQUARE,
        size0: rnd(0.26, 0.42) + 0.18 * e.heat,
        size1: 0.04,
        life: rnd(0.4, 0.75) + 0.25 * e.heat,
        c0: core,
        c1: tail,
        glow: 1.7,
        flicker: 0.3,
      });
    }
    // Embers: small, long-lived, rising well clear of the tower and wandering as they go.
    for (let i = count(lerp(8, 55, e.heat), dt); i > 0; i--) {
      const s = onFace(e.tower, inStreak(e, 1.6), 0.1);
      e.spawn({
        ...s,
        vx: s.nx * rnd(0.3, 0.9),
        vy: rnd(2, 3.5),
        vz: s.nz * rnd(0.3, 0.9),
        ay: rnd(0.8, 1.6),
        drag: 0.3,
        wobble: rnd(0.8, 1.6),
        phase: rnd(0, 6.3),
        shape: SHAPE.SQUARE,
        size0: rnd(0.1, 0.15),
        size1: 0.05,
        life: rnd(1.1, 2),
        c0: core,
        c1: e.palette.mid,
        glow: 2.4,
        flicker: 0.55,
      });
    }
    // Flame licks up the uprights.
    for (let i = count(lerp(6, 45, e.heat), dt); i > 0; i--) {
      const s = onCorner(e.tower, inStreak(e, 1.8));
      e.spawn({
        ...s,
        vx: s.nx * 0.4,
        vy: rnd(5, 8.5),
        vz: s.nz * 0.4,
        ay: 3,
        shape: SHAPE.STREAK,
        tail: 0.09,
        size0: 0.16,
        size1: 0.06,
        life: rnd(0.22, 0.42),
        c0: core,
        c1: e.palette.mid,
        glow: 2.2,
        flicker: 0.4,
      });
    }
  },
  perfect(e) {
    // The landing fans the fire: a flare off the top rim.
    const { core, tail } = flame(e);
    for (let i = 0; i < 26 + 40 * e.heat; i++) {
      const s = onFace(e.tower, e.tower.to - rnd(0, 0.5), 0.05);
      e.spawn({
        ...s,
        vx: s.nx * rnd(0.8, 2.4),
        vy: rnd(3, 6),
        vz: s.nz * rnd(0.8, 2.4),
        ay: 2.5,
        drag: 0.9,
        shape: SHAPE.SQUARE,
        size0: rnd(0.24, 0.42),
        size1: 0.04,
        life: rnd(0.5, 0.9),
        c0: core,
        c1: tail,
        glow: 2,
        flicker: 0.35,
      });
    }
  },
  tierUp(e) {
    // A new name goes up in a column of fire off the whole rim, with a shower of embers.
    const { core, tail } = flame(e);
    for (let i = 0; i < 60 + 80 * e.heat; i++) {
      const s = onFace(e.tower, e.tower.to - rnd(0, 1.2), 0.05);
      e.spawn({
        ...s,
        vx: s.nx * rnd(0.3, 1.4),
        vy: rnd(6, 11) + 3 * e.heat,
        vz: s.nz * rnd(0.3, 1.4),
        ay: 1.5,
        drag: 0.7,
        wobble: 0.8,
        phase: rnd(0, 6.3),
        shape: SHAPE.SQUARE,
        size0: rnd(0.3, 0.5),
        size1: 0.05,
        life: rnd(0.6, 1.1),
        c0: core,
        c1: tail,
        glow: 2,
        flicker: 0.35,
      });
    }
    for (let i = 0; i < 24 + 30 * e.heat; i++) {
      const s = onFace(e.tower, e.tower.to, 0.1);
      e.spawn({
        ...s,
        vx: s.nx * rnd(1, 3),
        vy: rnd(5, 10),
        vz: s.nz * rnd(1, 3),
        ay: -1,
        drag: 0.4,
        wobble: 1.2,
        phase: rnd(0, 6.3),
        shape: SHAPE.SQUARE,
        size0: 0.13,
        size1: 0.05,
        life: rnd(1.2, 2),
        c0: core,
        c1: e.palette.mid,
        glow: 2.6,
        flicker: 0.55,
      });
    }
  },
  fizzle(e, alive) {
    // The fire goes out: what is burning loses its lift and falls, darkening as it goes.
    for (const p of alive) {
      p.ay = -6;
      p.vy = Math.min(p.vy, 1);
      p.c0 = p.c1;
      p.c1 = e.palette.deep;
      p.glow *= 0.7;
    }
    shorten(alive, 0.6);
  },
};

/**
 * Cobalt: the tower is charged. Arcs jump across its faces and off its corners, strobing as they
 * strike, and current races along its uprights; the higher the streak, the more of it. All of it
 * on the lower part of the tower in frame, clear of the top the next block is lined up on.
 */
const lightning: ElementBehaviour & { next: number } = {
  next: 0,
  ambient(e, dt) {
    const t = e.tower;
    const z = lowZone(e);
    // Current along the uprights: short bright streaks racing up and down them.
    for (let i = count(lerp(18, 70, e.heat), dt); i > 0; i--) {
      const s = onCorner(t, rnd(z.lo, z.hi));
      e.spawn({
        ...s,
        vy: (Math.random() < 0.6 ? 1 : -1) * rnd(5, 10),
        shape: SHAPE.STREAK,
        tail: 0.03,
        size0: 0.14,
        size1: 0.1,
        life: rnd(0.15, 0.3),
        c0: e.palette.hot,
        c1: e.palette.mid,
        glow: 3,
        flicker: 0.4,
      });
    }
    lightning.next -= dt;
    if (lightning.next > 0) return;
    lightning.next = lerp(0.34, 0.07, e.heat) * rnd(0.6, 1.3);
    const strikes = e.heat > 0.6 && Math.random() < 0.5 ? 2 : 1;
    for (let k = 0; k < strikes; k++) {
      const y = rnd(z.lo, z.hi);
      if (Math.random() < 0.3) {
        // Across a face the camera sees, corner to corner.
        const a = onCorner(t, y, [1, 1]);
        const b = onCorner(t, clampTo(y + rnd(-2, 2), z), Math.random() < 0.5 ? [1, -1] : [-1, 1]);
        bolt(e, [a.x, a.y, a.z], [b.x, b.y, b.z], {
          forks: e.heat > 0.3 ? 1 + Math.round(e.heat) : 0,
        });
        sparks(e, b.x, b.y, b.z, 3);
      } else {
        // Off a side corner, out into the dark beside the tower.
        const a = onCorner(t, y, Math.random() < 0.5 ? [1, -1] : [-1, 1]);
        const r = rnd(3, 6);
        const end = [a.x + a.nx * r, clampTo(a.y + rnd(-2, 1), z), a.z + a.nz * r] as const;
        bolt(e, [a.x, a.y, a.z], end, { forks: 1 + Math.round(e.heat), width: 0.2 });
        sparks(e, end[0], end[1], end[2], 5);
      }
    }
  },
  perfect(e) {
    // The landing earths through the tower: an arc across each face in frame.
    const t = e.tower;
    const z = lowZone(e);
    for (const c of [
      [1, -1],
      [-1, 1],
    ] as const) {
      const y = rnd(z.lo, z.hi);
      const a = onCorner(t, y, [1, 1]);
      const b = onCorner(t, clampTo(y + rnd(-1.5, 1.5), z), c);
      bolt(e, [a.x, a.y, a.z], [b.x, b.y, b.z], {
        forks: 1 + Math.round(2 * e.heat),
        width: 0.2,
        life: 0.26,
      });
      sparks(e, b.x, b.y, b.z, 6 + Math.round(8 * e.heat));
    }
    lightning.next = Math.max(lightning.next, 0.12);
  },
  tierUp(e) {
    // A new name discharges: bolts from every corner in frame out into the dark.
    const t = e.tower;
    const z = lowZone(e);
    for (const c of [
      [1, 1],
      [1, -1],
      [-1, 1],
    ] as const) {
      for (let k = 0; k < 2; k++) {
        const a = onCorner(t, rnd(z.lo, z.hi), c);
        const r = rnd(4, 6 + 3 * e.heat);
        const end = [a.x + a.nx * r, clampTo(a.y + rnd(-2, 1), z), a.z + a.nz * r] as const;
        bolt(e, [a.x, a.y, a.z], end, {
          forks: 2 + Math.round(2 * e.heat),
          width: 0.2,
          life: 0.32,
          glow: 3.6,
        });
        sparks(e, end[0], end[1], end[2], 8);
      }
    }
  },
  fizzle(e, alive) {
    // One last bolt runs down the front corner to the ground, and it is spent.
    const z = lowZone(e);
    const a = onCorner(e.tower, z.hi, [1, 1]);
    bolt(e, [a.x, a.y, a.z], [a.x, Math.max(0, z.lo - 4), a.z], {
      jag: 0.06,
      life: 0.25,
      width: 0.18,
    });
    sparks(e, a.x, a.y, a.z, 8);
    shorten(alive, 0.2);
  },
};

/** Cyan: the streak runs with water. Bubbles climb its faces and drops slide down its uprights. */
const water: ElementBehaviour = {
  ambient(e, dt) {
    for (let i = count(lerp(12, 60, e.heat), dt); i > 0; i--) {
      const s = onFace(e.tower, inStreak(e, 1.1), 0.12);
      e.spawn({
        ...s,
        vy: rnd(0.7, 1.5),
        ay: 0.7,
        wobble: rnd(0.3, 0.7),
        phase: rnd(0, 6.3),
        shape: SHAPE.RING,
        size0: rnd(0.2, 0.36),
        size1: rnd(0.3, 0.46),
        life: rnd(1, 2),
        fadeIn: 0.15,
        c0: e.palette.hot,
        c1: e.palette.mid,
        glow: 1.7,
      });
    }
    for (let i = count(lerp(3, 22, e.heat), dt); i > 0; i--) {
      const s = onCorner(e.tower, e.tower.to - rnd(0, 3));
      e.spawn({
        ...s,
        vy: -rnd(0.3, 1),
        ay: -9,
        shape: SHAPE.STREAK,
        tail: 0.04,
        size0: 0.08,
        size1: 0.06,
        life: rnd(0.6, 1),
        c0: e.palette.hot,
        c1: e.palette.mid,
        glow: 2.2,
      });
    }
  },
  perfect(e) {
    // A splash off the rim, falling down the sides.
    for (let i = 0; i < 14 + 24 * e.heat; i++) {
      const s = onFace(e.tower, e.tower.to);
      e.spawn({
        ...s,
        vx: s.nx * rnd(1.5, 3.5),
        vy: rnd(2, 4.5),
        vz: s.nz * rnd(1.5, 3.5),
        ay: -14,
        shape: SHAPE.STREAK,
        tail: 0.035,
        size0: 0.09,
        size1: 0.06,
        life: rnd(0.6, 0.95),
        c0: e.palette.hot,
        c1: e.palette.mid,
        glow: 2.3,
      });
    }
  },
  tierUp(e) {
    // A crown of water thrown up off the rim.
    for (let i = 0; i < 34 + 46 * e.heat; i++) {
      const s = onFace(e.tower, e.tower.to);
      e.spawn({
        ...s,
        vx: s.nx * rnd(0.8, 2.2),
        vy: rnd(6, 10 + 4 * e.heat),
        vz: s.nz * rnd(0.8, 2.2),
        ay: -14,
        shape: SHAPE.STREAK,
        tail: 0.03,
        size0: 0.1,
        size1: 0.07,
        life: rnd(1, 1.5),
        c0: e.palette.hot,
        c1: e.palette.mid,
        glow: 2.5,
      });
    }
  },
  fizzle(e, alive) {
    // It pours off: drops spill from the rim and run down, and the bubbles burst.
    for (let i = 0; i < 30; i++) {
      const s = onFace(e.tower, e.tower.to);
      e.spawn({
        ...s,
        vx: s.nx * rnd(0.3, 1.2),
        vy: rnd(-0.5, 1),
        vz: s.nz * rnd(0.3, 1.2),
        ay: -14,
        shape: SHAPE.STREAK,
        tail: 0.04,
        size0: 0.09,
        size1: 0.06,
        life: rnd(0.7, 1.1),
        c0: e.palette.mid,
        c1: e.palette.deep,
        glow: 1.8,
      });
    }
    shorten(
      alive.filter((p) => p.shape === SHAPE.RING),
      0.25
    );
  },
};

/**
 * Gold: the tower shines. Glints flash across its faces, rays of light are thrown flat off its
 * corners, and motes drift up off it; each perfect is a sunburst out of the tower. All on the
 * lower part of the tower in frame, clear of the top.
 */
const light: ElementBehaviour = {
  ambient(e, dt) {
    const t = e.tower;
    const z = lowZone(e);
    for (let i = count(lerp(9, 40, e.heat), dt); i > 0; i--) {
      // Half on the side edges, where a glint has the dark behind it; half on the faces.
      const s =
        Math.random() < 0.5
          ? onCorner(t, rnd(z.lo, z.hi), Math.random() < 0.5 ? [1, -1] : [-1, 1])
          : onFace(t, rnd(z.lo, z.hi), 0.06);
      e.spawn({
        ...s,
        shape: SHAPE.GLINT,
        size0: rnd(1.1, 1.6 + 0.7 * e.heat),
        size1: 0.2,
        rot: rnd(-0.3, 0.3),
        life: rnd(0.4, 0.65),
        fadeIn: 0.3,
        c0: e.palette.hot,
        c1: e.palette.mid,
        glow: 2.6,
      });
    }
    // Rays off the side corners, flat out, as light comes off an edge.
    for (let i = count(lerp(10, 40, e.heat), dt); i > 0; i--) {
      const s = onCorner(t, rnd(z.lo, z.hi), Math.random() < 0.5 ? [1, -1] : [-1, 1]);
      const sp = rnd(9, 13);
      e.spawn({
        ...s,
        vx: s.nx * sp,
        vy: rnd(-0.5, 0.8),
        vz: s.nz * sp,
        drag: 2.2,
        shape: SHAPE.STREAK,
        tail: 0.2,
        size0: 0.17,
        size1: 0.08,
        life: rnd(0.4, 0.6),
        c0: e.palette.hot,
        c1: e.palette.mid,
        glow: 2.8,
      });
    }
    for (let i = count(lerp(8, 30, e.heat), dt); i > 0; i--) {
      const s = onFace(t, rnd(z.lo, Math.max(z.lo, z.hi - 2)), 0.25);
      e.spawn({
        ...s,
        vx: s.nx * 0.4,
        vy: rnd(0.4, 0.9),
        vz: s.nz * 0.4,
        shape: SHAPE.SQUARE,
        size0: rnd(0.12, 0.18),
        size1: 0.06,
        life: rnd(1.4, 2.2),
        fadeIn: 0.2,
        c0: e.palette.hot,
        c1: e.palette.mid,
        glow: 2,
        flicker: 0.25,
      });
    }
  },
  perfect(e) {
    // A sunburst out of the middle of the tower in frame: rays flat out, all round.
    sunburst(e, lerp(lowZone(e).lo, lowZone(e).hi, 0.6), 16 + Math.round(16 * e.heat));
  },
  tierUp(e) {
    // Two rings of rays, and the corners in frame flash.
    const t = e.tower;
    const z = lowZone(e);
    sunburst(e, lerp(z.lo, z.hi, 0.35), 22 + Math.round(20 * e.heat));
    sunburst(e, lerp(z.lo, z.hi, 0.8), 22 + Math.round(20 * e.heat));
    for (const c of [
      [1, 1],
      [1, -1],
      [-1, 1],
    ] as const) {
      const s = onCorner(t, lerp(z.lo, z.hi, 0.6), c);
      e.spawn({
        ...s,
        shape: SHAPE.GLINT,
        size0: 2.2 + e.heat,
        size1: 0.3,
        life: 0.55,
        fadeIn: 0.15,
        c0: e.palette.hot,
        c1: e.palette.mid,
        glow: 3,
      });
    }
  },
  fizzle(_e, alive) {
    // The light goes out of it: glints close, motes settle.
    for (const p of alive) p.ay = -1.2;
    shorten(alive, 0.5);
  },
};

/** Rays thrown flat out of the tower all round at height y. */
const sunburst = (e: Emit, y: number, n: number): void => {
  const t = e.tower;
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2 + rnd(-0.1, 0.1);
    const sp = rnd(10, 14);
    e.spawn({
      x: t.cx + Math.cos(a) * radius(t) * 0.8,
      y: y + rnd(-0.3, 0.3),
      z: t.cz + Math.sin(a) * radius(t) * 0.8,
      vx: Math.cos(a) * sp,
      vz: Math.sin(a) * sp,
      drag: 2.6,
      shape: SHAPE.STREAK,
      tail: 0.11,
      size0: 0.14,
      size1: 0.07,
      life: rnd(0.35, 0.5),
      c0: e.palette.hot,
      c1: e.palette.mid,
      glow: 3,
    });
  }
};

/** Grid step a data stream's pixels snap to, so a stream reads as code and not as smoke. */
const DATA_STEP = 0.2;

/** Lime: the streak computes. Streams of pixels climb its faces, a bright head leading each. */
const data: ElementBehaviour = {
  ambient(e, dt) {
    for (let i = count(lerp(2.5, 14, e.heat), dt); i > 0; i--) {
      const s = onFace(e.tower, inStreak(e, 1), 0.05);
      // Columns, not anywhere: the stream keeps to a lane across the face.
      if (s.nx !== 0) s.z = Math.round(s.z / DATA_STEP) * DATA_STEP;
      else s.x = Math.round(s.x / DATA_STEP) * DATA_STEP;
      e.spawn({
        ...s,
        vy: rnd(3, 5.5) + 3 * e.heat,
        shape: SHAPE.SQUARE,
        size0: 0.15,
        size1: 0.13,
        life: rnd(0.5, 1),
        c0: e.palette.hot,
        c1: e.palette.mid,
        glow: 2.8,
        trail: 0.045,
      });
    }
  },
  perfect(e) {
    for (let i = 0; i < 6 + 10 * e.heat; i++) {
      const s = onFace(e.tower, e.tower.to - rnd(1.5, 4), 0.05);
      if (s.nx !== 0) s.z = Math.round(s.z / DATA_STEP) * DATA_STEP;
      else s.x = Math.round(s.x / DATA_STEP) * DATA_STEP;
      e.spawn({
        ...s,
        vy: rnd(7, 10),
        shape: SHAPE.SQUARE,
        size0: 0.16,
        size1: 0.14,
        life: rnd(0.45, 0.7),
        c0: e.palette.hot,
        c1: e.palette.mid,
        glow: 3,
        trail: 0.035,
      });
    }
  },
  tierUp(e) {
    // The whole streak streams up at once, and breaks into pixels over the top.
    for (let i = 0; i < 16 + 20 * e.heat; i++) {
      const s = onFace(e.tower, rnd(e.lo, e.tower.to), 0.05);
      if (s.nx !== 0) s.z = Math.round(s.z / DATA_STEP) * DATA_STEP;
      else s.x = Math.round(s.x / DATA_STEP) * DATA_STEP;
      e.spawn({
        ...s,
        vy: rnd(12, 17),
        shape: SHAPE.SQUARE,
        size0: 0.16,
        size1: 0.14,
        life: rnd(0.6, 0.9),
        c0: e.palette.hot,
        c1: e.palette.mid,
        glow: 3,
        trail: 0.03,
      });
    }
    for (let i = 0; i < 24 + 24 * e.heat; i++) {
      const s = onFace(e.tower, e.tower.to);
      const sp = rnd(1.5, 4);
      e.spawn({
        x: s.x,
        y: Math.round(s.y / DATA_STEP) * DATA_STEP,
        z: s.z,
        vx: s.nx * sp,
        vy: rnd(1, 5),
        vz: s.nz * sp,
        ay: -6,
        shape: SHAPE.SQUARE,
        size0: 0.14,
        size1: 0.08,
        life: rnd(0.5, 0.9),
        c0: e.palette.hot,
        c1: e.palette.mid,
        glow: 2.4,
        flicker: 0.5,
      });
    }
  },
  fizzle(_e, alive) {
    // The streams crash: heads stop, what they wrote drops away.
    for (const p of alive) {
      p.trail = 0;
      p.vy = Math.min(p.vy, 0);
      p.ay = -8;
      p.flicker = 0.7;
    }
    shorten(alive, 0.5);
  },
};

/**
 * Jade: wind wraps the tower. Long streaks and turning leaves spiral round it and up, a gust
 * goes off it on each perfect, and a whirlwind on each new name. All on the lower part of the
 * tower in frame, clear of the top.
 */
const wind: ElementBehaviour = {
  ambient(e, dt) {
    const t = e.tower;
    const z = lowZone(e);
    for (let i = count(lerp(16, 60, e.heat), dt); i > 0; i--) {
      const s = around(t, radius(t) * rnd(1.08, 1.45), rnd(z.lo, Math.max(z.lo, z.hi - 1)));
      e.spawn({
        ...s,
        vy: rnd(0.4, 1.2) + e.heat,
        orbit: rnd(2.4, 3.4) + 1.6 * e.heat,
        shape: SHAPE.STREAK,
        tail: 0.12,
        size0: 0.14,
        size1: 0.08,
        life: rnd(0.55, 0.95),
        fadeIn: 0.2,
        c0: e.palette.hot,
        c1: e.palette.mid,
        glow: 2.2,
      });
    }
    for (let i = count(lerp(3, 14, e.heat), dt); i > 0; i--) {
      const s = around(t, radius(t) * rnd(1.1, 1.55), rnd(z.lo, Math.max(z.lo, z.hi - 1)));
      e.spawn({
        ...s,
        vy: rnd(0.6, 1.4),
        orbit: rnd(2.2, 3.2) + 1.5 * e.heat,
        shape: SHAPE.DIAMOND,
        spin: rnd(-6, 6),
        flip: rnd(6, 11),
        size0: rnd(0.28, 0.38),
        size1: 0.18,
        life: rnd(0.9, 1.4),
        fadeIn: 0.15,
        c0: e.palette.hot,
        c1: e.palette.mid,
        glow: 2,
      });
    }
  },
  perfect(e) {
    // A gust off the tower, spiralling out.
    const t = e.tower;
    const z = lowZone(e);
    const y = lerp(z.lo, z.hi, 0.7);
    for (let i = 0; i < 20 + 24 * e.heat; i++) {
      const s = around(t, radius(t) * rnd(0.95, 1.15), y + rnd(-1, 1));
      e.spawn({
        ...s,
        vy: rnd(0.3, 1),
        orbit: rnd(4.5, 6),
        pull: -rnd(3, 5),
        shape: SHAPE.STREAK,
        tail: 0.1,
        size0: 0.15,
        size1: 0.08,
        life: rnd(0.45, 0.65),
        c0: e.palette.hot,
        c1: e.palette.mid,
        glow: 2.4,
      });
    }
  },
  tierUp(e) {
    // A whirlwind up the tower in frame.
    const t = e.tower;
    const z = lowZone(e);
    for (let i = 0; i < 46 + 50 * e.heat; i++) {
      const s = around(t, radius(t) * rnd(1, 1.35), rnd(z.lo, Math.max(z.lo, z.hi - 2.5)));
      e.spawn({
        ...s,
        vy: rnd(1.5, 3),
        orbit: rnd(5.5, 7.5),
        shape: SHAPE.STREAK,
        tail: 0.1,
        size0: 0.16,
        size1: 0.08,
        life: rnd(0.55, 0.85),
        c0: e.palette.hot,
        c1: e.palette.mid,
        glow: 2.6,
      });
    }
  },
  fizzle(_e, alive) {
    // The wind drops and lets everything go, outward.
    for (const p of alive) {
      p.pull = -4;
      p.orbit *= 0.4;
      p.ay = -2;
    }
    shorten(alive, 0.55);
  },
};

/** Violet: the streak pulls. Motes are drawn in out of the dark, and runes turn round it. */
const voidElement: ElementBehaviour = {
  ambient(e, dt) {
    const t = e.tower;
    for (let i = count(lerp(10, 65, e.heat), dt); i > 0; i--) {
      const s = around(t, rnd(3.6, 6.5), inStreak(e, 1.2) + rnd(-0.5, 1.5));
      e.spawn({
        ...s,
        orbit: rnd(0.8, 1.6),
        pull: rnd(2.2, 3.6) + 2 * e.heat,
        absorb: radius(t) * 0.95,
        shape: SHAPE.SQUARE,
        size0: rnd(0.12, 0.2),
        size1: 0.06,
        life: 2.5,
        fadeIn: 0.25,
        c0: e.palette.mid,
        c1: e.palette.hot,
        glow: 2,
      });
    }
    for (let i = count(lerp(0.8, 5, e.heat), dt); i > 0; i--) {
      const s = around(t, radius(t) * rnd(1.35, 1.7), inStreak(e, 1));
      e.spawn({
        ...s,
        vy: rnd(0.2, 0.6),
        orbit: rnd(0.9, 1.4),
        shape: SHAPE.RING,
        rot: rnd(0, 1.5),
        spin: rnd(-1.5, 1.5),
        size0: rnd(0.28, 0.4),
        size1: 0.2,
        life: rnd(1.4, 2.2),
        fadeIn: 0.3,
        c0: e.palette.hot,
        c1: e.palette.mid,
        glow: 1.6,
      });
    }
  },
  perfect(e) {
    // An implosion: a ring of motes rushes in to the top.
    const t = e.tower;
    const n = 18 + Math.round(22 * e.heat);
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2;
      const r = rnd(4.5, 6);
      e.spawn({
        x: t.cx + Math.cos(a) * r,
        y: t.to + rnd(-0.6, 0.3),
        z: t.cz + Math.sin(a) * r,
        orbit: 1.8,
        pull: rnd(9, 12),
        absorb: radius(t) * 0.9,
        shape: SHAPE.SQUARE,
        size0: 0.18,
        size1: 0.06,
        life: 0.8,
        c0: e.palette.mid,
        c1: e.palette.hot,
        glow: 2.6,
      });
    }
  },
  tierUp(e) {
    // A halo of runes takes station round the top and turns.
    const t = e.tower;
    const n = 8 + Math.round(8 * e.heat);
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2;
      const r = radius(t) * 1.55;
      e.spawn({
        x: t.cx + Math.cos(a) * r,
        y: t.to + 0.4,
        z: t.cz + Math.sin(a) * r,
        vy: 0.6,
        orbit: 1.6,
        shape: SHAPE.RING,
        rot: a,
        spin: 2,
        size0: 0.5,
        size1: 0.3,
        life: 1.4,
        fadeIn: 0.15,
        c0: e.palette.hot,
        c1: e.palette.mid,
        glow: 2.4,
      });
    }
    voidElement.perfect(e);
  },
  fizzle(_e, alive) {
    // It lets go: what it was drawing in drifts back out into the dark.
    for (const p of alive) {
      p.pull = -2.5;
      p.absorb = 0;
    }
    shorten(alive, 0.6);
  },
};

/** Rose: the streak blooms. Petals turn over as they lift off its faces and drift. */
const petals: ElementBehaviour = {
  ambient(e, dt) {
    for (let i = count(lerp(6, 40, e.heat), dt); i > 0; i--) {
      const s = onFace(e.tower, inStreak(e), 0.08);
      e.spawn({
        ...s,
        vx: s.nx * rnd(0.4, 1),
        vy: rnd(0.4, 1.1),
        vz: s.nz * rnd(0.4, 1),
        ay: 0.3,
        drag: 0.7,
        wobble: rnd(0.5, 1),
        phase: rnd(0, 6.3),
        shape: SHAPE.DIAMOND,
        rot: rnd(0, 3),
        spin: rnd(-3, 3),
        flip: rnd(5, 9),
        size0: rnd(0.18, 0.3),
        size1: 0.12,
        life: rnd(1.2, 2.1),
        fadeIn: 0.12,
        c0: e.palette.hot,
        c1: e.palette.mid,
        glow: 1.8,
      });
    }
  },
  perfect(e) {
    // A bloom: petals open out off the rim all round.
    for (let i = 0; i < 12 + 22 * e.heat; i++) {
      const s = onFace(e.tower, e.tower.to - rnd(0, 0.3));
      e.spawn({
        ...s,
        vx: s.nx * rnd(2, 4),
        vy: rnd(1.5, 3),
        vz: s.nz * rnd(2, 4),
        ay: -1.5,
        drag: 1.4,
        wobble: 0.6,
        phase: rnd(0, 6.3),
        shape: SHAPE.DIAMOND,
        rot: rnd(0, 3),
        spin: rnd(-5, 5),
        flip: rnd(6, 10),
        size0: rnd(0.22, 0.34),
        size1: 0.14,
        life: rnd(0.9, 1.4),
        c0: e.palette.hot,
        c1: e.palette.mid,
        glow: 2,
      });
    }
  },
  tierUp(e) {
    const t = e.tower;
    const n = 30 + Math.round(40 * e.heat);
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2;
      const sp = rnd(3, 6);
      e.spawn({
        x: t.cx + Math.cos(a) * radius(t) * 0.8,
        y: t.to,
        z: t.cz + Math.sin(a) * radius(t) * 0.8,
        vx: Math.cos(a) * sp,
        vy: rnd(2.5, 6),
        vz: Math.sin(a) * sp,
        ay: -2,
        drag: 1.2,
        shape: SHAPE.DIAMOND,
        rot: a,
        spin: rnd(-6, 6),
        flip: rnd(6, 10),
        size0: rnd(0.24, 0.38),
        size1: 0.14,
        life: rnd(1.1, 1.7),
        c0: e.palette.hot,
        c1: e.palette.mid,
        glow: 2.2,
      });
    }
  },
  fizzle(e, alive) {
    // The petals wilt and fall.
    for (const p of alive) {
      p.ay = -3;
      p.c1 = e.palette.deep;
    }
    shorten(alive, 0.9);
  },
};

export const ELEMENTS: Record<ComboElement, ElementBehaviour> = {
  fire,
  lightning,
  water,
  light,
  data,
  wind,
  void: voidElement,
  petals,
};

// ---------------------------------------------------------------------------------------------
// The particles

const BLANK: Particle = {
  alive: false,
  x: 0,
  y: 0,
  z: 0,
  vx: 0,
  vy: 0,
  vz: 0,
  ay: 0,
  drag: 0,
  age: 0,
  life: 1,
  size0: 0.1,
  size1: 0.1,
  shape: SHAPE.SQUARE,
  rot: 0,
  spin: 0,
  flip: 0,
  c0: [1, 1, 1],
  c1: [1, 1, 1],
  glow: 1,
  flicker: 0,
  fadeIn: 0,
  dx: 0,
  dy: 0,
  dz: 0,
  tail: 0.05,
  orbit: 0,
  pull: 0,
  absorb: 0,
  wobble: 0,
  phase: 0,
  trail: 0,
  trailClock: 0,
};

/** A pool of particles and the physics every element shares. */
export class ComboParticles {
  readonly pool: Particle[] = Array.from({ length: ELEMENT_TUNING.POOL }, () => ({ ...BLANK }));
  private cursor = 0;

  /** A particle from the pool, the oldest reused when it is full. */
  spawn = (init: Partial<Particle>): Particle | null => {
    const n = this.pool.length;
    for (let i = 0; i < n; i++) {
      const p = this.pool[(this.cursor + i) % n]!;
      if (!p.alive) {
        this.cursor = (this.cursor + i + 1) % n;
        return Object.assign(p, BLANK, init, { alive: true, age: 0 });
      }
    }
    const p = this.pool[this.cursor]!;
    this.cursor = (this.cursor + 1) % n;
    return Object.assign(p, BLANK, init, { alive: true, age: 0 });
  };

  alive(): Particle[] {
    return this.pool.filter((p) => p.alive);
  }

  clear(): void {
    for (const p of this.pool) p.alive = false;
  }

  step(dt: number, tower: ComboTower): void {
    for (const p of this.pool) {
      if (!p.alive) continue;
      p.age += dt;
      if (p.age >= p.life) {
        p.alive = false;
        continue;
      }
      p.vy += p.ay * dt;
      if (p.drag) {
        const k = Math.max(0, 1 - p.drag * dt);
        p.vx *= k;
        p.vy *= k;
        p.vz *= k;
      }
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.z += p.vz * dt;
      if (p.orbit || p.pull) {
        const a = p.orbit * dt;
        const c = Math.cos(a);
        const s = Math.sin(a);
        const rx = p.x - tower.cx;
        const rz = p.z - tower.cz;
        const ox = rx * c - rz * s;
        const oz = rx * s + rz * c;
        const r = Math.hypot(ox, oz) || 1e-6;
        const r2 = Math.max(0, r - p.pull * dt);
        p.x = tower.cx + (ox * r2) / r;
        p.z = tower.cz + (oz * r2) / r;
        if (p.pull > 0 && r2 < p.absorb) p.life = Math.min(p.life, p.age + 0.06);
      }
      if (p.wobble) {
        p.x += Math.cos(p.age * 5 + p.phase) * p.wobble * dt;
        p.z += Math.sin(p.age * 4.3 + p.phase) * p.wobble * dt;
      }
      p.rot += p.spin * dt;
      if (p.trail > 0) {
        p.trailClock += dt;
        while (p.trailClock >= p.trail) {
          p.trailClock -= p.trail;
          this.spawn({
            x: p.x,
            y: Math.round(p.y / DATA_STEP) * DATA_STEP,
            z: p.z,
            shape: SHAPE.SQUARE,
            size0: p.size0 * 0.75,
            size1: p.size0 * 0.6,
            life: rnd(0.25, 0.45),
            c0: p.c1,
            c1: p.c1,
            glow: p.glow * 0.5,
            flicker: 0.35,
          });
        }
      }
    }
  }
}
