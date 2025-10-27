import React, { useRef, useMemo } from 'react';
import * as THREE from 'three';
import { useFrame, useThree } from '@react-three/fiber';
import { GameState, FixedMath } from '../../shared/simulation';

/*
 Radial end stats display - clean, camera-aligned, game-like aesthetics
 Fixed circular layout around tower base with proper billboarding and positioning
*/

export interface EndStatsRadialProps { gameState: GameState; }

interface StatPanel { key: string; label: string; value: string; accent: string; }

export const EndStatsRadial: React.FC<EndStatsRadialProps> = ({ gameState }) => {
  const rootRef = useRef<THREE.Group>(null);

  // Global stats
  const g: any = globalThis as any;
  const perfects = g.__PERFECT_COUNT || 0;
  const maxPerfectStreak = g.__MAX_PERFECT_STREAK || 0;
  const blocksPlaced = Math.max(0, (gameState.blocks?.length || 0) - 1);
  const accuracy = blocksPlaced > 0 ? (perfects / blocksPlaced) * 100 : 0;

  // Tower analysis
  const { towerHeight, towerTop, towerCenter, towerFootprintRadius } = useMemo(() => {
    // First pass: collect block centers and sizes, compute vertical extents
    let minY = Infinity, maxY = -Infinity;
    let sumX = 0, sumZ = 0;
    const pos: { x: number; z: number; width: number; depth: number }[] = [];

    for (const block of gameState.blocks) {
      const bx = FixedMath.toFloat(block.x);
      const bz = FixedMath.toFloat(block.z || 0);
      const by = FixedMath.toFloat(block.y);
      const bh = FixedMath.toFloat(block.height);
      const bwidth = FixedMath.toFloat((block as any).width ?? 1);
      const bdepth = FixedMath.toFloat((block as any).depth ?? bwidth);

      const bottom = by - bh / 2;
      const top = by + bh / 2;
      if (bottom < minY) minY = bottom;
      if (top > maxY) maxY = top;

      sumX += bx;
      sumZ += bz;
      pos.push({ x: bx, z: bz, width: bwidth, depth: bdepth });
    }

    const count = pos.length;
    const centerX = count > 0 ? sumX / count : 0;
    const centerZ = count > 0 ? sumZ / count : 0;

    // Compute maximum horizontal distance from the computed center, including block half-diagonals
    let maxRadius = 0;
    for (const p of pos) {
      const dx = p.x - centerX;
      const dz = p.z - centerZ;
      const centerDist = Math.sqrt(dx * dx + dz * dz);
      const halfDiag = Math.sqrt((p.width / 2) * (p.width / 2) + (p.depth / 2) * (p.depth / 2));
      maxRadius = Math.max(maxRadius, centerDist + halfDiag);
    }

    const top = isFinite(maxY) ? maxY : 0;
    const bottom = isFinite(minY) ? minY : 0;
    const height = top - bottom;
    return {
      towerHeight: height,
      towerTop: top,
      // footprint is now robust to block size and centroid
      towerFootprintRadius: maxRadius,
      towerCenter: {
        x: centerX,
        z: centerZ,
        // use geometric center (midpoint)
        y: count > 0 ? (bottom + top) / 2 : 0,
      },
    };
  }, [gameState.blocks]);

  // Stats panels with gaming aesthetics
  const panels: StatPanel[] = useMemo(() => [
    { key: 'score', label: 'SCORE', value: gameState.score.toString(), accent: '#FFD700' },
    { key: 'height', label: 'HEIGHT', value: `${towerHeight.toFixed(1)}u`, accent: '#00FFFF' },
    { key: 'blocks', label: 'BLOCKS', value: blocksPlaced.toString(), accent: '#FFFFFF' },
    { key: 'perfects', label: 'PERFECTS', value: perfects.toString(), accent: '#00FF88' },
    { key: 'streak', label: 'MAX STREAK', value: maxPerfectStreak.toString(), accent: '#FF6B6B' },
    { key: 'accuracy', label: 'ACCURACY', value: `${Math.round(accuracy)}%`, accent: '#BB86FC' },
  ], [gameState.score, towerHeight, blocksPlaced, perfects, maxPerfectStreak, accuracy]);

  // Memoized panel textures
  const panelTextures = useMemo(() => {
    return panels.map(panel => {
      const isPrimary = panel.key === 'score';
      const canvas = document.createElement('canvas');
      const size = isPrimary ? 1024 : 768;
      const dpr = Math.max(1, Math.floor(window.devicePixelRatio || 1));
      canvas.width = canvas.height = size * dpr;
      // keep logical coordinate system so drawing math remains the same
      const ctx = canvas.getContext('2d')!;
      ctx.scale(dpr, dpr);
      const centerX = size / 2;
      const centerY = size / 2;

      // Clear background
      ctx.fillStyle = 'rgba(0, 0, 0, 0)';
      ctx.fillRect(0, 0, size, size);

      // Outer glow
      const gradient = ctx.createRadialGradient(centerX, centerY, size * 0.3, centerX, centerY, size * 0.5);
      gradient.addColorStop(0, panel.accent + '40');
      gradient.addColorStop(1, 'transparent');
      ctx.fillStyle = gradient;
      ctx.fillRect(0, 0, size, size);

      // Panel background
      ctx.fillStyle = 'rgba(10, 20, 40, 0.95)';
      ctx.roundRect(size * 0.1, size * 0.1, size * 0.8, size * 0.8, size * 0.05);
      ctx.fill();

      // Border
      ctx.strokeStyle = panel.accent;
      ctx.lineWidth = size * 0.008;
      ctx.stroke();

      // Value text
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      // Slightly increase font sizes for legibility
      ctx.font = `bold ${size * (isPrimary ? 0.18 : 0.16) * 1.15}px system-ui, sans-serif`;
      ctx.fillStyle = panel.accent;
      ctx.shadowColor = panel.accent;
      ctx.shadowBlur = size * 0.02;
      ctx.fillText(panel.value, centerX, centerY - size * 0.08);

      // Label text
      ctx.shadowBlur = size * 0.01;
      ctx.font = `600 ${size * 0.08 * 1.05}px system-ui, sans-serif`;
      ctx.fillStyle = '#E0E0E0';
      ctx.fillText(panel.label, centerX, centerY + size * 0.12);

      const texture = new THREE.CanvasTexture(canvas);
      texture.anisotropy = 8;
      return texture;
    });
  }, [panels]);

  // Radial layout configuration
  // make radius and vertical placement responsive to tower size and footprint
  // determine panelSize first (used below when computing radius)
  const panelSize = Math.max(1.8, Math.min(3.2, 1.8 + (towerHeight || 0) * 0.02));
  const baseRadius = Math.max(4.5, Math.min(12, towerHeight * 0.12 || 4.5));
  const footprintRadius = towerFootprintRadius || 0;
  // ensure radius clears the tower's horizontal footprint plus panel half-size and margin
  const margin = 0.6;
  const radius = Math.max(baseRadius, footprintRadius + panelSize / 2 + margin);
  // position ring toward the upper half of the tower (mid-to-top) and nudge upward to avoid collisions
  const ringY = Math.max(towerCenter.y + 0.8, (towerTop || towerCenter.y) - Math.max(1, towerHeight * 0.25)) + 0.2;

  // Restart handler
  const handleRestart = () => {
    try { (globalThis as any).__REQUEST_NEW_GAME?.(); } catch { }
  };

  // Export bounds for camera
  React.useEffect(() => {
    if (rootRef.current) {
      const box = new THREE.Box3().setFromObject(rootRef.current);
      (globalThis as any).__END_STATS_BOUNDS__ = box;
    }
  });

  // Panel refs for runtime billboarding
  const panelRefs = useRef<Array<THREE.Mesh | null>>([]);
  const { camera } = useThree();

  // Keep initial camera zoom to compute a screen-scale multiplier so panels remain
  // visually constant regardless of orthographic zoom changes.
  const initialZoomRef = useRef<number>(camera.zoom || 1);
  React.useEffect(() => {
    initialZoomRef.current = camera.zoom || 1;
  }, [camera]);

  // Rotation / drag state for the radial (allows user to rotate around the tower)
  const panelsGroupRef = useRef<THREE.Group>(null);
  const rotationRef = useRef<number>(0);
  const draggingRef = useRef<boolean>(false);
  const lastPointerXRef = useRef<number>(0);
  const lastPointerTimeRef = useRef<number>(0);
  const rotationVelocityRef = useRef<number>(0); // radians per second
  const dragSensitivity = 0.006; // radians per pixel
  const velocityClamp = 6.0; // rad/s max
  const damping = 6.0; // per-second exponential decay
  const autoRotateSpeed = 0.18; // rad/s slow auto-rotate when idle

  const tmpWorldPos = useRef(new THREE.Vector3());
  const camTarget = useRef(new THREE.Vector3());

  // debug toggle: set globalThis.__END_STATS_DEBUG__ = true in console to visualize
  const DEBUG = !!((globalThis as any).__END_STATS_DEBUG__);

  // Billboard panels to face the camera each frame, keep them upright, and scale
  // them inversely with camera.zoom so they appear constant-size on screen.
  useFrame((_, delta) => {
    // apply group rotation (orbit around tower)
    if (panelsGroupRef.current) {
      panelsGroupRef.current.rotation.y = rotationRef.current;
    }

    // Integrate rotation velocity (inertia)
    // rotationVelocityRef is radians/second; apply over this frame
    rotationRef.current += rotationVelocityRef.current * delta;

    // Damping (exponential decay)
    rotationVelocityRef.current *= Math.exp(-damping * delta);

    // If nearly stationary, apply a slow auto-rotate so UI doesn't feel static
    if (!draggingRef.current && Math.abs(rotationVelocityRef.current) < 0.001) {
      rotationVelocityRef.current += autoRotateSpeed * delta;
    }

    const screenScale = (initialZoomRef.current || 1) / (camera.zoom || 1);

    for (let i = 0; i < panelRefs.current.length; i++) {
      const m = panelRefs.current[i];
      if (!m) continue;
      // Billboard: face the camera but remain upright — project camera to the mesh world Y so we avoid pitch/tilt
      const worldPos = tmpWorldPos.current;
      m.getWorldPosition(worldPos);
      camTarget.current.set(camera.position.x, worldPos.y, camera.position.z);
      m.lookAt(camTarget.current);
      // ensure UI renders last
      m.renderOrder = 900 + i;

      // Keep panel size visually consistent by scaling inversely with camera zoom.
      const isPrimary = panels[i]!.key === 'score';
      const baseVisualScale = isPrimary ? 1.4 * 1.25 : 1.0; // previous multipliers collapsed into one base
      const finalScale = baseVisualScale * screenScale;
      m.scale.set(finalScale, finalScale, 1);
    }
  });

  // Keep refs array length in sync with panels
  React.useEffect(() => {
    if (panelRefs.current.length !== panels.length) {
      panelRefs.current = new Array(panels.length).fill(null);
    }
  }, [panels.length]);

  return (
    <group ref={rootRef}>
      {DEBUG && (
        <group position={[towerCenter.x, ringY, towerCenter.z]}>
          <mesh rotation={[-Math.PI / 2, 0, 0]}>
            <ringGeometry args={[radius - 0.02, radius + 0.02, 128]} />
            <meshBasicMaterial color="#ff00ff" wireframe={true} />
          </mesh>
          <mesh>
            <sphereGeometry args={[0.08, 8, 8]} />
            <meshBasicMaterial color="#00ff00" />
          </mesh>
        </group>
      )}
      {/* Radial stats around tower base - properly aligned */}
      <group
        ref={panelsGroupRef}
        position={[towerCenter.x, ringY, towerCenter.z]}
        onPointerDown={(e: any) => {
          e.stopPropagation();
          draggingRef.current = true;
          lastPointerXRef.current = (e.clientX ?? (e.nativeEvent && e.nativeEvent.clientX)) || 0;
          lastPointerTimeRef.current = performance.now();
        }}
        onPointerMove={(e: any) => {
          if (!draggingRef.current) return;
          e.stopPropagation();
          const now = performance.now();
          const clientX = (e.clientX ?? (e.nativeEvent && e.nativeEvent.clientX)) || 0;
          const dx = clientX - lastPointerXRef.current;
          const dt = Math.max(1e-3, (now - lastPointerTimeRef.current) / 1000);
          lastPointerXRef.current = clientX;
          lastPointerTimeRef.current = now;

          // immediate rotation update
          rotationRef.current += dx * dragSensitivity;

          // compute velocity in rad/s and clamp
          const vel = (dx * dragSensitivity) / dt;
          rotationVelocityRef.current = Math.max(-velocityClamp, Math.min(velocityClamp, vel));
        }}
        onPointerUp={(e: any) => { e.stopPropagation(); draggingRef.current = false; }}
        onPointerLeave={(e: any) => { e.stopPropagation(); draggingRef.current = false; }}
      >
        {/* Center ring indicator */}
        <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.1, 0]}>
          <ringGeometry args={[radius - 0.05, radius + 0.05, 64]} />
          <meshBasicMaterial color="#00FFFF" transparent opacity={0.3} />
        </mesh>

        {/* Stats panels arranged in circle */}
        {panels.map((panel, index) => {
          const angle = (index / panels.length) * Math.PI * 2;
          // outward offset so panels don't intersect the tower geometry
          const outward = panelSize / 2 + 0.18;
          const x = Math.sin(angle) * (radius + outward);
          const z = Math.cos(angle) * (radius + outward);
          const isPrimary = panel.key === 'score';
          const scale = isPrimary ? 1.4 : 1.0;
          const texture = panelTextures[index];

          return (
            <group key={panel.key} position={[x, 0, z]}>
              <mesh
                ref={el => { panelRefs.current[index] = el; }}
                scale={[scale * (isPrimary ? 1.25 : 1), scale * (isPrimary ? 1.25 : 1), 1]}
                {...(isPrimary ? { onClick: () => handleRestart() } : {})}
              >
                <planeGeometry args={[panelSize, panelSize]} />
                <meshBasicMaterial
                  map={texture || null}
                  transparent
                />
              </mesh>

              {/* Primary panel extra glow */}
              {isPrimary && (
                <mesh position={[0, 0, -0.01]} scale={[1.1, 1.1, 1]} renderOrder={950}>
                  <planeGeometry args={[panelSize, panelSize]} />
                  <meshBasicMaterial
                    color={panel.accent}
                    transparent
                    opacity={0.2}
                  />
                </mesh>
              )}
            </group>
          );
        })}
      </group>

      {/* Height indicator floating above tower */}
      <group position={[towerCenter.x, towerHeight + 1.5, towerCenter.z]}>
        <mesh>
          <planeGeometry args={[2.5, 0.8]} />
          <meshBasicMaterial
            map={useMemo(() => {
              const canvas = document.createElement('canvas');
              canvas.width = 512;
              canvas.height = 128;
              const ctx = canvas.getContext('2d')!;

              ctx.fillStyle = 'rgba(0, 0, 0, 0.8)';
              ctx.fillRect(0, 0, canvas.width, canvas.height);

              ctx.strokeStyle = '#00FFFF';
              ctx.lineWidth = 2;
              ctx.strokeRect(2, 2, canvas.width - 4, canvas.height - 4);

              ctx.font = 'bold 32px system-ui, sans-serif';
              ctx.fillStyle = '#00FFFF';
              ctx.textAlign = 'center';
              ctx.textBaseline = 'middle';
              ctx.shadowColor = '#00FFFF';
              ctx.shadowBlur = 10;
              ctx.fillText(`${towerHeight.toFixed(1)}u HEIGHT`, canvas.width / 2, canvas.height / 2);

              return new THREE.CanvasTexture(canvas);
            }, [towerHeight])}
            transparent
          />
        </mesh>

        {/* Connection beam to tower */}
        <mesh position={[0, -0.75, 0]}>
          <cylinderGeometry args={[0.02, 0.02, 1.5, 8]} />
          <meshBasicMaterial color="#00FFFF" transparent opacity={0.6} />
        </mesh>
      </group>

      {/* Restart button at base */}
      <group position={[towerCenter.x, towerCenter.y - 1.2, towerCenter.z]}>
        <mesh onClick={() => handleRestart()} renderOrder={980}>
          <planeGeometry args={[3, 0.8]} />
          <meshBasicMaterial
            map={useMemo(() => {
              const canvas = document.createElement('canvas');
              canvas.width = 512;
              canvas.height = 128;
              const ctx = canvas.getContext('2d')!;

              ctx.fillStyle = 'rgba(15, 40, 70, 0.9)';
              ctx.fillRect(0, 0, canvas.width, canvas.height);

              ctx.strokeStyle = '#FFD700';
              ctx.lineWidth = 3;
              ctx.strokeRect(3, 3, canvas.width - 6, canvas.height - 6);

              ctx.font = 'bold 28px system-ui, sans-serif';
              ctx.fillStyle = '#FFD700';
              ctx.textAlign = 'center';
              ctx.textBaseline = 'middle';
              ctx.shadowColor = '#FFD700';
              ctx.shadowBlur = 8;
              ctx.fillText('PLAY AGAIN', canvas.width / 2, canvas.height / 2);

              return new THREE.CanvasTexture(canvas);
            }, [])}
            transparent
          />
        </mesh>
      </group>
    </group>
  );
};
