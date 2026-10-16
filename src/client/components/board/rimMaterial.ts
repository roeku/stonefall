import * as THREE from 'three';

/**
 * The look of every block in the game: a black body whose face rims glow.
 *
 * Face UVs run 0..1, so the distance to the nearest UV border is the distance to a real edge of
 * the quad; the diagonal a wireframe would draw is interior and never lights up. fwidth keeps the
 * line about a pixel and a half wide at any distance, and bloom does the rest; on a face only a
 * few pixels across the lines thin, and once they would close over it they give way to a fill in
 * the colour. The material is white so the instance colour is the rim colour.
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
 * A stone's body, for one face: `stoneBody(shade, m, p, halfSize, n, lin, seed, eye, time)`.
 *
 * - `m` is where the point is in the stone, in world units. On the map that is the world, so a
 *   pattern runs on up a tower instead of starting again in every slab (a slab is only a block
 *   and a half tall). In a run each block's stone is shifted by how far off it was dropped, so the
 *   block in hand carries its stone as it slides (it used to slide through it) and a perfect
 *   stack lines its stone up.
 * - `p` is the point from the block's own centre and `halfSize` its half extents, for the edges.
 * - `n` is the face's normal, `lin` the block's colour in linear light, `seed` a number in [0, 1)
 *   per tower, `eye` the unit vector to the camera and `time` seconds.
 *
 * Players found the first stones awful and harder to play on, and they were right: thin lines
 * that read as edges (crystal drew a second rectangle inside every face), pixel noise that turned
 * to static and moire at any distance, and bodies so bright they bloomed to white and lost the
 * colour that says whose tower it is. So every stone keeps to a few rules:
 *
 * - The rim belongs to the game, not the stone. Nothing in a stone is hard, straight and bright
 *   enough to be taken for an edge: veins wander, reflections are broad and soft.
 * - Detail stays a few pixels clear of every edge and is halved on top faces, which are what a
 *   drop is aimed at.
 * - Detail fades to its average before it is a few pixels across, so a stone far off is a tone,
 *   never noise.
 * - A body stays well under its rim, and in its faction's hue.
 * - Faces are lit from one side, so a slab of stone reads as a solid where neon reads as light.
 *
 * Exported for the run's blocks, which are drawn by another material and must look the same.
 */
