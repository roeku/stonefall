import * as THREE from 'three';
import type { ComboElement, ComboTower, Palette } from './factionElements';

/**
 * What an element burns round the tower, as opposed to what it throws (the particles).
 *
 * Particles scattered over a lit face are glitter: on a phone they are a few pixels on a body
 * nearly as bright as they are, and nothing about them moves together. An element is read from
 * its outline against the dark. So each one is a field drawn on a sheet stood just behind the
 * tower and turned to the camera: the tower hides the middle of it, and what shows is fire
 * licking up its outline, water spilling off it, lightning crawling round it, and so on.
 *
 * Every field is cut into pixels a few of the screen's across and into five brightness steps,
 * white-hot to the colour itself to burnt down, so all eight read as the game's and as one
 * family. The sheet stands behind the whole tower, so the top face -- opaque, and what the next
 * block is aimed at -- is always drawn over it, never under.
 */

export const AURA = {
  /** Pixel size, world units: about four CSS pixels on a phone at run distance. */
  CELL: 0.26,
  /** How much heat a perfect and a new name throw on, and how fast it settles, per second. */
  PERFECT_FLARE: 0.35,
  TIER_FLARE: 0.85,
  FLARE_DECAY: 2.2,
  /** How far a field is held down where the streak word sits over the top. */
  WORD_GAP: 0.6,
  /** Seconds a field takes to come up when a combo starts, and to die when it breaks. */
  CATCH_S: 0.3,
  DIE_S: 0.55,
} as const;

const CELL = AURA.CELL.toFixed(3);

const vertexShader = /* glsl */ `
  uniform vec3 uBase;
  uniform vec2 uSize;
  uniform float uBack;
  varying vec2 vP;
  void main() {
    // Stood on the tower's upright, turned to the camera about it, and set back behind the
    // tower so everything of the tower is in front of it.
    vec3 base = (modelMatrix * vec4(uBase, 1.0)).xyz;
    vec3 toCam = cameraPosition - base;
    vec2 toward = normalize(toCam.xz + vec2(1e-5, 0.0));
    vec3 across = vec3(toward.y, 0.0, -toward.x);
    base -= vec3(toward.x, 0.0, toward.y) * uBack;
    vP = vec2((uv.x - 0.5) * uSize.x, uBase.y + uv.y * uSize.y);
    vec3 p = base + across * (uv.x - 0.5) * uSize.x + vec3(0.0, uv.y * uSize.y, 0.0);
    gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0);
  }
`;

/** What every field has: the tower, the clock, the heat, and some noise. */
const PRELUDE = /* glsl */ `
  uniform float uTime;
  uniform float uHeat;
  uniform float uLevel;
  uniform float uR;
  uniform float uTop;
  uniform float uLo;
  uniform vec3 uCore;
  uniform vec3 uMid;
  uniform vec3 uDeep;
  varying vec2 vP;

  float hash(vec2 p) {
    return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
  }
  float noise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x),
               mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x), u.y);
  }
  float fbm(vec2 p) {
    float v = 0.0;
    float a = 0.55;
    for (int i = 0; i < 4; i++) {
      v += a * noise(p);
      p = p * 2.03 + vec2(1.7, 9.2);
      a *= 0.5;
    }
    return v;
  }
  /** Thin lines where noise crosses its middle. */
  float ridge(float n, float sharp) {
    return pow(clamp(1.0 - abs(n * 2.0 - 1.0), 0.0, 1.0), sharp);
  }
  /** 1 in the part of the streak the camera sees, falling to 0 below it. */
  float foot(vec2 c) {
    return smoothstep(uLo, uLo + 3.0, c.y);
  }
  /**
   * How far a cell is from the tower's outline, in reaches: out from its sides below the top,
   * and out and up above it. 0 on the outline.
   */
  float outline(vec2 c, float sideReach, float topReach) {
    float side = max(abs(c.x) - uR, 0.0) / max(sideReach * uLevel, 0.01);
    float above = c.y - uTop;
    return (above <= 0.0 ? side : side + above / max(topReach * uLevel, 0.01)) + 1.0 - foot(c);
  }
`;

