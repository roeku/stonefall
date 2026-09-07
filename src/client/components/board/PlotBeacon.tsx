import React, { useMemo } from 'react';
import * as THREE from 'three';

interface PlotBeaconProps {
  x: number;
  z: number;
  color: string;
}

const HEIGHT = 600;

/**
 * A soft shaft of light standing over the player's plot.
 *
 * Only shown in the community view, where it answers the one question that view raises: where
 * am I in all this? Additive and fading with height, so it reads as light rather than as a
 * pillar, and it never occludes a tower.
 */
export const PlotBeacon: React.FC<PlotBeaconProps> = ({ x, z, color }) => {
  const material = useMemo(
    () =>
      new THREE.ShaderMaterial({
        uniforms: { uColor: { value: new THREE.Color(color) }, uOpacity: { value: 0.34 } },
        vertexShader: `
          varying float vH;
          void main() {
            vH = uv.y;
            gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
          }`,
        fragmentShader: `
          uniform vec3 uColor;
          uniform float uOpacity;
          varying float vH;
          void main() {
            float a = (1.0 - vH) * (1.0 - vH) * uOpacity;
            gl_FragColor = vec4(uColor * a, a);
          }`,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        side: THREE.DoubleSide,
        toneMapped: false,
      }),
    [color]
  );

  React.useEffect(() => () => material.dispose(), [material]);

  return (
    <mesh position={[x, HEIGHT / 2, z]} material={material} raycast={() => null}>
      <cylinderGeometry args={[6, 11, HEIGHT, 16, 1, true]} />
    </mesh>
  );
};