export const STONE_GLSL = /* glsl */ `
const vec3 STONE_LUM = vec3(0.2126, 0.7152, 0.0722);

/** A hash without sin, which loses its randomness at the coordinates a tall tower reaches. */
float stoneHash(vec2 v) {
  vec3 p3 = fract(vec3(v.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

/** Smooth value noise, 0..1. */
float stoneNoise(vec2 x) {
  vec2 i = floor(x);
  vec2 f = fract(x);
  f = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(stoneHash(i), stoneHash(i + vec2(1.0, 0.0)), f.x),
    mix(stoneHash(i + vec2(0.0, 1.0)), stoneHash(i + vec2(1.0, 1.0)), f.x),
    f.y
  );
}

/** How much of a detail \`size\` world units across survives at \`px\` world units a pixel. */
float stoneKeep(float size, float px) {
  return smoothstep(1.5, 4.0, size / max(px, 1e-5));
}

/** The colour turned a little way round the wheel: \`turn\` in turns, kept to its own lightness. */
vec3 stoneTurn(vec3 c, float turn) {
  float a = turn * 6.2832;
  vec3 k = vec3(0.57735);
  vec3 r = c * cos(a) + cross(k, c) * sin(a) + k * dot(k, c) * (1.0 - cos(a));
  return max(r, 0.0) * (dot(c, STONE_LUM) / max(dot(max(r, 0.0), STONE_LUM), 1e-4));
}

vec3 stoneBody(
  float shade, vec3 m, vec3 p, vec3 halfSize, vec3 n, vec3 lin, float seed, vec3 eye, float time
) {
  vec3 a = abs(n);
  bool top = a.y > 0.5;
  // The face's own plane, in the stone and on the block: across it, then up it.
  vec2 uv = top ? m.xz : (a.x > 0.5 ? m.zy : m.xy);
  vec2 lp = top ? p.xz : (a.x > 0.5 ? p.zy : p.xy);
  vec2 hv = top ? halfSize.xz : (a.x > 0.5 ? halfSize.zy : halfSize.xy);
  // Before any branch, so the derivatives are taken by every pixel together.
  float px = max(fwidth(uv.x), fwidth(uv.y));
  // Neon, the default and most blocks on any map, leaves before any of the work below.
  if (shade < 0.5) return vec3(0.0);

  float edge = min(hv.x - abs(lp.x), hv.y - abs(lp.y));
  float calm = (top ? 0.5 : 1.0) * smoothstep(1.0, 4.0, edge / max(px, 1e-5));
  vec3 grey = vec3(dot(lin, STONE_LUM));
  // Lit from above and from one side: a top, a face toward the light, a face turned away.
  float light = top ? 1.1 : n.y < -0.5 ? 0.3 : 0.62 + 0.28 * dot(n.xz, vec2(0.45, 0.89));
  float glance = pow(1.0 - clamp(dot(n, eye), 0.0, 1.0), 3.0);

  if (shade < 1.5) {
    // Marble: the colour, deep and polished, with pale veins drifting through it, strong in
    // places and fading out in others.
    vec2 q = uv * 0.16 + seed * 11.0;
    float turb = stoneNoise(q) + 0.5 * stoneNoise(q * 2.2 + 5.2);
    float w = uv.x * 0.3 + uv.y * 0.52 + turb * 2.2;
    float vein = (1.0 - smoothstep(0.0, 0.13, abs(sin(w)))) * stoneKeep(0.3, px);
    float hair = (1.0 - smoothstep(0.0, 0.06, abs(sin(w * 2.3 + turb * 1.7)))) * stoneKeep(0.15, px);
    float fade = smoothstep(0.25, 0.75, stoneNoise(uv * 0.11 + seed * 7.0 + 2.0));
    float cloud = stoneNoise(uv * 0.15 + seed * 5.0);
    vec3 pale = mix(lin, vec3(1.0), 0.55);
    return lin * light * (0.09 + 0.04 * cloud)
      + pale * light * calm * (0.17 * vein * (0.35 + 0.65 * fade) + 0.06 * hair * fade);
  }
  if (shade < 2.5) {
    // Crystal: clear and lit through in the colour, brighter where it is seen edge-on, with
    // broad reflections running across it the way they cross a glass tower.
    float s = uv.x * 0.6 + uv.y + seed * 20.0;
    float f = fract(s / 9.0) * 9.0;
    float wide = smoothstep(0.0, 0.5, f) * (1.0 - smoothstep(0.5, 2.4, f));
    float thin = smoothstep(2.9, 3.1, f) * (1.0 - smoothstep(3.1, 3.6, f));
    float streak = (wide + 0.8 * thin) * stoneKeep(0.6, px);
    vec3 glint = mix(lin, vec3(1.0), 0.55);
    return lin * (0.075 + 0.2 * glance) * light + glint * streak * 0.09 * calm;
  }
  if (shade < 3.5) {
    // Obsidian: black glass. A top face catches the sky; a side face, looking down at the floor,
    // stays black but for a sheen where it is seen edge-on and a gloss drawn down it.
    vec3 r = reflect(-eye, n);
    float sky = smoothstep(0.0, 0.8, r.y);
    float s = uv.x + uv.y * 0.3 + seed * 20.0;
    float g = (fract(s / 14.0) - 0.5) * 14.0;
    float gloss = (exp(-pow(g / 0.45, 2.0)) + 0.5 * exp(-pow(g / 1.8, 2.0))) * stoneKeep(0.5, px);
    vec3 sheen = mix(lin, vec3(1.0), 0.45);
    return lin * 0.012 + sheen * (0.14 * sky + 0.12 * glance + (top ? 0.0 : 0.045 * gloss * calm));
  }
  if (shade < 4.5) {
    // Slate: matte, dark and cool, in fine level layers that wander a little, and clouded where
    // the bed changes.
    vec3 matte = mix(lin, grey, 0.3);
    float bed = uv.y * 3.6 + 0.9 * stoneNoise(vec2(uv.x * 0.35, uv.y * 0.8) + seed * 9.0);
    float layer = sin(bed * 6.2832) * stoneKeep(0.28, px);
    float tone = stoneNoise(uv * vec2(0.18, 0.5) + seed * 3.0) - 0.5;
    return matte * light * 0.095 * (1.0 + 0.4 * tone * calm + 0.13 * layer * calm);
  }
  if (shade < 5.5) {
    // Granite: a hard grain of crystals, pale and dark, crowded in some places and sparse in
    // others.
    vec3 rock = mix(lin, grey, 0.15);
    float mottle = stoneNoise(uv * 0.45 + seed * 7.0) - 0.5;
    float crowd = stoneNoise(uv * 0.7 + seed * 3.0 + 4.0);
    float tone = 0.0;
    for (int k = 0; k < 2; k++) {
      float scale = k == 0 ? 1.5 : 2.6;
      vec2 c = uv * scale + seed * 13.0 + float(k) * 31.7;
      vec2 ci = floor(c);
      vec2 cf = fract(c) - 0.5 - (vec2(stoneHash(ci), stoneHash(ci + 7.1)) - 0.5) * 0.7;
      float kind = stoneHash(ci + 3.3);
      float size = (0.12 + 0.18 * stoneHash(ci + 9.4)) * step(stoneHash(ci + 2.2), 0.3 + 0.5 * crowd);
      float fleck = (1.0 - smoothstep(size * 0.55, size, length(cf))) * stoneKeep(0.4 / scale, px);
      tone += fleck * (kind > 0.45 ? 1.0 : -0.5);
    }
    float grain = (stoneNoise(uv * 6.0 + seed) - 0.5) * stoneKeep(0.12, px);
    return rock * light * 0.115 * (1.0 + 0.25 * mottle + calm * (tone + 0.3 * grain));
  }
  if (shade < 6.5) {
    // Basalt: columns standing side by side all the way up, each rounded to the light.
    float col = uv.x / 1.3 + seed * 5.0;
    float f = fract(col);
    float roll = cos((f - 0.3) * 6.2832);
    float tone = stoneHash(vec2(floor(col), seed * 37.0)) - 0.5;
    float joint = 1.0 - smoothstep(0.0, 0.16, min(f, 1.0 - f));
    float flute = top ? 0.0 : stoneKeep(0.5, px);
    vec3 rock = mix(lin, grey, 0.3);
    return rock * light * 0.11 * (1.0 + calm * flute * (0.28 * roll + 0.22 * tone - 0.35 * joint));
  }
  // Quartz: pale and lit from within, with a pearl's play of colour that turns a little way
  // round the faction's hue as it is seen from different sides, and a shine climbing through it
  // now and then.
  float play = stoneNoise(uv * 0.2 + seed * 9.0) * 2.0 + glance * 3.0 + dot(eye, n.zxy) * 1.5;
  vec3 pearl = mix(stoneTurn(lin, 0.028 * sin(play * 3.1416)), vec3(1.0), 0.25);
  float s = m.y * 0.3 + uv.x * 0.2 - time * 1.1;
  float shine = exp(-pow((fract(s / 10.0) - 0.5) * 10.0 / 0.9, 2.0)) * stoneKeep(2.0, px);
  return pearl * light * (0.165 + 0.06 * glance) + pearl * shine * 0.07;
}
`;
/** What the stone function reads, written by the vertex stage of any material that draws one. */
const STONE_VARYINGS = `varying float vStone;
varying vec3 vStoneM;
varying vec3 vStoneP;
varying vec3 vStoneHalf;
varying vec3 vStoneN;
varying vec3 vStoneEye;
varying float vStoneSeed;
`;

