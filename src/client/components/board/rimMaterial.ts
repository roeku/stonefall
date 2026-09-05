import * as THREE from 'three';

/**
 * The look of every block in the game: a black body whose face rims glow.
 *
 * Face UVs run 0..1, so the distance to the nearest UV border is the distance to a real edge of
 * the quad; the diagonal a wireframe would draw is interior and never lights up. fwidth keeps the
 * line about a pixel and a half wide at any distance, and bloom does the rest. The material is
 * white so the instance colour is the rim colour.
 *
 * With `grow`, the vertex shader also scales each instance up from its own base over time, from
 * a per-instance `aDelay` attribute against the `uTime` uniform.
 */
export interface RimMaterialOptions {
  grow?: { time: { value: number } } | undefined;
  /**
   * Uniform in [0, 1] that squashes world height toward `COMPRESS_K * ln(1 + y / COMPRESS_K)`.
   * At 1 a thirty-unit tower keeps most of its height and a fifteen-hundred-unit spire is held
   * to about a hundred and fifty, which is what lets a city of needles read as a map.
   */
  compress?: { value: number } | undefined;
  /** Rim brightness multiplier, e.g. below 1 for debris. */
  intensity?: number | undefined;
}

export const COMPRESS_K = 40;

/** The same curve on the CPU, for hitboxes and anything else that has to agree with the GPU. */
export const compressHeight = (y: number, amount: number): number => {
  const squashed = COMPRESS_K * Math.log(1 + Math.max(0, y) / COMPRESS_K);
  return y + (squashed - y) * amount;
};

export const createRimMaterial = (options: RimMaterialOptions = {}): THREE.MeshBasicMaterial => {
  const material = new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: false });
  const grow = options.grow;
  const intensity = (options.intensity ?? 1).toFixed(3);

  const compress = options.compress;

  material.onBeforeCompile = (shader) => {
    if (grow) shader.uniforms.uTime = grow.time;
    if (compress) shader.uniforms.uCompress = compress;
    shader.vertexShader = shader.vertexShader
      .replace(
        'void main() {',
        `${grow ? 'attribute float aDelay;\nuniform float uTime;\n' : ''}${
          compress ? 'uniform float uCompress;\n' : ''
        }varying vec2 vRimUv;\nvoid main() {`
      )
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
        ${
          grow
            ? `float grow = clamp((uTime - aDelay) * 3.0, 0.0, 1.0);
        grow = grow * grow * (3.0 - 2.0 * grow);
        transformed.y = (transformed.y + 0.5) * grow - 0.5;`
            : ''
        }
        vRimUv = uv;`
      )
      .replace(
        '#include <project_vertex>',
        compress
          ? `vec4 mvPosition = vec4( transformed, 1.0 );
        #ifdef USE_BATCHING
          mvPosition = batchingMatrix * mvPosition;
        #endif
        #ifdef USE_INSTANCING
          mvPosition = instanceMatrix * mvPosition;
        #endif
        {
          // World height, squashed. The mesh sits at the origin, so instance space is world.
          float y = max(0.0, mvPosition.y);
          float squashed = ${COMPRESS_K.toFixed(1)} * log(1.0 + y / ${COMPRESS_K.toFixed(1)});
          mvPosition.y = mix(mvPosition.y, squashed, uCompress);
        }
        mvPosition = modelViewMatrix * mvPosition;
        gl_Position = projectionMatrix * mvPosition;`
          : '#include <project_vertex>'
      );
    shader.fragmentShader = shader.fragmentShader
      .replace('void main() {', 'varying vec2 vRimUv;\nvoid main() {')
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
        float dEdge = min(min(vRimUv.x, 1.0 - vRimUv.x), min(vRimUv.y, 1.0 - vRimUv.y));
        float wEdge = fwidth(dEdge) * 1.5;
        float rim = 1.0 - smoothstep(wEdge, wEdge * 2.0, dEdge);
        diffuseColor.rgb *= rim * ${intensity};`
      );
  };
  material.customProgramCacheKey = () =>
    `rim-${grow ? 'grow' : 'static'}-${compress ? 'compress' : 'flat'}-${intensity}`;
  return material;
};
