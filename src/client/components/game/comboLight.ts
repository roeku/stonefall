/**
 * The combo, in the tower.
 *
 * A run of perfects used to leave nothing in the world that a single perfect did not: every
 * landing flashed its seam and threw its rings, and a ninth perfect in a row looked like the
 * first. Only the word over the tower knew it was a combo. Now the combo has a body.
 *
 * Perfect blocks stand on each other edge to edge, so a streak's upright edges run as one line
 * from the block it began on to the top: those are the combo's corners. While it runs they stay
 * lit, so how far the streak goes back is something you can see on the tower; each perfect
 * sends a charge up them to the new top; a new streak name throws them on into the sky
 * (ComboSpire); and a break drains the light down out of them. All of it is on the uprights,
 * never on the top face the next block is aimed at, and it brightens with the streak's tier.
 *
 * Everything here is in the run's own space, world units up from the floor, and time is
 * performance.now() milliseconds. The shader half is in blockFlash (COMBO_GLSL).
 */

export const COMBO = {
  /** Perfects in a row that make a combo: one is a perfect, two are a streak. */
  MIN_STREAK: 2,
  /** Resting light on the corners at the first tier, added per tier after, and its cap. */
  GLOW: 0.22,
  GLOW_PER_TIER: 0.06,
  GLOW_MAX: 0.85,
  /** ms the corners take to come up when a combo starts. */
  GLOW_IN_MS: 180,
  /** ms the charge takes from the foot of the streak (or REACH below the top) to the top. */
  CHARGE_MS: 280,
  /** Furthest below the top a charge sets off, world units: about what the run camera shows. */
  CHARGE_REACH: 15,
  /** The charge's tail, world units, at the first tier and per tier. */
  CHARGE_LEN: 2.2,
  CHARGE_LEN_PER_TIER: 0.35,
  /** Its brightness over the resting light at the first tier, per tier, and its cap. */
  CHARGE_AMP: 1.1,
  CHARGE_AMP_PER_TIER: 0.12,
  CHARGE_AMP_MAX: 2.4,
  /** ms the charge stays pooled in the top corners once it arrives, fading. */
  CHARGE_POOL_MS: 220,
  /** ms a broken combo's light takes to run down out of the streak. */
  DRAIN_MS: 520,
  /** The drain's front, as bright as a charge this much. */
  DRAIN_AMP: 0.9,
} as const;

/** What the scene keeps between landings. */
export interface ComboLightState {
  /** The foot of the streak's first block. Lit only while `from < to`. */
  from: number;
  /** The top of its latest block. */
  to: number;
  /** The streak's tier (constants/streakTiers). */
  tier: number;
  /** When the combo lit, for the corners coming up. */
  litAt: number;
  /** When the latest charge set off, and where from. */
  chargeAt: number;
  chargeFrom: number;
  /** When a break began draining it; NaN while it runs. */
  drainAt: number;
}

/** What the shader is handed each frame. Off is `from > to`. */
export interface ComboLightValues {
  from: number;
  to: number;
  glow: number;
  head: number;
  len: number;
  amp: number;
}

const OFF_FROM = 1e6;
const OFF_TO = -1e6;

export const COMBO_OFF: ComboLightValues = {
  from: OFF_FROM,
  to: OFF_TO,
  glow: 0,
  head: OFF_TO,
  len: 1,
  amp: 0,
};

export const comboLightOff = (): ComboLightState => ({
  from: OFF_FROM,
  to: OFF_TO,
  tier: 0,
  litAt: 0,
  chargeAt: -Infinity,
  chargeFrom: 0,
  drainAt: NaN,
});

const isLit = (s: ComboLightState): boolean => s.from < s.to;

export const comboGlow = (tier: number): number =>
  Math.min(COMBO.GLOW_MAX, COMBO.GLOW + COMBO.GLOW_PER_TIER * Math.max(0, tier - 1));

export const chargeAmp = (tier: number): number =>
  Math.min(
    COMBO.CHARGE_AMP_MAX,
    COMBO.CHARGE_AMP + COMBO.CHARGE_AMP_PER_TIER * Math.max(0, tier - 1)
  );

const chargeLen = (tier: number): number =>
  COMBO.CHARGE_LEN + COMBO.CHARGE_LEN_PER_TIER * Math.max(0, tier - 1);

/**
 * A perfect that keeps a combo going (or starts one): the streak now runs from `from` to `to`,
 * and a charge sets off up it.
 */
export const chargeCombo = (
  s: ComboLightState,
  at: { from: number; to: number; tier: number; now: number }
): ComboLightState => {
  const running = isLit(s) && Number.isNaN(s.drainAt);
  return {
    from: at.from,
    to: at.to,
    tier: at.tier,
    litAt: running ? s.litAt : at.now,
    chargeAt: at.now,
    chargeFrom: Math.max(at.from, at.to - COMBO.CHARGE_REACH),
    drainAt: NaN,
  };
};

/** A landing that was not perfect, or the fall: whatever is lit drains out. */
export const breakCombo = (s: ComboLightState, now: number): ComboLightState =>
  isLit(s) && Number.isNaN(s.drainAt) ? { ...s, drainAt: now } : s;

/** When a charge set off at `chargeAt` reaches the top: when a spire leaves it. */
export const chargeArrives = (chargeAt: number): number => chargeAt + COMBO.CHARGE_MS;

/** The light at `now`. */
export const comboLightAt = (s: ComboLightState, now: number): ComboLightValues => {
  if (!isLit(s)) return COMBO_OFF;
  const len = chargeLen(s.tier);

  if (!Number.isNaN(s.drainAt)) {
    const t = (now - s.drainAt) / COMBO.DRAIN_MS;
    if (t >= 1) return COMBO_OFF;
    const k = Math.max(0, t);
    // Slow out of the top, then falling: the light runs down the way a block would.
    const to = s.to - (s.to - s.from) * k * k;
    return {
      from: s.from,
      to,
      glow: comboGlow(s.tier) * (1 - k),
      head: to,
      len,
      amp: COMBO.DRAIN_AMP * (1 - k),
    };
  }

  const glow = comboGlow(s.tier) * Math.min(1, Math.max(0, (now - s.litAt) / COMBO.GLOW_IN_MS));
  const ct = (now - s.chargeAt) / COMBO.CHARGE_MS;
  let head = s.to;
  let amp = 0;
  if (ct >= 0 && ct < 1) {
    // Gathering speed as it climbs, so it arrives at the top with a hit rather than settling.
    head = s.chargeFrom + (s.to - s.chargeFrom) * Math.pow(ct, 1.6);
    amp = chargeAmp(s.tier);
  } else if (ct >= 1) {
    const pt = (now - s.chargeAt - COMBO.CHARGE_MS) / COMBO.CHARGE_POOL_MS;
    amp = pt < 1 ? chargeAmp(s.tier) * (1 - pt) : 0;
  }
  return { from: s.from, to: s.to, glow, head, len, amp };
};