/** How bright a face's fill is, against its rim, once its lines are too close to draw. */
const SEAM_FILL = 0.4;

/** The clock a material without one reads: stones that move hold still. */
const STILL = { value: 0 };

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
    // A stone's shine runs on the build clock; without one it stands still.
    if (grow || stones) shader.uniforms.uTime = grow ? grow.time : STILL;
    if (compress) shader.uniforms.uCompress = compress;
    shader.vertexShader = shader.vertexShader
      .replace(
        'void main() {',
        `${grow ? 'attribute float aDelay;\nuniform float uTime;\n' : ''}${
          compress ? 'uniform float uCompress;\n' : ''
        }${
          stones ? `attribute float aStone;\n${STONE_VARYINGS}` : ''
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
        vec3 stoneCentre = instanceMatrix[3].xyz;
        vec3 stoneAt = (instanceMatrix * vec4(transformed, 1.0)).xyz;
        #else
        vec3 stoneCentre = vec3(0.0);
        vec3 stoneAt = transformed;
        #endif
        // Every block of a tower stands in its cell, so the cell names the tower; the stone is
        // read from the cell's corner, which keeps the numbers small out at the map's edge.
        vec2 stoneCell = floor(stoneCentre.xz / 8.0);
        vStoneM = vec3(stoneAt.xz - stoneCell * 8.0, stoneAt.y).xzy;
        vStoneSeed = fract(sin(dot(stoneCell, vec2(12.9898, 78.233))) * 43758.5453);
        // A box's corners all sit at its half extents, so this is the same at every vertex.
        vStoneP = stoneAt - stoneCentre;
        vStoneHalf = abs(vStoneP);
        vStoneN = normal;
        vStone = aStone;
        vec3 stoneShown = (modelMatrix * vec4(stoneAt, 1.0)).xyz;`
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
        ${stones ? 'stoneShown = (modelMatrix * mvPosition).xyz;' : ''}
        mvPosition = modelViewMatrix * mvPosition;
        gl_Position = projectionMatrix * mvPosition;`
          : '#include <project_vertex>'
      )
      .replace(
        '#include <fog_vertex>',
        `#include <fog_vertex>
        ${stones ? 'vStoneEye = cameraPosition - stoneShown;' : ''}`
      );
    shader.fragmentShader = shader.fragmentShader
      .replace(
        'void main() {',
        `${
          stones ? `${STONE_VARYINGS}uniform float uTime;\n${STONE_GLSL}` : ''
        }varying vec2 vRimUv;\nvoid main() {`
      )
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
        vec2 rimFw = max(fwidth(vRimUv), vec2(1e-5));
        // A pixel and a half wide, or thinner on a face too small to give that up: rims that
        // cover a face leave nothing of what it is made of, and a stack of them blooms white.
        vec2 rimPx = clamp(0.14 / rimFw, vec2(0.7), vec2(1.5));
        vec2 lines = 1.0 - smoothstep(rimFw * rimPx, rimFw * rimPx * 2.0, min(vRimUv, 1.0 - vRimUv));
        // A face only a few pixels across is all rim, and a tower of such faces (a tall one on
        // the map, squashed) is a sheet of lines beating against the pixel grid: moire, static,
        // and white under bloom, where the colour that says whose it is was the point. Lines
        // closer than that give way to a fill in the colour; the outline stays.
        vec2 open = smoothstep(vec2(2.0), vec2(4.5), 1.0 / rimFw);
        lines *= open;
        float rim = max(lines.x, lines.y);
        float fill = (1.0 - min(open.x, open.y)) * ${SEAM_FILL.toFixed(2)};
        ${
          stones
            ? `// Instance colours are written as they are authored, so the stone takes them to linear.
        vec3 body = stoneBody(vStone, vStoneM, vStoneP, vStoneHalf, normalize(vStoneN),
          pow(diffuseColor.rgb, vec3(2.2)), vStoneSeed, normalize(vStoneEye), uTime);
        body = max(body, diffuseColor.rgb * fill);
        diffuseColor.rgb = diffuseColor.rgb * rim * ${intensity} + body * (1.0 - rim);`
            : `diffuseColor.rgb *= rim * ${intensity} + fill * (1.0 - rim);`
        }`
      );
  };
  material.customProgramCacheKey = () =>
    `rim-${grow ? 'grow' : 'static'}-${compress ? 'compress' : 'flat'}-${stones ? 'stones' : 'plain'}-${intensity}`;
  return material;
};
