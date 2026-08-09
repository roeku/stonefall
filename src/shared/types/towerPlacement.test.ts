import { describe, expect, it } from 'vitest';
import { MAX_STACK_PER_CELL, TowerPlacementSystem } from './towerPlacement';

/**
 * Cell stacking is the foundation of player-built structures: a tower's vertical offset is
 * derived from the summed height of everything beneath it in the same cell. The ordering and
 * offset arithmetic is easy to get subtly wrong in ways that only show up as floating or
 * intersecting towers on screen, so it's pinned here.
 */
describe('TowerPlacementSystem stacking', () => {
  const system = () => new TowerPlacementSystem(8, 0, 0, 4);

  it('places a first tower on the ground', () => {
    const s = system();
    expect(s.placeTower(0, 0, 'a', 10)).toBe(true);
    expect(s.getStackBaseY(0, 0, 'a')).toBe(0);
    expect(s.getStackHeight(0, 0)).toBe(10);
  });

  it('refuses placeTower on an occupied cell so auto-assignment still finds free ground', () => {
    const s = system();
    s.placeTower(0, 0, 'a', 10);
    expect(s.placeTower(0, 0, 'b', 5)).toBe(false);
    expect(s.getStack(0, 0)).toHaveLength(1);
  });

  it('stacks each tower on top of the combined height below it', () => {
    const s = system();
    s.placeTower(1, 1, 'bottom', 10);
    s.stackTower(1, 1, 'middle', 4);
    s.stackTower(1, 1, 'top', 6);

    expect(s.getStackBaseY(1, 1, 'bottom')).toBe(0);
    expect(s.getStackBaseY(1, 1, 'middle')).toBe(10);
    expect(s.getStackBaseY(1, 1, 'top')).toBe(14);
    expect(s.getStackHeight(1, 1)).toBe(20);
  });

  it('stacks onto an empty cell without needing placeTower first', () => {
    const s = system();
    expect(s.stackTower(2, 2, 'solo', 3)).toBe(true);
    expect(s.getCoordinate(2, 2)?.isOccupied).toBe(true);
  });

  it('reports the top of the stack as the cell towerId', () => {
    const s = system();
    s.placeTower(0, 0, 'bottom', 10);
    s.stackTower(0, 0, 'top', 5);
    expect(s.getCoordinate(0, 0)?.towerId).toBe('top');
  });

  it('rejects duplicates and enforces the stack cap', () => {
    const s = system();
    s.placeTower(0, 0, 'a', 1);
    expect(s.stackTower(0, 0, 'a', 1)).toBe(false);

    for (let i = 1; i < MAX_STACK_PER_CELL; i++) {
      expect(s.stackTower(0, 0, `t${i}`, 1)).toBe(true);
    }
    expect(s.canStack(0, 0)).toBe(false);
    expect(s.stackTower(0, 0, 'overflow', 1)).toBe(false);
  });

  it('closes the gap when a tower is removed from the middle', () => {
    const s = system();
    s.placeTower(0, 0, 'bottom', 10);
    s.stackTower(0, 0, 'middle', 4);
    s.stackTower(0, 0, 'top', 6);

    expect(s.unstackTower(0, 0, 'middle')).toBe(true);
    // 'top' drops onto 'bottom' rather than being left floating at its old offset.
    expect(s.getStackBaseY(0, 0, 'top')).toBe(10);
    expect(s.getStackHeight(0, 0)).toBe(16);
  });

  it('frees the cell once the last tower is removed', () => {
    const s = system();
    s.placeTower(0, 0, 'only', 5);
    s.unstackTower(0, 0, 'only');

    const coord = s.getCoordinate(0, 0);
    expect(coord?.isOccupied).toBe(false);
    expect(coord?.towerId).toBeUndefined();
    // The cell is genuinely reusable, not just flagged empty.
    expect(s.placeTower(0, 0, 'next', 2)).toBe(true);
  });

  it('grounds unknown towers instead of floating them', () => {
    const s = system();
    s.placeTower(0, 0, 'a', 10);
    expect(s.getStackBaseY(0, 0, 'not-here')).toBe(0);
    expect(s.getStackBaseY(9, 9, 'a')).toBe(0);
  });

  it('treats unknown heights as zero so legacy towers share a base', () => {
    const s = system();
    s.placeTower(0, 0, 'legacy');
    s.stackTower(0, 0, 'next', 5);
    expect(s.getStackBaseY(0, 0, 'next')).toBe(0);
  });

  it('clears stacks on reset', () => {
    const s = system();
    s.placeTower(0, 0, 'a', 5);
    s.stackTower(0, 0, 'b', 5);
    s.reset();
    expect(s.getStack(0, 0)).toHaveLength(0);
    expect(s.getCoordinate(0, 0)?.isOccupied).toBe(false);
  });

  it('keeps occupied cells out of the available list', () => {
    const s = system();
    const before = s.getAvailableCoordinates().length;
    s.placeTower(0, 0, 'a', 5);
    expect(s.getAvailableCoordinates().length).toBe(before - 1);
    // Stacking does not free the cell back up.
    s.stackTower(0, 0, 'b', 5);
    expect(s.getAvailableCoordinates().length).toBe(before - 1);
  });
});
