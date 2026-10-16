import * as THREE from 'three';
import { STONE_GLSL } from '../board/rimMaterial';

/** What the stone function reads from the vertex stage. */
const STONE_VARYINGS = `varying vec3 vStoneM;
varying vec3 vStoneP;
varying vec3 vStoneHalf;
varying vec3 vStoneN;
varying vec3 vStoneEye;
`;

/**
 * The light a landing throws through a block.
 *
 * A perfect used to raise the whole block's emissive at once, which with bloom on a low
 * threshold meant every face -- including the top face you aim the next block at -- clipped to
 * white. The flash is the same event either way; what it needs is somewhere to come *from*.
 * It comes from the seam: the line where the block met the one below is where the two agreed,
 * so the light is hottest there and falls off up the block, leaving the top face in the
 * player's colour and readable while the chain runs.
 *
 * `uFlashHeight` is the block's height in world units, so local Y normalises to 0 at the seam
 * and 1 at the top face without the geometry having to carry an attribute for it. Every block
 * owns its own uniforms; nothing here is shared or tweened on the CPU per frame beyond the
 * single `uFlash` number.
 */
export interface FlashUniforms {
  /** Emissive added at the seam, in the flash colour. 0 at rest. */
  uFlash: { value: number };
  /** How much of the rim is pushed toward the flash colour at the seam, 0..1. */
  uRimFlash: { value: number };
  /** The colour the flash burns: the block's own colour pushed toward white. */
  uFlashColor: { value: THREE.Color };
  /** Block height in world units. */
  uFlashHeight: { value: number };
  /** Share of the flash that still reaches the top face. */
  uFlashTop: { value: number };
}

/** Share of the flash left at the top face. Low enough that the top stays the block's colour. */
export const FLASH_TOP_SHARE = 0.18;

/** The falloff, as GLSL. One string so the body and the rim cannot drift apart. */
const FALLOFF_GLSL = 'mix(1.0, uFlashTop, smoothstep(0.0, 1.0, vFlashY))';

/**
 * The same curve on the CPU, for anything that has to agree with the GPU.
 *
 * `y` is 0 at the seam and 1 at the top face.
 */
export const flashFalloff = (y: number, topShare: number = FLASH_TOP_SHARE): number => {
  const t = Math.min(1, Math.max(0, y));
  const smooth = t * t * (3 - 2 * t);
  return 1 + (topShare - 1) * smooth;
};

export const createFlashUniforms = (height = 1): FlashUniforms => ({
  uFlash: { value: 0 },
  uRimFlash: { value: 0 },
  uFlashColor: { value: new THREE.Color('#ffffff') },
  uFlashHeight: { value: Math.max(height, 0.0001) },
  uFlashTop: { value: FLASH_TOP_SHARE },
});

const VERTEX_PRELUDE = `uniform float uFlashHeight;
varying float vFlashY;
`;

const VERTEX_BODY = `#include <begin_vertex>
  vFlashY = clamp(position.y / uFlashHeight + 0.5, 0.0, 1.0);`;

const FRAGMENT_PRELUDE = `uniform float uFlash;
uniform float uRimFlash;
uniform vec3 uFlashColor;
uniform float uFlashTop;
varying float vFlashY;
`;

const patchVertex = (shader: THREE.WebGLProgramParametersWithUniforms): void => {
  shader.vertexShader = shader.vertexShader
    .replace('void main() {', `${VERTEX_PRELUDE}void main() {`)
    .replace('#include <begin_vertex>', VERTEX_BODY);
};

const bind = (shader: THREE.WebGLProgramParametersWithUniforms, uniforms: FlashUniforms): void => {
  shader.uniforms.uFlash = uniforms.uFlash;
  shader.uniforms.uRimFlash = uniforms.uRimFlash;
  shader.uniforms.uFlashColor = uniforms.uFlashColor;
  shader.uniforms.uFlashHeight = uniforms.uFlashHeight;
  shader.uniforms.uFlashTop = uniforms.uFlashTop;
};

/**
 * The stone a block is made of (shared/social/stones.ts): its shade, and the colour it is drawn
 * in, which is the block's own.
 */
