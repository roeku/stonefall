import { describe, expect, it } from 'vitest';
import { resolveGridStep } from './usePlacementMode';

/**
 * The D-pad is the only way to move the placement cursor on inline posts, where tap is the sole
 * permitted input. Directions are resolved relative to the camera, so pressing "up" always walks
 * the cursor away from the viewer regardless of how the view has been rotated.
 *
 * Getting this wrong is not a crash -- the controls just quietly invert, which is far more
 * confusing to a player than an obvious failure. Hence pinning it.
 */
/**
 * Negating or multiplying a zero component yields -0, which Object.is (and therefore toBe and
 * toEqual) treats as distinct from +0. That distinction is meaningless for a grid step, so both
 * sides are normalised before comparison.
 */
const norm = (n: number): number => n + 0;
const normStep = (step: { dx: number; dz: number }) => ({ dx: norm(step.dx), dz: norm(step.dz) });

describe('resolveGridStep', () => {
  // At rotation 0 the camera sits at +X looking back toward the origin,
  // so "away from the viewer" is -X.
  it('maps up to away-from-camera at rotation 0', () => {
    expect(resolveGridStep('up', 0)).toEqual({ dx: -1, dz: 0 });
    expect(resolveGridStep('down', 0)).toEqual({ dx: 1, dz: 0 });
  });

  it('keeps left and right perpendicular to up', () => {
    const up = resolveGridStep('up', 0);
    const right = resolveGridStep('right', 0);
    // Perpendicular vectors have a zero dot product.
    expect(norm(up.dx * right.dx + up.dz * right.dz)).toBe(0);
  });

  it('always opposes up with down and left with right', () => {
    for (let i = 0; i < 16; i++) {
      const rotation = (Math.PI / 8) * i;
      const up = resolveGridStep('up', rotation);
      const down = resolveGridStep('down', rotation);
      const left = resolveGridStep('left', rotation);
      const right = resolveGridStep('right', rotation);

      expect(normStep(down)).toEqual(normStep({ dx: -up.dx, dz: -up.dz }));
      expect(normStep(left)).toEqual(normStep({ dx: -right.dx, dz: -right.dz }));
    }
  });

  it('rotates the mapping a quarter turn when the view turns a quarter turn', () => {
    const up = resolveGridStep('up', 0);
    const upQuarter = resolveGridStep('up', Math.PI / 2);
    // A 90-degree view rotation must change which axis "up" walks along.
    expect(normStep(upQuarter)).not.toEqual(normStep(up));
    // ...and specifically to the perpendicular one, not the reverse.
    expect(norm(up.dx * upQuarter.dx + up.dz * upQuarter.dz)).toBe(0);
  });

  it('reverses up after half a turn', () => {
    const up = resolveGridStep('up', 0);
    const flipped = resolveGridStep('up', Math.PI);
    expect(normStep(flipped)).toEqual(normStep({ dx: -up.dx, dz: -up.dz }));
  });

  it('only ever returns unit steps along one axis', () => {
    const directions = ['up', 'down', 'left', 'right'] as const;
    for (let i = 0; i < 24; i++) {
      const rotation = (Math.PI / 12) * i;
      for (const direction of directions) {
        const step = resolveGridStep(direction, rotation);
        // Exactly one axis moves, by exactly one cell -- never diagonal, never a double step.
        expect(Math.abs(step.dx) + Math.abs(step.dz)).toBe(1);
      }
    }
  });

  it('handles negative rotation the same as its positive equivalent', () => {
    expect(resolveGridStep('up', -Math.PI / 2)).toEqual(resolveGridStep('up', (3 * Math.PI) / 2));
  });
});
