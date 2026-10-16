import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { COMPRESS_K, compressHeight, createRimMaterial } from './rimMaterial';

/** Run the material's patch against the stock basic shader, as three would. */
const patch = (
  material: THREE.Material
): { uniforms: Record<string, unknown>; vertexShader: string; fragmentShader: string } => {
  const shader = {
    uniforms: {} as Record<string, unknown>,
    vertexShader: THREE.ShaderLib.basic.vertexShader,
    fragmentShader: THREE.ShaderLib.basic.fragmentShader,
  };
  material.onBeforeCompile(
    shader as unknown as THREE.WebGLProgramParametersWithUniforms,
    null as unknown as THREE.WebGLRenderer
  );
  return shader;
};

describe('compressHeight', () => {
  it('leaves heights alone at zero', () => {
    expect(compressHeight(0, 0)).toBe(0);
    expect(compressHeight(150, 0)).toBe(150);
    expect(compressHeight(1500, 0)).toBe(1500);
  });

  it('keeps a small tower and holds a spire to a bounded height', () => {
    // A twenty-block tower stays recognisable; a thousand-block one no longer dominates.
    expect(compressHeight(30, 1)).toBeGreaterThan(20);
    expect(compressHeight(1500, 1)).toBeLessThan(200);
    expect(compressHeight(1500, 1)).toBeGreaterThan(compressHeight(300, 1));
  });

  it('is monotonic, so a stack stays in order', () => {
    let last = -1;
    for (let y = 0; y <= 2000; y += 25) {
      const c = compressHeight(y, 1);
      expect(c).toBeGreaterThan(last);
      last = c;
    }
  });

  it('is exactly the curve the shader uses', () => {
    expect(compressHeight(COMPRESS_K, 1)).toBeCloseTo(COMPRESS_K * Math.log(2), 6);
  });
});

describe("the board's block material", () => {
  it('finds its anchors in the basic shader with stones, a squash and a build clock', () => {
    const time = { value: 3 };
    const shader = patch(
      createRimMaterial({ grow: { time }, compress: { value: 1 }, stones: true })
    );

    // A three upgrade that renames an include would silently drop the stone or its inputs.
    expect(shader.vertexShader).toContain('vStoneM =');
    expect(shader.vertexShader).toContain('vStoneP = stoneAt - stoneCentre');
    // The eye is taken from where the block is drawn, after the squash, not where it stands.
    expect(shader.vertexShader).toContain('stoneShown = (modelMatrix * mvPosition).xyz');
    expect(shader.vertexShader).toContain('vStoneEye = cameraPosition - stoneShown');
    expect(shader.fragmentShader).toContain('vec3 body = stoneBody(vStone, vStoneM');
    // A stone that moves runs on the build clock.
    expect(shader.uniforms.uTime).toBe(time);
  });

  it('gives faces too small for their lines a fill instead, stones or not', () => {
    for (const stones of [false, true]) {
      const shader = patch(createRimMaterial({ stones }));
      expect(shader.fragmentShader).toContain('lines *= open');
      expect(shader.fragmentShader).toContain('float fill =');
      expect(shader.fragmentShader.includes('stoneBody(')).toBe(stones);
    }
  });
});