/**
 * Each element's field: how bright the cell at c is, before it is stepped. `uHeat` runs 0 at
 * the first combo tier to 1 at Pinnacle, and past 1 for a moment on a flare.
 */
const FIELDS: Record<ComboElement, { glsl: string; side: number; up: number }> = {
  // Flames climbing the outline and off the rim, coming in licks.
  fire: {
    side: 3.1,
    up: 8,
    glsl: /* glsl */ `
      float fall = outline(c, mix(0.9, 2.6, uHeat), mix(1.8, 5.2, uHeat));
      float n = fbm(vec2(c.x * 0.62, c.y * 0.42 - uTime * mix(1.5, 3.2, uHeat)));
      float licks = noise(vec2(c.x * 1.3, uTime * 0.7)) * 0.35;
      return n * 1.35 + licks - fall;`,
  },
  // A fountain off the rim, arcing out at the corners, and sheets of water running down.
  water: {
    side: 4.2,
    up: 5.5,
    glsl: /* glsl */ `
      float above = c.y - uTop;
      float spread = uR + max(above, 0.0) * 0.75;
      float fall = max(abs(c.x) - spread, 0.0) / max(mix(0.6, 1.8, uHeat) * uLevel, 0.01)
        + max(above, 0.0) / max(mix(1.3, 4.6, uHeat) * uLevel, 0.01)
        + 1.0 - foot(c);
      // The fountain keeps to its two arcs; the middle of it is open.
      fall += above > 0.0 ? 0.7 * (1.0 - smoothstep(0.35, 0.9, abs(c.x) / spread)) : 0.0;
      float dir = above > 0.0 ? -1.0 : 1.0;
      // Streams that wave as they run, not straight like flames.
      float wx = c.x + sin(c.y * 1.4 + uTime * 3.2) * 0.4;
      float streaks = noise(vec2(wx * 2.2, c.y * 0.3 + dir * uTime * mix(2.5, 6.0, uHeat)));
      // Bands of light running across, as on a surface of water.
      float ripple = 0.3 * sin(c.y * 2.2 - abs(c.x) * 0.9 - uTime * 5.0);
      return streaks * 1.2 + ripple + 0.1 - fall;`,
  },
  // Arcs of current crawling round the outline, redrawn sixteen times a second.
  lightning: {
    side: 2.8,
    up: 5.5,
    glsl: /* glsl */ `
      float fall = outline(c, mix(0.8, 2.2, uHeat), mix(1.4, 5.0, uHeat));
      float t = floor(uTime * 16.0);
      // Two sets of arcs at different sizes, both long enough to survive being cut into pixels.
      float big = ridge(noise(c * vec2(0.42, 0.3) + vec2(t * 3.1, t * 1.7)), 5.0);
      float small = ridge(noise(c * 0.8 + vec2(t * 5.3, -t * 2.9)), 6.0);
      return max(big * 1.7, small * 1.2) - fall * 0.9;`,
  },
  // Rays turning slowly round the top, pulsing outward.
  light: {
    side: 10.5,
    up: 10.5,
    glsl: /* glsl */ `
      vec2 d = vec2(c.x, c.y - uTop);
      float dist = length(d);
      float ang = atan(d.y, d.x);
      float turn = uTime * 0.18;
      float rays = noise(vec2(ang * 5.0 + turn * 5.0, 0.5)) * 0.65
        + noise(vec2(ang * 11.0 - turn * 8.0, 3.0)) * 0.45;
      float pulse = 0.12 * sin(uTime * 4.0 - dist * 1.5);
      float reach = mix(3.0, 10.0, uHeat) * uLevel;
      return rays * 1.3 + pulse - dist / max(reach, 0.01) - (1.0 - foot(c));`,
  },
  // Columns of code climbing the outline, a bright head on each stream.
  data: {
    side: 2.9,
    up: 6.5,
    glsl: /* glsl */ `
      float fall = outline(c, mix(0.7, 2.4, uHeat), mix(1.6, 6.0, uHeat));
      float col = floor(c.x / ${CELL});
      float speed = mix(3.0, 8.0, uHeat) * (0.55 + hash(vec2(col, 1.0)));
      float len = mix(2.0, 4.5, hash(vec2(col, 2.0)));
      float y = (c.y - uTime * speed) / len;
      float seg = fract(y);
      float on = step(0.4, hash(vec2(col, floor(y))));
      float glyph = 0.75 + 0.25 * hash(vec2(col, floor(c.y / ${CELL}) + floor(uTime * 10.0)));
      return seg * seg * seg * on * glyph * 1.7 - fall * 0.8;`,
  },
  // Streaks swept round and up, hugging the sides and opening into a funnel over the top.
  wind: {
    side: 6.5,
    up: 7.5,
    glsl: /* glsl */ `
      float above = c.y - uTop;
      float width = uR + max(above, 0.0) * 0.55;
      float fall = max(abs(c.x) - width, 0.0) / max(mix(0.8, 2.4, uHeat) * uLevel, 0.01)
        + max(above, 0.0) / max(mix(2.0, 7.0, uHeat) * uLevel, 0.01)
        + 1.0 - foot(c);
      // Bands wound round it like a spiral, climbing, cut into gusts that race across.
      float phase = c.y * 0.75 + c.x * 0.32 - uTime * mix(1.6, 3.5, uHeat);
      float bands = pow(clamp(1.0 - abs(fract(phase) * 2.0 - 1.0), 0.0, 1.0), 5.0);
      float gust = step(0.42, noise(vec2(c.x * 0.5 - uTime * mix(2.0, 5.0, uHeat), floor(phase) * 3.7)));
      return bands * gust * 1.8 - fall;`,
  },
  // Rings drawn in toward the top, broken into arcs that turn, and a halo hugging the outline.
  void: {
    side: 10.5,
    up: 10.5,
    glsl: /* glsl */ `
      vec2 d = vec2(c.x, (c.y - uTop) * 1.25);
      float dist = length(d);
      float ang = atan(d.y, d.x);
      float phase = dist * 0.55 + uTime * mix(0.7, 1.6, uHeat);
      float ring = fract(phase);
      float band = smoothstep(0.72, 0.9, ring) * (1.0 - smoothstep(0.9, 1.0, ring));
      float arcs = step(0.38, noise(vec2(ang * 2.5 + uTime * 0.6 + floor(phase) * 1.7, floor(phase))));
      float halo = (1.0 - smoothstep(0.0, mix(1.0, 2.2, uHeat) * uLevel, max(abs(c.x) - uR, 0.0)))
        * step(c.y, uTop) * 0.45;
      float reach = mix(3.5, 10.0, uHeat) * uLevel;
      return band * arcs * 1.7 + halo - dist / max(reach, 0.01) - (1.0 - foot(c));`,
  },
  // A five-petalled bloom in outline opening behind the top, turning, beating like a heart.
  petals: {
    side: 9,
    up: 9,
    glsl: /* glsl */ `
      vec2 d = vec2(c.x, c.y - uTop - 0.3);
      float dist = length(d);
      float beat = sin(uTime * 7.0);
      float size = mix(2.6, 7.5, uHeat) * uLevel * (1.0 + 0.06 * beat * beat);
      float a1 = atan(d.y, d.x) + uTime * 0.3;
      float x1 = dist / max(size * (0.45 + 0.55 * abs(cos(a1 * 2.5))), 0.01);
      float a2 = atan(d.y, d.x) - uTime * 0.45 + 0.63;
      float x2 = dist / max(size * 0.6 * (0.45 + 0.55 * abs(cos(a2 * 2.5))), 0.01);
      // Drawn as line, like a sign, not filled: two flowers turning against each other.
      float petal = 1.0 - abs(x1 - 0.92) * 7.0;
      float inner = 1.0 - abs(x2 - 0.92) * 7.0;
      return max(petal, inner * 0.85) * 1.3 - (1.0 - foot(c));`,
  },
};

