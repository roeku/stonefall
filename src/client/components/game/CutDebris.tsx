import React, { useCallback, useEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import type { TrimEffect } from '../../../shared/simulation';
import { createRimMaterial } from '../board/rimMaterial';
import { GROUND_Y } from '../board/BoardFloor';

/** A piece the scene wants thrown, beyond what the simulation's trims produce. */
export interface DebrisSpawn {
  key: string;
  x: number;
  y: number;
  z: number;
  width: number;
  height: number;
  depth: number;
  /** Push direction on the floor; the piece is flung this way. */
  dirX: number;
  dirZ: number;
  color?: string | undefined;
}

interface CutDebrisProps {
  trimEffects: ReadonlyArray<TrimEffect>;
  convertPosition: (fixed: number) => number;
  /** One-off pieces, e.g. the block that slid off at game over. */
  extra?: ReadonlyArray<DebrisSpawn> | undefined;
  /**
   * The colour of the block being cut. An offcut is a piece of the player's own tower, so it
   * keeps the tower's colour rather than the hot orange it used to be thrown in -- that orange
   * was the one thing on the board that belonged to nobody.
   */
  color?: string | undefined;
}

/** Pieces kept on the floor. The oldest are reused once the field is full. */
const WHITE = new THREE.Color('#ffffff');
const POOL = 400;
const SPARKS = 500;
/** Where a resting piece's underside lands: the floor the tower stands on. */
const FLOOR_Y = GROUND_Y;
const GRAVITY = 42;
/** Used only until a run hands over its colour. */
const CUT_COLOR = new THREE.Color('#8fdcff');
/** How far a resting piece is dimmed from the colour it was cut in. */
const REST_DIM = 0.42;
/** How far the cut face and its sparks are pushed toward white: the heat of the cut. */
const CUT_HEAT = 0.4;

interface Piece {
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  rot: number;
  spin: number;
  w: number;
  h: number;
  d: number;
  resting: boolean;
  bounces: number;
  landedAt: number;
  color: THREE.Color;
}

interface Spark {
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  life: number;
  color: THREE.Color;
}

/**
 * What gets cut off a block is flung from the tower, falls, bounces on the floor and stays there
 * for the rest of the run.
 *
 * The trims used to dissolve into particles and vanish, so a run left no trace of itself: a
 * fifty-block tower with forty misses looked identical to one with none. Now the floor around
 * the base fills with offcuts as the run goes on -- evidence of every mistake, and of how far
 * the tower got despite them. Each cut also throws a burst of sparks from the cut face, which
 * is the instantaneous half of the same feedback.
 */
export const CutDebris: React.FC<CutDebrisProps> = ({
  trimEffects,
  convertPosition,
  extra,
  color,
}) => {
  const meshRef = useRef<THREE.InstancedMesh>(null);
  const pointsRef = useRef<THREE.Points>(null);
  const pieces = useRef<Piece[]>([]);
  const cursor = useRef(0);
  const seenTrims = useRef(new Set<number>());
  const seenExtra = useRef(new Set<string>());
  const sparks = useRef<Spark[]>(
    Array.from({ length: SPARKS }, () => ({
      x: 0,
      y: -1000,
      z: 0,
      vx: 0,
      vy: 0,
      vz: 0,
      life: 0,
      color: new THREE.Color(CUT_COLOR),
    }))
  );
  const sparkCursor = useRef(0);

  const material = useMemo(() => createRimMaterial({ intensity: 0.9 }), []);
  const geometry = useMemo(() => new THREE.BoxGeometry(1, 1, 1), []);
  const sparkGeometry = useMemo(() => {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(SPARKS * 3), 3));
    g.setAttribute('color', new THREE.BufferAttribute(new Float32Array(SPARKS * 3), 3));
    return g;
  }, []);
  const sparkMaterial = useMemo(
    () =>
      new THREE.PointsMaterial({
        size: 0.55,
        vertexColors: true,
        transparent: true,
        opacity: 0.95,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        toneMapped: false,
      }),
    []
  );
  useEffect(
    () => () => {
      material.dispose();
      geometry.dispose();
      sparkGeometry.dispose();
      sparkMaterial.dispose();
    },
    [material, geometry, sparkGeometry, sparkMaterial]
  );

  const throwPiece = useCallback(
    (spawn: Omit<DebrisSpawn, 'key'>, now: number) => {
      const speed = 7 + Math.random() * 4;
      const piece: Piece = {
        x: spawn.x,
        y: spawn.y,
        z: spawn.z,
        vx: spawn.dirX * speed + (Math.random() - 0.5) * 1.5,
        vy: 3.5 + Math.random() * 2,
        vz: spawn.dirZ * speed + (Math.random() - 0.5) * 1.5,
        rot: 0,
        spin: (Math.random() - 0.5) * 4,
        w: Math.max(0.15, spawn.width),
        h: Math.max(0.15, spawn.height),
        d: Math.max(0.15, spawn.depth),
        resting: false,
        bounces: 0,
        landedAt: 0,
        color: new THREE.Color(spawn.color ?? color ?? CUT_COLOR).lerp(WHITE, CUT_HEAT),
      };
      const slot = cursor.current % POOL;
      pieces.current[slot] = piece;
      cursor.current += 1;
      void now;

      // Sparks off the cut face, thrown the way the piece goes.
      for (let i = 0; i < 26; i++) {
        const s = sparks.current[sparkCursor.current % SPARKS]!;
        sparkCursor.current += 1;
        s.x = spawn.x + (Math.random() - 0.5) * spawn.width;
        s.y = spawn.y + (Math.random() - 0.5) * spawn.height;
        s.z = spawn.z + (Math.random() - 0.5) * spawn.depth;
        s.vx = spawn.dirX * (4 + Math.random() * 10) + (Math.random() - 0.5) * 6;
        s.vy = 2 + Math.random() * 9;
        s.vz = spawn.dirZ * (4 + Math.random() * 10) + (Math.random() - 0.5) * 6;
        s.life = 0.35 + Math.random() * 0.35;
        s.color.copy(piece.color).lerp(WHITE, 0.3);
      }
    },
    [color]
  );

  // New trims from the simulation. Pieces come in fixed-point with the block's own convention:
  // y is the underside. Direction is away from the tower's axis at the origin.
  useEffect(() => {
    const now = performance.now();
    for (const effect of trimEffects) {
      if (seenTrims.current.has(effect.tick)) continue;
      seenTrims.current.add(effect.tick);
      for (const piece of effect.trimmedPieces) {
        const x = convertPosition(piece.x);
        const z = convertPosition(piece.z ?? 0);
        const h = convertPosition(piece.height);
        const len = Math.hypot(x, z) || 1;
        throwPiece(
          {
            x,
            y: convertPosition(piece.y) + h / 2,
            z,
            width: convertPosition(piece.width),
            height: h,
            depth: convertPosition(piece.depth ?? piece.width),
            dirX: x / len,
            dirZ: z / len,
          },
          now
        );
      }
    }
  }, [trimEffects, convertPosition, throwPiece]);

  useEffect(() => {
    if (!extra) return;
    const now = performance.now();
    for (const spawn of extra) {
      if (seenExtra.current.has(spawn.key)) continue;
      seenExtra.current.add(spawn.key);
      throwPiece(spawn, now);
    }
  }, [extra, throwPiece]);

  const tmpMatrix = useMemo(() => new THREE.Matrix4(), []);
  const tmpPos = useMemo(() => new THREE.Vector3(), []);
  const tmpQuat = useMemo(() => new THREE.Quaternion(), []);
  const tmpScale = useMemo(() => new THREE.Vector3(), []);
  const tmpEuler = useMemo(() => new THREE.Euler(), []);
  const tmpColor = useMemo(() => new THREE.Color(), []);

  useFrame((_, delta) => {
    const dt = Math.min(delta, 0.05);
    const mesh = meshRef.current;
    const list = pieces.current;
    const count = Math.min(cursor.current, POOL);
    if (mesh) {
      if (!mesh.instanceColor) {
        mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(POOL * 3), 3);
      }
      const nowMs = performance.now();
      for (let i = 0; i < count; i++) {
        const p = list[i];
        if (!p) continue;
        if (!p.resting) {
          p.vy -= GRAVITY * dt;
          p.x += p.vx * dt;
          p.y += p.vy * dt;
          p.z += p.vz * dt;
          p.rot += p.spin * dt;
          const restY = FLOOR_Y + p.h / 2;
          if (p.y <= restY) {
            p.y = restY;
            if (p.bounces < 2 && Math.abs(p.vy) > 3) {
              // A bounce, with the horizontal speed bleeding off each time.
              p.vy = -p.vy * 0.32;
              p.vx *= 0.55;
              p.vz *= 0.55;
              p.spin *= 0.5;
              p.bounces += 1;
            } else {
              p.resting = true;
              p.vx = 0;
              p.vy = 0;
              p.vz = 0;
              p.spin = 0;
              p.rot = Math.round(p.rot / (Math.PI / 2)) * (Math.PI / 2);
              p.landedAt = nowMs;
            }
          }
        }
        tmpPos.set(p.x, p.y, p.z);
        tmpEuler.set(0, p.rot, 0);
        tmpQuat.setFromEuler(tmpEuler);
        tmpScale.set(p.w, p.h, p.d);
        tmpMatrix.compose(tmpPos, tmpQuat, tmpScale);
        mesh.setMatrixAt(i, tmpMatrix);
        // Bright while flying, a quick flare as it lands, then dim: what is on the floor is
        // a record, not the action.
        if (p.resting) {
          const since = (nowMs - p.landedAt) / 1000;
          const flare = since < 0.18 ? 1 - since / 0.18 : 0;
          tmpColor.copy(p.color).multiplyScalar(REST_DIM).lerp(p.color, flare);
        } else {
          tmpColor.copy(p.color);
        }
        mesh.setColorAt(i, tmpColor);
      }
      mesh.count = count;
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    }

    const points = pointsRef.current;
    if (points) {
      const pos = points.geometry.getAttribute('position') as THREE.BufferAttribute;
      const col = points.geometry.getAttribute('color') as THREE.BufferAttribute;
      for (let i = 0; i < SPARKS; i++) {
        const s = sparks.current[i]!;
        if (s.life <= 0) {
          pos.setXYZ(i, 0, -1000, 0);
          continue;
        }
        s.life -= dt;
        s.vy -= GRAVITY * 0.8 * dt;
        s.x += s.vx * dt;
        s.y += s.vy * dt;
        s.z += s.vz * dt;
        if (s.y < FLOOR_Y) {
          s.y = FLOOR_Y;
          s.vy = -s.vy * 0.3;
        }
        pos.setXYZ(i, s.x, s.y, s.z);
        const a = Math.max(0, Math.min(1, s.life / 0.4));
        col.setXYZ(i, s.color.r * a, s.color.g * a, s.color.b * a);
      }
      pos.needsUpdate = true;
      col.needsUpdate = true;
    }
  });

  return (
    <group name="cut-debris">
      <instancedMesh
        ref={meshRef}
        args={[geometry, material, POOL]}
        frustumCulled={false}
        raycast={() => null}
      />
      <points
        ref={pointsRef}
        geometry={sparkGeometry}
        material={sparkMaterial}
        frustumCulled={false}
      />
    </group>
  );
};
