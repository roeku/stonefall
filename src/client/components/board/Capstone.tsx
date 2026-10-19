import React, { useEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';

/**
 * The capstone: the day's gift, falling onto the tower that earned it (shared/social/progress.ts).
 *
 * It is drawn over everything, depth ignored: on the map the tower it lands on is often behind
 * taller ones, and a gift hidden behind somebody else's skyline is no gift. The map steps back
 * while it falls (App's spotlight), so it is the brightest thing on screen.
 *
 * A stone out of the sky, in the player's colour or in gold. It is heard before it is seen (a
 * whistle that narrows as it comes), lands on the top of the tower with weight, sits there
 * cracking while the light inside it builds, and breaks open into shards and XP. The wait between
 * landing and breaking is the point: a gift is opened, not handed over, and the half second of not
 * yet knowing is what makes it one.
 *
 * Nothing here moves the camera: a fly to the tower was tried for stones and lost short towers in
 * a dense map. The tower is already where the player is looking, because they just raised it.
 */

/** Every number the capstone is tuned by. Times in ms, distances in world units. */
export const CAPSTONE = {
  /** From appearing high over the tower to touching its top. */
  FALL_MS: 560,
  /** How far above the top it appears. */
  FALL_HEIGHT: 70,
  /** The squash on landing, and how long it takes to settle. */
  SQUASH: 0.55,
  SQUASH_MS: 160,
  /** Sitting on the tower cracking, before it breaks. */
  HOLD_MS: 520,
  /** When in the hold each crack comes. */
  CRACKS_MS: [130, 280, 410],
  /** How far it shakes at the last crack. */
  SHAKE: 0.35,
  /** Shards flying and fading after it breaks. */
  BURST_MS: 800,
  SHARDS: 14,
  /** Shards' speed out and up, and the gravity that brings them down, units per second. */
  SHARD_SPEED: 26,
  SHARD_LIFT: 22,
  GRAVITY: 70,
  /** The stone: a slab the game's own thickness, a little narrower than a tower. */
  WIDTH: 4.6,
  HEIGHT: 1.5,
  /** The streak it leaves while falling. */
  TRAIL: 14,
} as const;

/** When each beat of a capstone happens, from the moment it starts falling. */
export const capstoneTimes = {
  land: CAPSTONE.FALL_MS,
  burst: CAPSTONE.FALL_MS + CAPSTONE.HOLD_MS,
  done: CAPSTONE.FALL_MS + CAPSTONE.HOLD_MS + CAPSTONE.BURST_MS,
};

export interface CapstoneDrop {
  key: number;
  /** World position of the top of the tower it lands on. */
  x: number;
  y: number;
  z: number;
  /** The player's colour, as hex. */
  color: string;
  golden: boolean;
  /** performance.now() when it starts to fall. */
  at: number;
  /**
   * How big it is drawn: 1 at street level, larger over the map, where a tower is a needle and a
   * stone its own width would be a speck.
   */
  size: number;
}

const GOLD = '#ffd166';

/** What a capstone's beats set off: sounds, a jolt, a ring, the XP inside it. */
export interface CapstoneBeats {
  onLand?: ((drop: CapstoneDrop) => void) | undefined;
  onCrack?: ((drop: CapstoneDrop, i: number) => void) | undefined;
  onBurst?: ((drop: CapstoneDrop) => void) | undefined;
  onDone?: ((drop: CapstoneDrop) => void) | undefined;
}

/** A shard's own flight: where it heads and how it turns, fixed per capstone. */
interface Shard {
  dir: THREE.Vector3;
  spin: THREE.Vector3;
  size: number;
}

const shardsFor = (seed: number): Shard[] => {
  let s = (seed * 2654435761) >>> 0;
  const rand = () => {
    s = (Math.imul(s ^ (s >>> 15), 2246822507) + 0x9e3779b9) >>> 0;
    return s / 4294967296;
  };
  return Array.from({ length: CAPSTONE.SHARDS }, (_, i) => {
    const a = (i / CAPSTONE.SHARDS) * Math.PI * 2 + rand() * 0.5;
    return {
      dir: new THREE.Vector3(Math.cos(a), 0.4 + rand() * 0.9, Math.sin(a)),
      spin: new THREE.Vector3(rand() * 10 - 5, rand() * 10 - 5, rand() * 10 - 5),
      size: 0.55 + rand() * 0.75,
    };
  });
};

/**
 * Set a material's opacity. Through a function rather than in place, because the materials are
 * the component's own memoised values and are changed only from the frame loop.
 */
const setOpacity = (m: THREE.Material, opacity: number): void => {
  m.opacity = opacity;
};

const easeOutBack = (t: number): number => {
  const c = 1.7;
  return 1 + (c + 1) * Math.pow(t - 1, 3) + c * Math.pow(t - 1, 2);
};

const OneCapstone: React.FC<{ drop: CapstoneDrop } & CapstoneBeats> = ({ drop, ...beats }) => {
  const stone = useRef<THREE.Group>(null);
  const trail = useRef<THREE.Mesh>(null);
  const shardGroup = useRef<THREE.Group>(null);
  const fired = useRef(new Set<string>());
  const hex = drop.golden ? GOLD : drop.color;
  const shards = useMemo(() => shardsFor(drop.key), [drop.key]);

  const { box, edges, body, rim, glow, trailMat, shardBody, shardRim } = useMemo(() => {
    const box = new THREE.BoxGeometry(1, 1, 1);
    const edges = new THREE.EdgesGeometry(box);
    const colour = new THREE.Color(hex);
    const body = new THREE.MeshBasicMaterial({
      color: colour.clone().multiplyScalar(0.28),
      transparent: true,
      depthTest: false,
      depthWrite: false,
      toneMapped: false,
    });
    const rim = new THREE.LineBasicMaterial({
      color: colour.clone().lerp(new THREE.Color('#ffffff'), 0.2),
      transparent: true,
      depthTest: false,
      depthWrite: false,
      toneMapped: false,
    });
    const glow = colour.clone();
    const trailMat = new THREE.MeshBasicMaterial({
      color: colour.clone().lerp(new THREE.Color('#ffffff'), 0.4),
      transparent: true,
      opacity: 0.5,
      depthTest: false,
      depthWrite: false,
      toneMapped: false,
    });
    const shardBody = body.clone();
    const shardRim = rim.clone();
    return { box, edges, body, rim, glow, trailMat, shardBody, shardRim };
  }, [hex]);

  useEffect(
    () => () => {
      box.dispose();
      edges.dispose();
      body.dispose();
      rim.dispose();
      trailMat.dispose();
      shardBody.dispose();
      shardRim.dispose();
    },
    [box, edges, body, rim, trailMat, shardBody, shardRim]
  );

  const once = (name: string, fn: () => void) => {
    if (fired.current.has(name)) return;
    fired.current.add(name);
    fn();
  };

  useFrame(() => {
    const g = stone.current;
    const t = performance.now() - drop.at;
    if (!g) return;
    const w = CAPSTONE.WIDTH * drop.size;
    const h = CAPSTONE.HEIGHT * drop.size;
    const restY = drop.y + h / 2;
    const fall = CAPSTONE.FALL_HEIGHT * Math.sqrt(drop.size);

    if (t < 0) {
      g.visible = false;
      return;
    }

    if (t < CAPSTONE.FALL_MS) {
      // Falling, faster and faster: gravity, not a tween.
      const k = t / CAPSTONE.FALL_MS;
      g.visible = true;
      g.position.set(drop.x, restY + fall * (1 - k * k), drop.z);
      // Stretched along the fall as it picks up speed.
      g.scale.set(w * (1 - 0.15 * k), h * (1 + 0.6 * k), w * (1 - 0.15 * k));
      g.rotation.y = (1 - k) * 0.9;
      if (trail.current) {
        trail.current.visible = true;
        const len = CAPSTONE.TRAIL * drop.size * (0.3 + k);
        trail.current.position.set(drop.x, g.position.y + h / 2 + len / 2, drop.z);
        trail.current.scale.set(0.35 * drop.size, len, 0.35 * drop.size);
        setOpacity(trailMat, 0.55 * (0.4 + k * 0.6));
      }
      setOpacity(body, 1);
      setOpacity(rim, 1);
      return;
    }
    if (trail.current) trail.current.visible = false;

    const sinceLand = t - CAPSTONE.FALL_MS;
    once('land', () => beats.onLand?.(drop));

    if (sinceLand < CAPSTONE.HOLD_MS) {
      // On the tower, cracking. Squashed by the landing, then settling with a little overshoot;
      // shaking harder at each crack, the light inside it building.
      const settle = Math.min(1, sinceLand / CAPSTONE.SQUASH_MS);
      const squash = 1 - CAPSTONE.SQUASH * (1 - easeOutBack(settle));
      const cracks = CAPSTONE.CRACKS_MS.filter((ms) => sinceLand >= ms).length;
      CAPSTONE.CRACKS_MS.forEach((ms, i) => {
        if (sinceLand >= ms) once(`crack${i}`, () => beats.onCrack?.(drop, i));
      });
      const shake = (CAPSTONE.SHAKE * drop.size * cracks) / CAPSTONE.CRACKS_MS.length;
      const jitter = () => (Math.random() * 2 - 1) * shake;
      g.visible = true;
      g.rotation.y = 0;
      g.scale.set(w * (2 - squash), h * squash, w * (2 - squash));
      g.position.set(drop.x + jitter(), drop.y + (h * squash) / 2, drop.z + jitter());
      const build = sinceLand / CAPSTONE.HOLD_MS;
      const pulse = 0.5 + 0.5 * Math.sin(sinceLand * 0.04 * (1 + build * 2));
      body.color.copy(glow).multiplyScalar(0.28 + build * build * 0.9 * pulse);
      return;
    }

    const sinceBurst = sinceLand - CAPSTONE.HOLD_MS;
    once('burst', () => beats.onBurst?.(drop));
    if (sinceBurst >= CAPSTONE.BURST_MS) {
      g.visible = false;
      if (shardGroup.current) shardGroup.current.visible = false;
      once('done', () => beats.onDone?.(drop));
      return;
    }

    // Broken: the stone swells and is gone in a flash, the shards fly and fall.
    const flash = Math.min(1, sinceBurst / 140);
    g.position.set(drop.x, restY, drop.z);
    g.scale.set(w * (1 + flash * 0.5), h * (1 + flash * 0.5), w * (1 + flash * 0.5));
    body.color.set('#ffffff');
    setOpacity(body, 1 - flash);
    setOpacity(rim, 1 - flash);
    g.visible = flash < 1;

    const sg = shardGroup.current;
    if (!sg) return;
    sg.visible = true;
    const s = sinceBurst / 1000;
    const fade = 1 - sinceBurst / CAPSTONE.BURST_MS;
    setOpacity(shardBody, fade);
    setOpacity(shardRim, fade);
    sg.children.forEach((child, i) => {
      const shard = shards[i];
      if (!shard) return;
      const z = drop.size;
      child.position.set(
        drop.x + shard.dir.x * CAPSTONE.SHARD_SPEED * z * s,
        restY + (shard.dir.y * CAPSTONE.SHARD_LIFT * s - 0.5 * CAPSTONE.GRAVITY * s * s) * z,
        drop.z + shard.dir.z * CAPSTONE.SHARD_SPEED * z * s
      );
      child.rotation.set(shard.spin.x * s, shard.spin.y * s, shard.spin.z * s);
      const k = shard.size * z * (0.6 + 0.4 * fade);
      child.scale.set(k, k, k);
    });
  });

  return (
    <group name="capstone">
      <group ref={stone} visible={false}>
        <mesh geometry={box} material={body} renderOrder={20} raycast={() => null} />
        <lineSegments geometry={edges} material={rim} renderOrder={21} raycast={() => null} />
      </group>
      <mesh
        ref={trail}
        geometry={box}
        material={trailMat}
        visible={false}
        renderOrder={19}
        raycast={() => null}
      />
      <group ref={shardGroup} visible={false}>
        {shards.map((_, i) => (
          <group key={i}>
            <mesh geometry={box} material={shardBody} renderOrder={20} raycast={() => null} />
            <lineSegments
              geometry={edges}
              material={shardRim}
              renderOrder={21}
              raycast={() => null}
            />
          </group>
        ))}
      </group>
    </group>
  );
};

/** Every capstone falling or breaking right now. */
export const Capstones: React.FC<{ drops: readonly CapstoneDrop[] } & CapstoneBeats> = ({
  drops,
  ...beats
}) => (
  <>
    {drops.map((d) => (
      <OneCapstone key={d.key} drop={d} {...beats} />
    ))}
  </>
);
