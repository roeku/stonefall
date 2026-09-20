import { describe, expect, it } from 'vitest';
import { planTiles } from './tilePlan';
import { REGION_PITCH, regionCenterCell } from '../../../shared/types/worldGrid';

describe('planTiles', () => {
  it('lays nine tiles per keep and one per hold', () => {
    const c = regionCenterCell({ rx: 1, rz: 0 });
    const plan = planTiles(
      {
        keeps: [
          { userId: 'a', username: 'a', faction: 'jade', rx: 1, rz: 0, centerX: c.x, centerZ: c.z },
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
      null
    );
    expect(plan.keeps).toHaveLength(9);
    expect(plan.land).toHaveLength(1);
    expect(plan.reach).toHaveLength(0);
  });

  it("marks the viewer's whole plot as reach on day one, minus the keep and held cells", () => {
    const plan = planTiles({ keeps: [], land: [] }, { faction: 'cyan', region: { rx: 0, rz: 0 } });
    // 49 cells in the plot, 9 of them the keep.
    expect(plan.reach).toHaveLength(40);
    expect(plan.reach.every((t) => Math.max(Math.abs(t.x), Math.abs(t.z)) <= 3)).toBe(true);
    expect(plan.reach.some((t) => Math.abs(t.x) >= REGION_PITCH - 3)).toBe(false);
  });
});
