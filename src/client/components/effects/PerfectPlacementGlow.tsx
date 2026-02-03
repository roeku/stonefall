import React, { useRef, useEffect } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';

interface PerfectPlacementGlowProps {
  active: boolean;
  contactPosition: [number, number, number];
  blockWidth: number;
  blockHeight: number;
  tier?: number; // escalation tier
  onComplete: () => void;
}

export const PerfectPlacementGlow: React.FC<PerfectPlacementGlowProps> = ({ active, contactPosition, blockWidth, blockHeight, tier = 0, onComplete }) => {
  const groupRef = useRef<THREE.Group>(null);
  const startRef = useRef(0);
  const ringCounts: number[] = [3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18];
  const idx = Math.min(Math.max(0, tier), ringCounts.length - 1);
  const RINGS: number = (ringCounts[idx] !== undefined ? ringCounts[idx] : ringCounts[0]) as number;
  const ringRefs = useRef<THREE.Mesh[]>([]);
  const rimFlashRef = useRef<THREE.Mesh | null>(null);
  const columnRef = useRef<THREE.Mesh | null>(null);

  useEffect(() => {
    if (active) {
      startRef.current = performance.now();
    }
  }, [active]);

  useFrame(() => {
    if (!active) return;
    const now = performance.now();
    const elapsed = (now - startRef.current) / 1000;
    const duration = 0.75; // tighter, punchier
    if (elapsed >= duration) {
      onComplete();
      return;
    }
    const t = elapsed / duration; // 0..1

    // TRON: Legacy color scheme - cyan and orange
    const isCyan = tier % 2 === 0;
    const baseHue = isCyan ? 185 : 25; // Cyan or Orange
    const hue = baseHue + Math.sin(t * Math.PI * 2) * 10; // More dramatic breathing
    const coreColor = new THREE.Color(`hsl(${hue},100%,${80 + (1 - t) * 15}%)`);

    // Enhanced rings with more dramatic expansion and TRON grid effect
    ringRefs.current.forEach((mesh, i) => {
      if (!mesh) return;
      const layerT = Math.min(1, t * 1.2 + i * 0.06); // Faster, more staggered
      const ease = 1 - Math.pow(1 - layerT, 2); // Snappier easing
      const tierScaleMult = [1.2, 1.4, 1.6, 1.8, 2.0, 2.3, 2.6, 3.0, 3.4, 3.8, 4.2, 4.6, 5.0, 5.5, 6.0, 6.5][tier] || 1.2;
      const base = 0.8 + i * 0.3;
      const scale = (base + ease * 2.0) * tierScaleMult;
      mesh.scale.set(scale, scale, scale);
      const mat = mesh.material as THREE.MeshBasicMaterial;
      const alpha = Math.max(0, 1.0 - layerT * 1.5) * (i === 0 ? 1 : 0.7);
      mat.opacity = alpha;
      mat.color.copy(coreColor);
      mesh.position.y = (i - 0.5) * 0.08 + Math.sin(t * Math.PI * 4) * 0.02; // More vertical movement
    });

    // Enhanced rim flash with TRON colors
    if (rimFlashRef.current) {
      const flashT = Math.min(1, t * 8.0); // Faster flash
      const flashAlpha = Math.max(0, 1 - flashT * 2.0);
      const rimMult = [1.5, 1.8, 2.1, 2.4, 2.7, 3.0, 3.3, 3.6, 4.0, 4.4, 4.8, 5.2, 5.6, 6.0, 6.5, 7.0][tier] || 1.5;
      (rimFlashRef.current.material as THREE.MeshBasicMaterial).opacity = flashAlpha * 0.8 * rimMult;
      (rimFlashRef.current.material as THREE.MeshBasicMaterial).color.set(isCyan ? '#00f2fe' : '#ff6600');
      const pulse = 1 + Math.sin(flashT * Math.PI * 2) * 0.3; // More dramatic pulse
      rimFlashRef.current.scale.set(pulse, pulse, pulse);
    }

    // Enhanced energy column with TRON beam effect
    if (columnRef.current) {
      const col = columnRef.current;
      const mat = col.material as THREE.MeshBasicMaterial;
      const colT = Math.min(1, t * 1.3);
      const colAlpha = Math.max(0, 0.6 - colT * 0.6) * ([1.5, 1.8, 2.1, 2.4, 2.7, 3.0, 3.3, 3.6, 4.0, 4.4, 4.8, 5.2, 5.6, 6.0, 6.5, 7.0][tier] || 1.5);
      mat.opacity = colAlpha;
      mat.color.set(isCyan ? '#00f2fe' : '#ff6600');
      const widen = 0.8 + colT * 1.5;
      const heightScale = 1 + Math.sin(t * Math.PI * 3) * 0.2; // Pulsing height
      col.scale.set(widen, heightScale, widen);
    }
  });

  if (!active) return null;

  // Geometry allocations
  ringRefs.current = [];

  return (
    <group ref={groupRef} position={contactPosition} renderOrder={1200}>
      {/* TRON-style concentric rings */}
      {/* {Array.from({ length: RINGS }).map((_, i: number) => (
        <mesh
          key={i}
          ref={(m) => { if (m) ringRefs.current[i] = m; }}
          rotation={[-Math.PI / 2, 0, 0]}
        >
          <ringGeometry args={[blockWidth * (0.3 + i * 0.1), blockWidth * (0.35 + i * 0.1), 8]} />
          <meshBasicMaterial transparent opacity={0.9} color={'#00f2fe'} blending={THREE.AdditiveBlending} />
        </mesh>
      ))} */}

      {/* TRON-style rim flash with grid pattern */}
      <mesh ref={rimFlashRef} position={[0, 0, 0]}>
        <boxGeometry args={[blockWidth * 1.05, 0.02, blockWidth * 1.05]} />
        <meshBasicMaterial transparent opacity={0.6} color={'#00f2fe'} blending={THREE.AdditiveBlending} />
      </mesh>

      {/* TRON energy beam column */}
      {/* <mesh ref={columnRef} position={[0, blockHeight * 0.5, 0]}>
        <cylinderGeometry args={[blockWidth * 0.2, blockWidth * 0.1, blockHeight * 1.5, 8, 1, true]} />
        <meshBasicMaterial transparent opacity={0.5} color={'#00f2fe'} side={THREE.DoubleSide} blending={THREE.AdditiveBlending} />
      </mesh> */}

      {/* Additional TRON grid lines */}
      {/* <lineSegments position={[0, 0.1, 0]}>
        <edgesGeometry attach="geometry" args={[new THREE.BoxGeometry(blockWidth * 2, 0.1, blockWidth * 2)]} />
        <lineBasicMaterial color="#00f2fe" opacity={0.8} transparent />
      </lineSegments> */}
    </group>
  );
};
