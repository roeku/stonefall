import { describe, expect, it } from 'vitest';
import { FACTION_IDS } from '../../../shared/types/factions';
import {
  ComboParticles,
  ELEMENT_OF,
  ELEMENT_TUNING,
  ELEMENTS,
  elementOf,
  heatOf,
  type ComboElement,
  type ComboTower,
  type Emit,
} from './factionElements';

const tower = (over: Partial<ComboTower> = {}): ComboTower => ({
  cx: 3,
  cz: -2,
  hw: 4,
  hd: 4,
  from: 6,
  to: 30,
  tier: 5,
  running: true,
  ...over,
});

const finite = (particles: ComboParticles): boolean =>
  particles.pool
    .filter((p) => p.alive)
    .every((p) =>
      [p.x, p.y, p.z, p.vx, p.vy, p.vz, p.dx, p.dy, p.dz, p.size0, p.size1, p.rot].every(
        Number.isFinite
      )
    );

/** Plays a combo through an element: a while burning, perfects, a new name, and the break. */
const play = (element: ComboElement, t: ComboTower, frames = 120): ComboParticles => {
  const particles = new ComboParticles();
  const behaviour = ELEMENTS[element];
  const emit: Emit = {
    tower: t,
    palette: { hot: [1, 0.9, 0.8], mid: [1, 0.4, 0.2], deep: [0.3, 0.05, 0.02] },
    heat: heatOf(t.tier),
    lo: Math.max(t.from, t.to - ELEMENT_TUNING.REACH),
    spawn: particles.spawn,
  };
  for (let f = 0; f < frames; f++) {
    if (f === 10) behaviour.perfect(emit);
    if (f === 30) behaviour.tierUp(emit);
    if (f === 90) {
      t.running = false;
      behaviour.fizzle(emit, particles.alive());
    }
    if (t.running) behaviour.ambient(emit, 1 / 60);
    particles.step(1 / 60, t);
  }
  return particles;
};

describe('faction elements', () => {
  it('gives every colour an element of its own', () => {
    const elements = FACTION_IDS.map((id) => ELEMENT_OF[id]);
    expect(new Set(elements).size).toBe(FACTION_IDS.length);
    expect(elementOf('ember')).toBe('fire');
    expect(elementOf('cobalt')).toBe('lightning');
    expect(elementOf('cyan')).toBe('water');
    expect(elementOf(null)).toBe('water');
  });

  it('heats up with the tier, fastest early, and stops at full', () => {
    expect(heatOf(1)).toBe(0);
    expect(heatOf(2)).toBeGreaterThan(0.25);
    expect(heatOf(5)).toBeGreaterThan(heatOf(3));
    expect(heatOf(ELEMENT_TUNING.FULL_HEAT_TIER)).toBe(1);
    expect(heatOf(15)).toBe(1);
  });

  for (const element of Object.keys(ELEMENTS) as ComboElement[]) {
    it(`${element}: burns while the combo runs and never draws a NaN`, () => {
      const t = tower();
      const particles = new ComboParticles();
      const behaviour = ELEMENTS[element];
      const emit: Emit = {
        tower: t,
        palette: { hot: [1, 1, 1], mid: [0.5, 0.5, 1], deep: [0.1, 0.1, 0.2] },
        heat: heatOf(t.tier),
        lo: 15,
        spawn: particles.spawn,
      };
      behaviour.perfect(emit);
      behaviour.tierUp(emit);
      // Lightning lives a tenth of a second at a time, so it is the most seen, not the last frame.
      let peak = 0;
      let clean = true;
      for (let f = 0; f < 60; f++) {
        behaviour.ambient(emit, 1 / 60);
        particles.step(1 / 60, t);
        peak = Math.max(peak, particles.alive().length);
        clean &&= finite(particles);
      }
      expect(peak).toBeGreaterThan(0);
      expect(clean).toBe(true);
    });

    it(`${element}: dies out after the break`, () => {
      const particles = play(element, tower(), 90 + 60 * 3);
      expect(particles.alive().length).toBe(0);
    });

    it(`${element}: holds up on a one-block streak at the floor and at full heat`, () => {
      expect(finite(play(element, tower({ from: 0, to: 1.5, tier: 1 }), 60))).toBe(true);
      expect(finite(play(element, tower({ from: 0, to: 160, tier: 15 }), 60))).toBe(true);
    });
  }

  it('reuses the oldest particle when the pool is full rather than failing', () => {
    const particles = new ComboParticles();
    for (let i = 0; i < ELEMENT_TUNING.POOL + 50; i++) particles.spawn({ life: 5 });
    expect(particles.alive().length).toBe(ELEMENT_TUNING.POOL);
  });
});
