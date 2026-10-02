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
 * a per-instance `aDelay` attribute against the `uTime` uniform. With `stones`, each instance's
 * body is drawn in the stone its `aStone` names instead of left dark.
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
  /**
   * Draw each block's body in a stone (shared/social/stones.ts), from a per-instance `aStone`
   * holding the stone's shade. Without it every body is the dark default.
   */
  stones?: boolean | undefined;
}

/**
 * A stone's body, for one face, in the face's own colour: `stoneBody(shade, p, seed, dEdge,
 * wEdge, col)`, where `p` is the face's position in world units, so a pattern runs on across the
 * blocks of a tower instead of starting again in each, and `dEdge`/`wEdge` are the rim's distance
 * to the face's edge and its pixel width.
 *
 * Every stone takes its hue from the colour it is given and only changes what the body is made
 * of, so a faction reads at a glance whatever its players build in. Exported for the run's
 * blocks, which are drawn by another material and must look the same.
 */
export const STONE_GLSL = /* glsl */ `
float stoneHash(vec2 v) {
  return fract(sin(dot(v, vec2(127.1, 311.7))) * 43758.5453);
}

vec3 stoneBody(float shade, vec2 p, float seed, float dEdge, float wEdge, vec3 col) {
  // Neon, the default and most blocks on any map, leaves before any of the work below.
  if (shade < 0.5) return vec3(0.0);
  vec3 deep = pow(col, vec3(2.2));
  if (shade < 1.5) {
    // Marble: the colour, clouded, with dark veins wandering through it.
    float w = p.x * 0.55 + p.y * 0.9 + sin(p.y * 0.7 + p.x * 0.35 + seed * 6.28) * 1.6
      + sin(p.x * 1.3 - p.y * 0.4) * 0.5;
    float vein = 1.0 - smoothstep(0.03, 0.16, abs(sin(w)));
    float cloud = 0.5 + 0.5 * sin(p.x * 0.3 + p.y * 0.5 + seed * 3.0);
    return deep * (0.42 + 0.16 * cloud) * (1.0 - 0.85 * vein);
  }
  if (shade < 2.5) {
    // Crystal: clear in the middle, bright towards its edges, a second edge inside the first.
    float inner = 1.0 - smoothstep(wEdge, wEdge * 2.0, abs(dEdge - 0.16));
    float glass = 1.0 - smoothstep(0.0, 0.32, dEdge);
    return deep * (0.06 + 0.38 * glass) + col * inner * 0.6;
  }
  if (shade < 3.5) {
    // Obsidian: black glass with a sheen, split by fractures that burn in the colour.
    float c1 = abs(sin(p.x * 1.1 + p.y * 1.9 + sin(p.y * 0.9 + seed * 6.0) * 1.4));
    float c2 = abs(sin(-p.x * 1.4 + p.y * 1.3 + sin(p.x * 0.7 + seed * 4.0) * 1.2 + 1.7));
    float crack = max(1.0 - smoothstep(0.0, 0.08, c1), 1.0 - smoothstep(0.0, 0.08, c2));
    float mask = smoothstep(0.25, 0.6, 0.5 + 0.5 * sin(p.x * 0.37 + p.y * 0.23 + seed * 5.0));
    float sheen = 0.5 + 0.5 * sin(p.y * 0.45 + p.x * 0.2 + seed * 2.0);
    return deep * (0.05 + 0.08 * sheen) + col * crack * mask * 1.15;
  }
  if (shade < 4.5) {
    // Slate: layered bands of the colour, each its own shade, split by thin seams.
    float s = p.y * 0.55 + sin(p.x * 0.25 + seed * 6.0) * 0.35;
    float band = fract(s);
    float tone = 0.16 + 0.3 * stoneHash(vec2(floor(s), seed * 7.0));
    float seam = 1.0 - smoothstep(0.0, 0.07, min(band, 1.0 - band));
    return deep * tone * (1.0 - 0.75 * seam);
  }
  if (shade < 5.5) {
    // Granite: a dark grain flecked with the colour.
    vec2 g = floor(p * 3.2);
    float grain = stoneHash(g + seed * 13.0);
    float fleck = step(0.74, grain);
    return deep * (0.14 + 0.12 * stoneHash(floor(p * 1.3) + seed)) + col * fleck * 0.55;
  }
  if (shade < 6.5) {
    // Basalt: columns standing side by side, each its own shade, cracked across now and then.
    float cx = p.x / 1.35;
    float column = floor(cx);
    float joint = 1.0 - smoothstep(0.0, 0.06, min(fract(cx), 1.0 - fract(cx)));
    float cy = fract(p.y * 0.35 + stoneHash(vec2(column, seed)));
    float split = 1.0 - smoothstep(0.0, 0.035, min(cy, 1.0 - cy));
    float tone = 0.14 + 0.2 * stoneHash(vec2(column, seed * 3.0));
    return deep * tone * (1.0 - 0.85 * max(joint, split));
  }
  // Quartz: facets, each catching the light differently, a few of them blazing.
  vec2 q = p * 0.7;
  vec2 cell = floor(vec2(q.x + q.y * 0.5, q.y));
  float upper = step(fract(q.y), fract(q.x + q.y * 0.5));
  float facet = stoneHash(cell * 2.0 + upper + seed * 9.0);
  return deep * (0.1 + 0.42 * facet * facet) + col * pow(facet, 8.0) * 0.6;
}
`;
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
  const stones = options.stones === true;

  material.onBeforeCompile = (shader) => {
    if (grow) shader.uniforms.uTime = grow.time;
    if (compress) shader.uniforms.uCompress = compress;
    shader.vertexShader = shader.vertexShader
      .replace(
        'void main() {',
        `${grow ? 'attribute float aDelay;\nuniform float uTime;\n' : ''}${
          compress ? 'uniform float uCompress;\n' : ''
        }${
          stones
            ? 'attribute float aStone;\nvarying float vStone;\nvarying vec2 vStonePlane;\nvarying float vStoneSeed;\n'
            : ''
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
        ${
          stones
            ? `#ifdef USE_INSTANCING
        vec4 stoneWorld = instanceMatrix * vec4(transformed, 1.0);
        vec2 stoneCell = floor(instanceMatrix[3].xz / 4.0);
        #else
        vec4 stoneWorld = vec4(transformed, 1.0);
        vec2 stoneCell = vec2(0.0);
        #endif
        vec3 stoneAxis = abs(normal);
        vStonePlane = stoneAxis.x > 0.5 ? stoneWorld.zy : stoneAxis.z > 0.5 ? stoneWorld.xy : stoneWorld.xz;
        vStoneSeed = fract(sin(dot(stoneCell, vec2(12.9898, 78.233))) * 43758.5453);
        vStone = aStone;`
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
      .replace(
        'void main() {',
        `${
          stones
            ? `varying float vStone;\nvarying vec2 vStonePlane;\nvarying float vStoneSeed;\n${STONE_GLSL}`
            : ''
        }varying vec2 vRimUv;\nvoid main() {`
      )
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
        float dEdge = min(min(vRimUv.x, 1.0 - vRimUv.x), min(vRimUv.y, 1.0 - vRimUv.y));
        float wEdge = fwidth(dEdge) * 1.5;
        float rim = 1.0 - smoothstep(wEdge, wEdge * 2.0, dEdge);
        ${
          stones
            ? `vec3 body = stoneBody(vStone, vStonePlane, vStoneSeed, dEdge, wEdge, diffuseColor.rgb);
        diffuseColor.rgb = diffuseColor.rgb * rim * ${intensity} + body * (1.0 - rim);`
            : `diffuseColor.rgb *= rim * ${intensity};`
        }`
      );
  };
  material.customProgramCacheKey = () =>
    `rim-${grow ? 'grow' : 'static'}-${compress ? 'compress' : 'flat'}-${stones ? 'stones' : 'plain'}-${intensity}`;
  return material;
};