export interface StoneUniforms {
  uStone: { value: number };
  uStoneColor: { value: THREE.Color };
  /**
   * Where the block's centre sits in the stone, in world units: its own place, less however far
   * off it was dropped. So the block in hand carries its stone as it slides, what lands keeps
   * the stone it had in hand, and a perfect stack lines its stone up (GameScene's anchors).
   */
  uStoneOffset: { value: THREE.Vector3 };
  /** Brightness over the stone's own, raised while a perfect streak runs as neon's glow is. */
  uStoneLift: { value: number };
  /** Seconds, for the stones that move. Shared by every block. */
  uStoneTime: { value: number };
}

/** The clock every run block's stone reads; GameScene sets it each frame. */
export const STONE_CLOCK = { value: 0 };

export const createStoneUniforms = (): StoneUniforms => ({
  uStone: { value: 0 },
  uStoneColor: { value: new THREE.Color('#ffffff') },
  uStoneOffset: { value: new THREE.Vector3() },
  uStoneLift: { value: 1 },
  uStoneTime: STONE_CLOCK,
});

/**
 * Add the seam flash to a block body: emissive on top of whatever the material already emits,
 * so the resting look is untouched while `uFlash` is zero. With `stone`, a block in any stone but
 * neon is drawn in it instead of the faction glow, by the same code as the map's towers
 * (rimMaterial's STONE_GLSL), in the block's own coordinates so it moves with the block.
 */
export const attachBodyFlash = (
  material: THREE.MeshStandardMaterial,
  uniforms: FlashUniforms,
  stone?: StoneUniforms
): void => {
  material.onBeforeCompile = (shader) => {
    bind(shader, uniforms);
    patchVertex(shader);
    if (stone) {
      shader.uniforms.uStone = stone.uStone;
      shader.uniforms.uStoneColor = stone.uStoneColor;
      shader.uniforms.uStoneOffset = stone.uStoneOffset;
      shader.uniforms.uStoneLift = stone.uStoneLift;
      shader.uniforms.uStoneTime = stone.uStoneTime;
      shader.vertexShader = shader.vertexShader
        .replace('void main() {', `uniform vec3 uStoneOffset;\n${STONE_VARYINGS}void main() {`)
        .replace(
          VERTEX_BODY,
          `${VERTEX_BODY}
  vStoneM = position + uStoneOffset;
  // The box is built about its centre, so its corners are its half extents.
  vStoneP = position;
  vStoneHalf = abs(position);
  vStoneN = normal;
  vStoneEye = cameraPosition - (modelMatrix * vec4(position, 1.0)).xyz;`
        );
    }
    shader.fragmentShader = shader.fragmentShader
      .replace(
        'void main() {',
        `${FRAGMENT_PRELUDE}${
          stone
            ? `uniform float uStone;\nuniform vec3 uStoneColor;\nuniform float uStoneLift;\nuniform float uStoneTime;\n${STONE_VARYINGS}${STONE_GLSL}`
            : ''
        }void main() {`
      )
      .replace(
        '#include <emissivemap_fragment>',
        `#include <emissivemap_fragment>${
          stone
            ? `
        {
          vec3 stoneLit = stoneBody(uStone, vStoneM, vStoneP, vStoneHalf, normalize(vStoneN),
            uStoneColor, 0.37, normalize(vStoneEye), uStoneTime);
          if (uStone > 0.5) totalEmissiveRadiance = stoneLit * uStoneLift;
        }`
            : ''
        }
        totalEmissiveRadiance += uFlashColor * (uFlash * ${FALLOFF_GLSL});`
      );
  };
  material.customProgramCacheKey = () => (stone ? 'block-body-flash-stone' : 'block-body-flash');
};

/**
 * The same gradient on the block's rim, so the bottom edge goes white-hot while the top edge
 * keeps its colour. Mixing rather than adding leaves the rim's own animated colour in charge.
 */
export const attachRimFlash = (
  material: THREE.LineBasicMaterial,
  uniforms: FlashUniforms
): void => {
  material.onBeforeCompile = (shader) => {
    bind(shader, uniforms);
    patchVertex(shader);
    shader.fragmentShader = shader.fragmentShader
      .replace('void main() {', `${FRAGMENT_PRELUDE}void main() {`)
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
        diffuseColor.rgb = mix(diffuseColor.rgb, uFlashColor, clamp(uRimFlash * ${FALLOFF_GLSL}, 0.0, 1.0));`
      );
  };
  material.customProgramCacheKey = () => 'block-rim-flash';
};