const fragmentShaderFor = (element: ComboElement): string => /* glsl */ `
  ${PRELUDE}
  float field(vec2 c) {
    ${FIELDS[element].glsl}
  }
  void main() {
    // Into pixels: every fragment of a cell reads the cell's centre.
    vec2 c = (floor(vP / ${CELL}) + 0.5) * ${CELL};
    // Held back where the streak word sits, a few units over the middle of the top: it is in the
    // same colour and has to be read.
    float above = c.y - uTop;
    float gap = (1.0 - smoothstep(uR * 0.7, uR * 1.15, abs(c.x)))
      * smoothstep(1.2, 2.4, above) * (1.0 - smoothstep(5.5, 7.5, above));
    float level = floor(clamp(field(c) - gap * ${AURA.WORD_GAP.toFixed(2)}, 0.0, 1.0) * 5.0);
    vec3 col = level >= 4.0 ? uCore * 1.7
      : level >= 3.0 ? mix(uCore, uMid, 0.45) * 1.35
      : level >= 2.0 ? uMid * 1.1
      : level >= 1.0 ? uDeep * 1.5
      : vec3(0.0);
    gl_FragColor = vec4(col, level >= 1.0 ? uLevel : 0.0);
    #include <colorspace_fragment>
  }
`;

/** The aura's sheet and what moves it. */
export interface Aura {
  mesh: THREE.Mesh;
  update(t: ComboTower, lo: number, heat: number, dt: number, now: number): void;
  perfect(): void;
  tierUp(): void;
  dispose(): void;
}

