import { describe, expect, it } from 'vitest';
import {
  breakCombo,
  chargeAmp,
  chargeArrives,
  chargeCombo,
  COMBO,
  comboGlow,
  comboLightAt,
  comboLightOff,
} from './comboLight';

const lit = (tier = 1, now = 1000) => chargeCombo(comboLightOff(), { from: 3, to: 6, tier, now });

describe('comboLightAt', () => {
  it('is off until a combo starts', () => {
    const v = comboLightAt(comboLightOff(), 5000);
    expect(v.from).toBeGreaterThan(v.to);
    expect(v.amp).toBe(0);
  });

  it('brings the corners up over GLOW_IN_MS and holds them', () => {
    const s = lit(1, 1000);
    expect(comboLightAt(s, 1000).glow).toBe(0);
    expect(comboLightAt(s, 1000 + COMBO.GLOW_IN_MS).glow).toBeCloseTo(comboGlow(1));
    expect(comboLightAt(s, 9000).glow).toBeCloseTo(comboGlow(1));
  });

  it('runs a charge from the foot of the streak to the top, then lets it go', () => {
    const s = lit(1, 1000);
    const start = comboLightAt(s, 1000);
    const mid = comboLightAt(s, 1000 + COMBO.CHARGE_MS / 2);
    const there = comboLightAt(s, chargeArrives(1000));
    expect(start.head).toBeCloseTo(3);
    expect(mid.head).toBeGreaterThan(3);
    expect(mid.head).toBeLessThan(6);
    expect(there.head).toBeCloseTo(6);
    expect(there.amp).toBeCloseTo(chargeAmp(1));
    expect(comboLightAt(s, chargeArrives(1000) + COMBO.CHARGE_POOL_MS).amp).toBe(0);
  });

  it("sets a tall streak's charge off where the camera can see it climb", () => {
    const s = chargeCombo(comboLightOff(), { from: 0, to: 90, tier: 9, now: 0 });
    expect(comboLightAt(s, 0).head).toBeCloseTo(90 - COMBO.CHARGE_REACH);
    // The whole streak stays lit below the charge.
    expect(comboLightAt(s, 0).from).toBe(0);
  });

  it('keeps the corners up from one perfect to the next', () => {
    const first = lit(1, 1000);
    const next = chargeCombo(first, { from: 3, to: 7.5, tier: 1, now: 2000 });
    expect(next.litAt).toBe(1000);
    expect(comboLightAt(next, 2000).glow).toBeCloseTo(comboGlow(1));
  });

  it('drains a broken combo down out of the streak and goes dark', () => {
    const s = breakCombo(lit(3, 1000), 5000);
    const early = comboLightAt(s, 5000 + COMBO.DRAIN_MS * 0.25);
    const late = comboLightAt(s, 5000 + COMBO.DRAIN_MS * 0.75);
    expect(early.to).toBeLessThan(6);
    expect(late.to).toBeLessThan(early.to);
    expect(late.glow).toBeLessThan(early.glow);
    expect(late.head).toBe(late.to);
    const gone = comboLightAt(s, 5000 + COMBO.DRAIN_MS);
    expect(gone.from).toBeGreaterThan(gone.to);
  });

  it('drains once: a second break does not restart it', () => {
    const s = breakCombo(lit(), 5000);
    expect(breakCombo(s, 5200).drainAt).toBe(5000);
    expect(breakCombo(comboLightOff(), 5000).drainAt).toBeNaN();
  });

  it('lights up again on a new combo after a drain', () => {
    const drained = breakCombo(lit(2, 1000), 3000);
    const again = chargeCombo(drained, { from: 9, to: 12, tier: 1, now: 3100 });
    expect(again.drainAt).toBeNaN();
    expect(again.litAt).toBe(3100);
  });

  it('gets brighter with the tier, within its caps', () => {
    expect(comboGlow(5)).toBeGreaterThan(comboGlow(1));
    expect(chargeAmp(5)).toBeGreaterThan(chargeAmp(1));
    expect(comboGlow(15)).toBeLessThanOrEqual(COMBO.GLOW_MAX);
    expect(chargeAmp(15)).toBeLessThanOrEqual(COMBO.CHARGE_AMP_MAX);
  });
});
