import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { THREE_CATALOGUE } from './threeCatalogue';

/** Every .tsx file in the client. */
const sources = (dir: string): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory()
      ? sources(join(dir, e.name))
      : e.name.endsWith('.tsx')
        ? [readFileSync(join(dir, e.name), 'utf8')]
        : []
  );

/**
 * DOM and SVG tags that share a name with a three.js class. In the game's JSX they are the DOM
 * ones (the icons' `<path>`); a three.js `<line>` would have to be registered by hand.
 */
const DOM_NAMES = new Set(['path', 'line', 'audio', 'source']);

const pascal = (tag: string) => tag[0]!.toUpperCase() + tag.slice(1);

/**
 * The three.js tags the client's JSX opens. A lower-case tag is three's when three exports a
 * class by its capitalised name; that also skips type arguments such as `useState<number>`.
 */
const threeTags = (): string[] => {
  const tags = new Set<string>();
  for (const src of sources(__dirname)) {
    for (const m of src.matchAll(/<([a-z][A-Za-z0-9]*)\b/g)) tags.add(m[1]!);
  }
  return [...tags]
    .filter((t) => t !== 'primitive' && !DOM_NAMES.has(t))
    .filter((t) => typeof (THREE as Record<string, unknown>)[pascal(t)] === 'function')
    .sort();
};

describe('three catalogue', () => {
  it('registers every three.js tag the client renders', () => {
    const tags = threeTags();
    // The scan has to be finding the game's JSX at all, or this test proves nothing.
    expect(tags).toContain('mesh');
    expect(tags).toContain('instancedMesh');
    const missing = tags.filter((t) => !(pascal(t) in THREE_CATALOGUE));
    expect(missing).toEqual([]);
  });

  it("registers what drei's <Html> and the bloom's <EffectComposer> create inside", () => {
    for (const name of ['Group', 'Mesh', 'PlaneGeometry', 'ShaderMaterial'])
      expect(THREE_CATALOGUE).toHaveProperty(name);
  });

  it('holds three.js classes under their own names', () => {
    for (const [name, cls] of Object.entries(THREE_CATALOGUE))
      expect(cls).toBe((THREE as Record<string, unknown>)[name]);
  });
});
