import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import {
  attachBodyFlash,
  attachRimFlash,
  createFlashUniforms,
  flashFalloff,
  FLASH_TOP_SHARE,
} from './blockFlash';

/** Run a material's patch against the stock shader three would hand it. */
const patch = (
  material: THREE.Material,
  lib: 'standard' | 'basic'
): { uniforms: Record<string, unknown>; vertexShader: string; fragmentShader: string } => {
  const shader = {
    uniforms: {} as Record<string, unknown>,
    vertexShader: THREE.ShaderLib[lib].vertexShader,
    fragmentShader: THREE.ShaderLib[lib].fragmentShader,
  };
  material.onBeforeCompile(
    shader as unknown as THREE.WebGLProgramParametersWithUniforms,
    null as unknown as THREE.WebGLRenderer
  );
  return shader;
};

describe('flashFalloff', () => {
  it('is hottest at the seam and nearly out at the top face', () => {
    expect(flashFalloff(0)).toBe(1);
    expect(flashFalloff(1)).toBeCloseTo(FLASH_TOP_SHARE, 6);
  });

  it('only ever dims going up the block', () => {
    let last = Infinity;
    for (let y = 0; y <= 1; y += 0.05) {
      const v = flashFalloff(y);
      expect(v).toBeLessThanOrEqual(last);
      last = v;
    }
  });

  it('clamps outside the block', () => {
    expect(flashFalloff(-2)).toBe(1);
    expect(flashFalloff(4)).toBeCloseTo(FLASH_TOP_SHARE, 6);
  });
});

describe('the block flash patches', () => {
  it('finds its anchors in the standard shader and shares the uniform objects', () => {
    const uniforms = createFlashUniforms(2);
    const material = new THREE.MeshStandardMaterial();
    attachBodyFlash(material, uniforms);
    const shader = patch(material, 'standard');

    // The gradient needs a varying from the vertex stage and emissive added in the fragment
    // one. A three upgrade that renames either include would silently drop the flash.
    expect(shader.vertexShader).toContain('vFlashY =');
    expect(shader.fragmentShader).toContain('totalEmissiveRadiance += uFlashColor');
    expect(shader.uniforms.uFlash).toBe(uniforms.uFlash);
    expect(shader.uniforms.uFlashHeight).toBe(uniforms.uFlashHeight);
  });

  it('finds its anchors in the basic shader the rim compiles from', () => {
    const uniforms = createFlashUniforms(2);
    const material = new THREE.LineBasicMaterial();
    attachRimFlash(material, uniforms);
    const shader = patch(material, 'basic');

    expect(shader.vertexShader).toContain('vFlashY =');
    expect(shader.fragmentShader).toContain('diffuseColor.rgb = mix(diffuseColor.rgb, uFlashColor');
    expect(shader.uniforms.uRimFlash).toBe(uniforms.uRimFlash);
  });

  it('starts dark, so a resting block looks like it did before', () => {
    const uniforms = createFlashUniforms(2);
    expect(uniforms.uFlash.value).toBe(0);
    expect(uniforms.uRimFlash.value).toBe(0);
    expect(uniforms.uFlashHeight.value).toBe(2);
  });
});