/** The white-hot root: the colour's own hot, and for fire, yellowed. */
const coreOf = (element: ComboElement, p: Palette): [number, number, number] =>
  element === 'fire'
    ? [
        p.hot[0] + (1 - p.hot[0]) * 0.15,
        p.hot[1] + (0.85 - p.hot[1]) * 0.35,
        p.hot[2] + (0.35 - p.hot[2]) * 0.4,
      ]
    : [p.hot[0], p.hot[1], p.hot[2]];

export const createAura = (element: ComboElement, palette: Palette): Aura => {
  const geometry = new THREE.PlaneGeometry(1, 1);
  const uniforms = {
    uBase: { value: new THREE.Vector3() },
    uSize: { value: new THREE.Vector2(1, 1) },
    uBack: { value: 1 },
    uTime: { value: 0 },
    uHeat: { value: 0 },
    uLevel: { value: 0 },
    uR: { value: 1 },
    uTop: { value: 0 },
    uLo: { value: 0 },
    uCore: { value: new THREE.Color(...coreOf(element, palette)) },
    uMid: { value: new THREE.Color(...palette.mid) },
    uDeep: { value: new THREE.Color(...palette.deep) },
  };
  const material = new THREE.ShaderMaterial({
    vertexShader,
    fragmentShader: fragmentShaderFor(element),
    uniforms,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    toneMapped: false,
  });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.frustumCulled = false;
  mesh.raycast = () => {};
  mesh.renderOrder = 1;
  mesh.visible = false;
  const { side, up } = FIELDS[element];

  let level = 0;
  let flare = 0;
  return {
    mesh,
    update(t, lo, heat, dt, now) {
      level = t.running
        ? Math.min(1, level + dt / AURA.CATCH_S)
        : Math.max(0, level - dt / AURA.DIE_S);
      flare = Math.max(0, flare - flare * AURA.FLARE_DECAY * dt - 0.05 * dt);
      mesh.visible = level > 0.001;
      if (!mesh.visible) return;
      const r = Math.hypot(t.hw, t.hd);
      const bottom = Math.max(0, lo - 1);
      uniforms.uBase.value.set(t.cx, bottom, t.cz);
      uniforms.uSize.value.set(2 * (r + side), t.to - bottom + up);
      uniforms.uBack.value = r;
      uniforms.uTime.value = (now / 1000) % 1000;
      uniforms.uHeat.value = Math.min(1.3, heat + flare);
      uniforms.uLevel.value = level;
      uniforms.uR.value = r;
      uniforms.uTop.value = t.to;
      uniforms.uLo.value = lo;
    },
    perfect() {
      flare = Math.max(flare, AURA.PERFECT_FLARE);
    },
    tierUp() {
      flare = Math.max(flare, AURA.TIER_FLARE);
    },
    dispose() {
      geometry.dispose();
      material.dispose();
    },
  };
};
