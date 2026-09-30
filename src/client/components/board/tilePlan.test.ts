import { describe, expect, it } from 'vitest';
import { planTiles } from './tilePlan';
import { REGION_PITCH, regionCenterCell } from '../../../shared/types/worldGrid';
import { KEEP_RADIUS, LEGACY_KEEP_RADIUS, REACH } from '../../../shared/types/territory';

describe('planTiles', () => {
  it('lays a tile per keep cell and one per hold', () => {
    const c = regionCenterCell({ rx: 1, rz: 0 });
    const plan = (keepRadius: number) =>
      planTiles(
        {
          keeps: [
            {
              userId: 'a',
              username: 'a',
              faction: 'jade',
              rx: 1,
              rz: 0,
              centerX: c.x,
              centerZ: c.z,
            },
          ],
          land: [
            {
              x: 2,
              z: 2,
              userId: 'b',
              username: 'b',
              faction: 'rose',
              score: 1,
              sessionId: 's',
              placedAt: 1,
            },
          ],
        },
        null,
        keepRadius
      );
    expect(plan(KEEP_RADIUS).keeps).toEqual([expect.objectContaining({ x: c.x, z: c.z })]);
    expect(plan(LEGACY_KEEP_RADIUS).keeps).toHaveLength(9);
    expect(plan(KEEP_RADIUS).land).toHaveLength(1);
    expect(plan(KEEP_RADIUS).reach).toHaveLength(0);
  });

  it('marks the 5x5 round the keep as reach on day one, minus the keep itself', () => {
    const plan = planTiles(
      { keeps: [], land: [] },
      { faction: 'cyan', region: { rx: 0, rz: 0 } },
      KEEP_RADIUS
    );
    // 25 cells within reach of the keep, one of them the keep.
    expect(plan.reach).toHaveLength(24);
    expect(plan.reach.every((t) => Math.max(Math.abs(t.x), Math.abs(t.z)) <= REACH)).toBe(true);
  });

  it("marked the viewer's whole plot as reach on day one with a 3x3 keep", () => {
    const plan = planTiles(
      { keeps: [], land: [] },
      { faction: 'cyan', region: { rx: 0, rz: 0 } },
      LEGACY_KEEP_RADIUS
    );
    // 49 cells in the plot, 9 of them the keep.
    expect(plan.reach).toHaveLength(40);
    expect(plan.reach.every((t) => Math.max(Math.abs(t.x), Math.abs(t.z)) <= 3)).toBe(true);
    expect(plan.reach.some((t) => Math.abs(t.x) >= REGION_PITCH - 3)).toBe(false);
  });
});
