import React, { useRef, useMemo } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { TrimEffect } from '../../shared/simulation';

interface TrimEffectsProps {
  trimEffects: ReadonlyArray<TrimEffect>;
  convertPosition: (fixedValue: number) => number;
  currentTick: number;
}

export const TrimEffects: React.FC<TrimEffectsProps> = ({
  trimEffects,
  convertPosition,
  currentTick
}) => {
  const groupRef = useRef<THREE.Group>(null);

  // Create dissolve shader material (the good one that was working)
  const dissolveMaterial = useMemo(() => {
    return new THREE.ShaderMaterial({
      uniforms: {
        time: { value: 0 },
        dissolveAmount: { value: 0 },
        edgeColor: { value: new THREE.Color(0x00ffff) },
        edgeWidth: { value: 0.05 }
      },
      vertexShader: `
        varying vec3 vPosition;
        varying vec3 vNormal;
        varying vec2 vUv;
        
        void main() {
          vPosition = position;
          vNormal = normal;
          vUv = uv;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: `
        uniform float time;
        uniform float dissolveAmount;
        uniform vec3 edgeColor;
        uniform float edgeWidth;
        
        varying vec3 vPosition;
        varying vec3 vNormal;
        varying vec2 vUv;
        
        // Better noise function
        vec3 mod289(vec3 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
        vec4 mod289(vec4 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
        vec4 permute(vec4 x) { return mod289(((x*34.0)+1.0)*x); }
        vec4 taylorInvSqrt(vec4 r) { return 1.79284291400159 - 0.85373472095314 * r; }
        
        float snoise(vec3 v) {
          const vec2 C = vec2(1.0/6.0, 1.0/3.0);
          const vec4 D = vec4(0.0, 0.5, 1.0, 2.0);
          
          vec3 i  = floor(v + dot(v, C.yyy));
          vec3 x0 = v - i + dot(i, C.xxx);
          
          vec3 g = step(x0.yzx, x0.xyz);
          vec3 l = 1.0 - g;
          vec3 i1 = min(g.xyz, l.zxy);
          vec3 i2 = max(g.xyz, l.zxy);
          
          vec3 x1 = x0 - i1 + C.xxx;
          vec3 x2 = x0 - i2 + C.yyy;
          vec3 x3 = x0 - D.yyy;
          
          i = mod289(i);
          vec4 p = permute(permute(permute(
                    i.z + vec4(0.0, i1.z, i2.z, 1.0))
                    + i.y + vec4(0.0, i1.y, i2.y, 1.0))
                    + i.x + vec4(0.0, i1.x, i2.x, 1.0));
                    
          float n_ = 0.142857142857;
          vec3 ns = n_ * D.wyz - D.xzx;
          
          vec4 j = p - 49.0 * floor(p * ns.z * ns.z);
          
          vec4 x_ = floor(j * ns.z);
          vec4 y_ = floor(j - 7.0 * x_);
          
          vec4 x = x_ *ns.x + ns.yyyy;
          vec4 y = y_ *ns.x + ns.yyyy;
          vec4 h = 1.0 - abs(x) - abs(y);
          
          vec4 b0 = vec4(x.xy, y.xy);
          vec4 b1 = vec4(x.zw, y.zw);
          
          vec4 s0 = floor(b0)*2.0 + 1.0;
          vec4 s1 = floor(b1)*2.0 + 1.0;
          vec4 sh = -step(h, vec4(0.0));
          
          vec4 a0 = b0.xzyw + s0.xzyw*sh.xxyy;
          vec4 a1 = b1.xzyw + s1.xzyw*sh.zzww;
          
          vec3 p0 = vec3(a0.xy,h.x);
          vec3 p1 = vec3(a0.zw,h.y);
          vec3 p2 = vec3(a1.xy,h.z);
          vec3 p3 = vec3(a1.zw,h.w);
          
          vec4 norm = taylorInvSqrt(vec4(dot(p0,p0), dot(p1,p1), dot(p2, p2), dot(p3,p3)));
          p0 *= norm.x;
          p1 *= norm.y;
          p2 *= norm.z;
          p3 *= norm.w;
          
          vec4 m = max(0.6 - vec4(dot(x0,x0), dot(x1,x1), dot(x2,x2), dot(x3,x3)), 0.0);
          m = m * m;
          return 42.0 * dot(m*m, vec4(dot(p0,x0), dot(p1,x1), dot(p2,x2), dot(p3,x3)));
        }
        
        void main() {
          // Create layered noise for internal structure
          float noise1 = snoise(vPosition * 5.0 + time * 0.2);
          float noise2 = snoise(vPosition * 10.0 - time * 0.1);
          float noise3 = snoise(vPosition * 20.0 + time * 0.3);
          
          // Combine noises for a more complex pattern
          float finalNoise = noise1 * 0.5 + noise2 * 0.3 + noise3 * 0.2;
          
          // Create internal structure pattern
          float structure = abs(sin(vPosition.x * 20.0) * sin(vPosition.y * 20.0) * sin(vPosition.z * 20.0));
          structure = mix(structure, 1.0, finalNoise * 0.5);
          
          // Dissolve based on combined noise and structure
          float dissolveThreshold = dissolveAmount - structure * 0.2;
          if (finalNoise < dissolveThreshold) {
            discard;
          }
          
          // Edge glow effect
          float edge = smoothstep(dissolveThreshold, dissolveThreshold + edgeWidth, finalNoise);
          vec3 color = mix(edgeColor * 2.0, vec3(0.2, 0.8, 1.0), edge);
          
          // Add internal structure color
          color = mix(color, edgeColor * structure, 0.3);
          
          // Add emissive glow
          float glow = (1.0 - edge) * 2.0;
          color += edgeColor * glow;
          
          gl_FragColor = vec4(color, edge);
        }
      `,
      transparent: true,
      side: THREE.DoubleSide
    });
  }, []);

  // Process trim effects (same timing that was working)
  const activeEffects = useMemo(() => {
    return trimEffects.map(effect => {
      const age = currentTick - effect.tick;
      const progress = Math.min(1, age / 45); // 0.75 seconds total - the timing that worked

      return {
        ...effect,
        age,
        progress,
        dissolveAmount: progress * 1.5, // Faster dissolution that worked
        shouldShowParticles: progress > 0.2 // Earlier particles
      };
    }).filter(effect => effect.age < 45);
  }, [trimEffects, currentTick]);

  // Update shader uniforms
  useFrame((state) => {
    if (dissolveMaterial.uniforms.time) {
      dissolveMaterial.uniforms.time.value = state.clock.elapsedTime;
    }
  });

  return (
    <group ref={groupRef}>
      {activeEffects.map((effect) => (
        <group key={`effect-${effect.tick}`}>
          {effect.trimmedPieces.map((piece, pieceIndex) => {
            const worldX = convertPosition(piece.x);
            const worldY = convertPosition(piece.y);
            const worldZ = convertPosition(piece.z ?? 0);
            const worldWidth = convertPosition(piece.width);
            const worldHeight = convertPosition(piece.height);
            const worldDepth = piece.depth !== undefined ? convertPosition(piece.depth) : Math.max(0.6, worldWidth * 0.25);

            // Apply gravity
            const fallDistance = effect.age * 0.15; // Faster falling that worked
            const currentY = worldY - fallDistance;

            // Clone material with unique dissolve amount (the way that worked)
            const materialClone = dissolveMaterial.clone();
            if (materialClone.uniforms.dissolveAmount) {
              materialClone.uniforms.dissolveAmount.value = effect.dissolveAmount;
            }

            return (
              <group key={`piece-${pieceIndex}`}>
                {/* Main dissolving geometry - the good shader effect */}
                <mesh position={[worldX, currentY, worldZ]}>
                  <boxGeometry args={[worldWidth, worldHeight, worldDepth]} />
                  <primitive object={materialClone} />
                </mesh>


              </group>
            );
          })}
        </group>
      ))}
    </group>
  );
};
