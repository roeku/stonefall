import React, { useEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';

/** A streak earning a new name: the moment its corners' charge reaches the top. */
export interface ComboSpireShot {
  key: number;
  /** When the beams leave the top, ms (performance.now). */
  at: number;
  /** The top face of the tower: its centre and size, in the run's own space. */
  x: number;
  y: number;
  z: number;
  width: number;
  depth: number;
  /** The tier the streak has just reached (constants/streakTiers). */
  tier: number;
  /** The tower's colour, pushed toward white as its flash is. */
  color: string;
}

const SPIRE = {
  /** ms for the beams to reach their height, and then to fade as they lift away. */
  RISE_MS: 170,
  FADE_MS: 560,
  /** Their height in world units, at the first tier and per tier after, and its cap. */
  HEIGHT: 4.5,
  HEIGHT_PER_TIER: 1.2,
  HEIGHT_MAX: 22,
  /** Width in world units: about two CSS pixels on a phone at run distance. */
  WIDTH: 0.16,
  /** How far up its own height a beam's foot climbs as it fades: it leaves, it does not blink. */
  LIFT: 0.55,
  /** Brightness over its colour: well past the bloom threshold. */
  GLOW: 1.9,
} as const;

const vertexShader = /* glsl */ `
  uniform float uWidth;
  uniform float uFoot;
  uniform float uTop;
  varying vec2 vUv;
  void main() {
    vUv = uv;
    // Turned about its own upright to face the camera, so it is a line from any side.
    vec3 base = (modelMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
    vec3 toCam = cameraPosition - base;
    vec3 across = normalize(vec3(toCam.z, 0.0, -toCam.x) + vec3(1e-5, 0.0, 0.0));
    vec3 p = base + across * (uv.x - 0.5) * uWidth + vec3(0.0, mix(uFoot, uTop, uv.y), 0.0);
    gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0);
  }
`;

const fragmentShader = /* glsl */ `
  uniform vec3 uColor;
  uniform float uAlpha;
  varying vec2 vUv;
  void main() {
    // Clamped: interpolation can carry a uv a hair past 1, and pow of a negative is NaN, which
    // the bloom spreads over the whole frame.
    float core = pow(clamp(1.0 - abs(vUv.x * 2.0 - 1.0), 0.0, 1.0), 2.0);
    float tip = pow(clamp(1.0 - vUv.y, 0.0, 1.0), 1.3);
    gl_FragColor = vec4(uColor, core * tip * uAlpha);
    #include <colorspace_fragment>
  }
`;

/** Places the beams for this frame, or hides them when there is nothing to show. */
const styleSpire = (
  beams: ReadonlyArray<THREE.Mesh | null>,
  material: THREE.ShaderMaterial,
  shot: ComboSpireShot | null,
  now: number
): void => {
  const t = shot ? now - shot.at : -1;
  const on = !!shot && t >= 0 && t <= SPIRE.RISE_MS + SPIRE.FADE_MS;
  for (const b of beams) if (b) b.visible = on;
  if (!shot || !on) return;
  const height = Math.min(
    SPIRE.HEIGHT_MAX,
    SPIRE.HEIGHT + SPIRE.HEIGHT_PER_TIER * Math.max(0, shot.tier - 1)
  );
  const rise = Math.min(1, t / SPIRE.RISE_MS);
  const fade = Math.max(0, (t - SPIRE.RISE_MS) / SPIRE.FADE_MS);
  const u = material.uniforms;
  u.uTop!.value = height * (1 - Math.pow(1 - rise, 3)) + height * SPIRE.LIFT * fade;
  u.uFoot!.value = height * SPIRE.LIFT * fade * fade;
  u.uAlpha!.value = 1 - fade * fade;
};

/**
 * A new streak name, thrown into the sky: the combo's charge (comboLight.ts) does not stop at
 * the top but carries on out of the four top corners as beams, taller the higher the tier, and
 * leaves. The plumb lines of the tower, drawn on past it for a moment.
 *
 * Only at a tier, never on every perfect, so it stays an event. The beams stand at the corners,
 * clear of the top face, and are gone in about three quarters of a second.
 */
export const ComboSpire: React.FC<{ shot: ComboSpireShot | null }> = ({ shot }) => {
  const beams = useRef<Array<THREE.Mesh | null>>([]);
  // Placed by its uvs alone (the vertex stage), so any unit quad will do.
  const geometry = useMemo(() => new THREE.PlaneGeometry(1, 1), []);
  const material = useMemo(
    () =>
      new THREE.ShaderMaterial({
        vertexShader,
        fragmentShader,
        uniforms: {
          uWidth: { value: SPIRE.WIDTH },
          uFoot: { value: 0 },
          uTop: { value: 0 },
          uColor: { value: new THREE.Color('#ffffff') },
          uAlpha: { value: 0 },
        },
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        toneMapped: false,
      }),
    []
  );
  useEffect(
    () => () => {
      geometry.dispose();
      material.dispose();
    },
    [geometry, material]
  );

  useEffect(() => {
    if (!shot) return;
    material.uniforms.uColor!.value.set(shot.color).multiplyScalar(SPIRE.GLOW);
    const hx = shot.width / 2;
    const hz = shot.depth / 2;
    const corners = [
      [hx, hz],
      [hx, -hz],
      [-hx, hz],
      [-hx, -hz],
    ] as const;
    beams.current.forEach((b, i) => {
      const [cx, cz] = corners[i]!;
      b?.position.set(shot.x + cx, shot.y, shot.z + cz);
    });
  }, [shot, material]);

  useFrame(() => styleSpire(beams.current, material, shot, performance.now()));

  return (
    <group name="combo-spire">
      {[0, 1, 2, 3].map((i) => (
        <mesh
          key={i}
          ref={(el) => {
            beams.current[i] = el;
          }}
          geometry={geometry}
          material={material}
          visible={false}
          frustumCulled={false}
          raycast={() => null}
        />
      ))}
    </group>
  );
};
