import React, { useRef, useMemo, useEffect } from 'react';
import * as THREE from 'three';
import { useFrame } from '@react-three/fiber';
import { GameState } from '../../shared/simulation';

// Small, fast value-noise implementation for smooth, non-repeating motion.
function hash(n: number) {
  return Math.sin(n) * 43758.5453123 - Math.floor(Math.sin(n) * 43758.5453123);
}

function valueNoise2(x: number, y: number) {
  // grid cell
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const xf = x - xi;
  const yf = y - yi;

  const s00 = hash(xi + yi * 57);
  const s10 = hash(xi + 1 + yi * 57);
  const s01 = hash(xi + (yi + 1) * 57);
  const s11 = hash(xi + 1 + (yi + 1) * 57);

  // smoothstep interpolation
  const u = xf * xf * (3 - 2 * xf);
  const v = yf * yf * (3 - 2 * yf);

  const a = s00 * (1 - u) + s10 * u;
  const b = s01 * (1 - u) + s11 * u;

  return a * (1 - v) + b * v;
}

interface Props {
  gameState: GameState | null;
  convertPosition: (fixedValue: number) => number;
}

export const FloatingParticles: React.FC<Props> = ({ gameState, convertPosition }) => {
  // Emitter-style particle pool -------------------------------------------------
  const pointsRef = useRef<THREE.Points | null>(null);
  const particleCount = 220;
  const pool = useRef(
    Array.from({ length: particleCount }).map(() => ({
      pos: new THREE.Vector3(0, 0, 0),
      vel: new THREE.Vector3(0, 0, 0),
      life: 0,
      size: 0.08 + Math.random() * 0.06,
      color: new THREE.Color(0.06 + Math.random() * 0.04, 0.8 + Math.random() * 0.12, 0.94 + Math.random() * 0.06),
    }))
  );

  const geometry = useMemo(() => {
    const g = new THREE.BufferGeometry();
    const positions = new Float32Array(particleCount * 3);
    const colors = new Float32Array(particleCount * 3);
    const sizes = new Float32Array(particleCount);
    for (let i = 0; i < particleCount; i++) {
      positions[i * 3] = 0;
      positions[i * 3 + 1] = 0;
      positions[i * 3 + 2] = 0;
      const p = pool.current[i]!;
      colors[i * 3] = p.color.r;
      colors[i * 3 + 1] = p.color.g;
      colors[i * 3 + 2] = p.color.b;
      sizes[i] = p.size;
    }
    g.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    g.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    g.setAttribute('size', new THREE.BufferAttribute(sizes, 1));
    // Prevent Three.js from frustum-culling the particle system based on stale bounding info
    g.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 0, 0), 1000);
    return g;
  }, []);

  const material = useMemo(() => {
    return new THREE.PointsMaterial({
      vertexColors: true,
      size: 0.06,
      sizeAttenuation: true,
      transparent: true,
      opacity: 0.95,
      depthWrite: false,
      depthTest: true,
      blending: THREE.AdditiveBlending,
    });
  }, []);

  useEffect(() => {
    if (pointsRef.current) {
      pointsRef.current.renderOrder = -1;
      pointsRef.current.frustumCulled = false;
    }
  }, []);

  // spawn queue: when blocks placed push spawn requests (store block snapshot so we can spawn from edges)
  const spawnQueue = useRef<Array<{ x: number; y: number; z?: number; width: number; depth?: number; height: number; count: number }>>([]);

  // detect new placements and queue a burst at the placement location
  const prevLen = useRef(0);
  useEffect(() => {
    if (!gameState) return;
    const len = gameState.blocks.length;
    if (len > prevLen.current) {
      // spawn around the last placed block
      const last = gameState.blocks[len - 1];
      if (last) {
        // push a snapshot of block fixed-values; we'll compute edge spawn positions when processing the queue
        spawnQueue.current.push({ x: last.x, y: last.y, z: last.z ?? 0, width: last.width, depth: last.depth ?? last.width, height: last.height, count: 18 + Math.floor(Math.random() * 18) });
      }
    }
    // ambient small emission from the top few blocks
    prevLen.current = len;
  }, [gameState, convertPosition]);

  useFrame((state, delta) => {
    const now = state.clock.getElapsedTime();
    const posAttr = geometry.attributes.position as THREE.BufferAttribute;
    const colorAttr = geometry.attributes.color as THREE.BufferAttribute;
    const sizeAttr = geometry.attributes.size as THREE.BufferAttribute | undefined;
    const positions = posAttr.array as Float32Array;

    // handle spawn queue (burst spawns)
    for (let q = 0; q < spawnQueue.current.length; q++) {
      const item = spawnQueue.current[q];
      if (!item) continue;
      const worldW = convertPosition(item.width);
      const worldD = convertPosition(item.depth ?? item.width);
      const worldX = convertPosition(item.x);
      const worldZ = convertPosition(item.z ?? 0);
      const topY = convertPosition(item.y + item.height);
      let toSpawn = item.count;
      for (let i = 0; i < pool.current.length && toSpawn > 0; i++) {
        const p = pool.current[i]!;
        if (p.life <= 0) {
          // spawn particle at a random point on the block's perimeter (edge)
          const side = Math.floor(Math.random() * 4);
          const jitter = 0.02 + Math.random() * 0.08;
          let sx = worldX;
          let sz = worldZ;
          if (side === 0) {
            // +X edge
            sx = worldX + worldW / 2 + jitter;
            sz = worldZ + (Math.random() - 0.5) * worldD;
          } else if (side === 1) {
            // -X edge
            sx = worldX - worldW / 2 - jitter;
            sz = worldZ + (Math.random() - 0.5) * worldD;
          } else if (side === 2) {
            // +Z edge
            sz = worldZ + worldD / 2 + jitter;
            sx = worldX + (Math.random() - 0.5) * worldW;
          } else {
            // -Z edge
            sz = worldZ - worldD / 2 - jitter;
            sx = worldX + (Math.random() - 0.5) * worldW;
          }
          const sy = topY + (Math.random() * 0.06 - 0.02);
          // small outward velocity
          const outward = 0.4 + Math.random() * 0.8;
          let vx = (Math.random() - 0.5) * 0.2;
          let vz = (Math.random() - 0.5) * 0.2;
          if (side === 0) vx = outward;
          if (side === 1) vx = -outward;
          if (side === 2) vz = outward;
          if (side === 3) vz = -outward;
          p.pos.set(sx, sy, sz);
          p.vel.set(vx + (Math.random() - 0.5) * 0.2, 0.6 + Math.random() * 1.0, vz + (Math.random() - 0.5) * 0.2);
          p.life = 0.8 + Math.random() * 1.2;
          toSpawn--;
        }
      }
    }
    spawnQueue.current.length = 0;

    // ambient emission from top blocks (gentle stream)
    if (gameState && gameState.blocks.length > 0) {
      const topIndex = Math.max(0, gameState.blocks.length - 1);
      const top = gameState.blocks[topIndex];
      if (top) {
        // spawn a tiny number continuously from the top block edges
        if (Math.random() < 0.08) {
          const worldW = convertPosition(top.width);
          const worldD = convertPosition(top.depth ?? top.width);
          const worldX = convertPosition(top.x);
          const worldZ = convertPosition(top.z ?? 0);
          const topY = convertPosition(top.y + top.height);
          for (let i = 0; i < pool.current.length; i++) {
            const p = pool.current[i]!;
            if (p.life <= 0) {
              const side = Math.floor(Math.random() * 4);
              const jitter = 0.02 + Math.random() * 0.06;
              let sx = worldX;
              let sz = worldZ;
              if (side === 0) {
                sx = worldX + worldW / 2 + jitter;
                sz = worldZ + (Math.random() - 0.5) * worldD;
              } else if (side === 1) {
                sx = worldX - worldW / 2 - jitter;
                sz = worldZ + (Math.random() - 0.5) * worldD;
              } else if (side === 2) {
                sz = worldZ + worldD / 2 + jitter;
                sx = worldX + (Math.random() - 0.5) * worldW;
              } else {
                sz = worldZ - worldD / 2 - jitter;
                sx = worldX + (Math.random() - 0.5) * worldW;
              }
              const sy = topY + (Math.random() - 0.5) * 0.05;
              p.pos.set(sx, sy, sz);
              p.vel.set((Math.random() - 0.5) * 0.2, 0.5 + Math.random() * 0.6, (Math.random() - 0.5) * 0.2);
              p.life = 0.6 + Math.random() * 1.0;
              break;
            }
          }
        }
      }
    }

    // update particles
    for (let i = 0; i < pool.current.length; i++) {
      const p = pool.current[i]!;
      if (p.life > 0) {
        // noise-driven gentle motion
        const t = now * (0.5 + i * 0.001);
        const nx = (valueNoise2(t + i * 0.13, i * 0.21) - 0.5) * 0.08;
        const nz = (valueNoise2(t * 0.9 + i * 0.31, i * 0.14) - 0.5) * 0.06;
        p.vel.x += nx * delta * 6;
        p.vel.z += nz * delta * 6;
        // gravity-ish slight descent after initial rise
        p.vel.y -= 0.9 * delta * 0.5;
        p.pos.addScaledVector(p.vel, delta);

        // fade out
        p.life -= delta;
        // write back to buffer (lerp for smoother motion on CPU updates)
        const px = positions[i * 3] || 0;
        const py = positions[i * 3 + 1] || 0;
        const pz = positions[i * 3 + 2] || 0;
        positions[i * 3] = THREE.MathUtils.lerp(px, p.pos.x, 0.5);
        positions[i * 3 + 1] = THREE.MathUtils.lerp(py, p.pos.y, 0.5);
        positions[i * 3 + 2] = THREE.MathUtils.lerp(pz, p.pos.z, 0.5);
        // slight color dimming as life decreases (encoded in green channel)
        const g = Math.max(0.15, 0.8 * Math.max(0, p.life / 1.6));
        // use setXYZ to update the triplet correctly
        colorAttr.setXYZ(i, p.color.r, g, p.color.b);
        // optionally update size attribute if present
        if (sizeAttr) {
          sizeAttr.setX(i, p.size * (0.8 + 0.4 * (p.life > 0 ? p.life : 0)));
        }
      }
    }

    posAttr.needsUpdate = true;
    colorAttr.needsUpdate = true;
    if (geometry.attributes.size) (geometry.attributes.size as THREE.BufferAttribute).needsUpdate = true;
  });

  if (!gameState) return null;

  return <points ref={pointsRef} geometry={geometry} material={material} />;
};

export default FloatingParticles;
