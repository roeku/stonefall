import type { FactionId } from '../types/factions';

/**
 * Progress: experience, levels, the day's orders and the capstone.
 *
 * Stones say what a player's blocks are made of; this says how far they have come. Everything a
 * player does for their colour earns XP, and XP never goes away, so a level is the plainest
 * record there is of having kept coming back. It is in their flair, next to their colour, where
 * the subreddit sees it.
 *
 * What earns the most is what the map needs most: ground. A tower kept safe on the keep earns its
 * blocks and nothing more. Claimed land is worth half as much again, a rival's tower taken twice
 * as much, and a cell taken back from whoever took it three times, with every extra tower a take
 * brings down adding to it. The multiplier is said on the Raise button, at the moment the player
 * chooses between safe and greedy, so the choice is made knowing what each is worth.
 *
 * Every colour has three orders a day, the same for all of its players, so a colour can talk
 * about them and go after them together: one about fighting, one about ground, one about craft or
 * the relay. Finishing all three drops a second capstone.
 *
 * The capstone is the day's gift: the first tower a player raises each day has a stone fall onto
 * it out of the sky, which breaks open into XP. It grows with the streak, pays a dividend for
 * every cell the player still held when yesterday's map closed and a bonus when their colour won
 * it, and now and then it is gold and worth three times as much. Every seventh day in a row it is
 * always gold. Whether one is gold is decided by the player and the day, so it cannot be rerolled.
 *
 * Everything here is pure. The server decides with it, the harness's mock decides with it, and the
 * client draws with it.
 */

/** Every number progress is tuned by. */
export const XP = {
  /** A raised run's base: each block, and each perfect again. */
  PER_BLOCK: 1,
  PER_PERFECT: 1,
  /** What a raise multiplies the base by, by what it did. */
  MULT: {
    keep: 1,
    replace: 1,
    stack: 1.2,
    claim: 1.5,
    take: 2,
    retake: 3,
  },
  /** Added to a take's multiplier for each tower beyond the first that came down with the cell. */
  PER_TOPPLED: 0.5,
  MULT_MAX: 5,
  /** A relay block landed, and a perfect on top of that. */
  RELAY_PER_BLOCK: 3,
  RELAY_PER_PERFECT: 2,
  /** An order done. */
  ORDER: 60,
  /** The second capstone, for every order of the day done. */
  ORDERS_DONE: 100,
  CAPSTONE: {
    BASE: 30,
    PER_STREAK_DAY: 10,
    /** Streak days the capstone grows with; past this it stays as big. */
    STREAK_DAYS: 10,
    /** Each cell the player held when yesterday's map closed. */
    PER_HELD: 15,
    HELD_MAX: 20,
    /** Their colour held the most ground yesterday. */
    WON: 50,
    /** A gold capstone is worth this many times as much. */
    GOLD: 3,
    /** Every this many days in a row, the capstone is gold. */
    GOLD_EVERY: 7,
    /** Otherwise one day in this many, by the player and the day. */
    GOLD_ODDS: 8,
  },
  /** The first level's XP; each level after needs LEVEL_STEP more than the one before. */
  LEVEL_FIRST: 100,
  LEVEL_STEP: 50,
} as const;

// --- Levels ----------------------------------------------------------------------------------

/** XP from one level to the next. */
export const xpToNext = (level: number): number =>
  XP.LEVEL_FIRST + XP.LEVEL_STEP * Math.max(0, level - 1);

/** Total XP at which a level begins. Level 1 begins at nothing. */
export const xpAtLevel = (level: number): number => {
  const l = Math.max(1, Math.floor(level)) - 1;
  return XP.LEVEL_FIRST * l + (XP.LEVEL_STEP * l * (l - 1)) / 2;
};

export interface Level {
  level: number;
  /** XP into this level. */
  into: number;
  /** XP this level takes to finish. */
  need: number;
}

/** Where a total of XP stands: the level, and how far into it. */
export const levelOf = (xp: number): Level => {
  const total = Math.max(0, Math.floor(xp));
  let level = 1;
  while (xpAtLevel(level + 1) <= total) level += 1;
  return { level, into: total - xpAtLevel(level), need: xpToNext(level) };
};

// --- A raise ---------------------------------------------------------------------------------

/** What a raise did, as progress reads it. */
export type RaiseWhy = keyof typeof XP.MULT;

export interface RaiseXpInput {
  /** What the server said the raise was: keep, claim, stack or take. */
  kind: 'keep' | 'claim' | 'stack' | 'take';
  blocks: number;
  perfects: number;
  /** A take of the raiser's own tower: a replace, which wins nothing. */
  own?: boolean;
  /** A take of a cell the raiser held until the person it was taken from took it. */
  back?: boolean;
  /** Towers that came down with the cell, the one whose score was the bar among them. */
  fell?: number;
}

export interface RaiseXp {
  why: RaiseWhy;
  base: number;
  mult: number;
  xp: number;
}

/** The multiplier a raise would earn, before it is raised: what the Raise button says. */
export const raiseMult = (r: Omit<RaiseXpInput, 'blocks' | 'perfects'>): RaiseXp['mult'] =>
  raiseXp({ ...r, blocks: 0, perfects: 0 }).mult;

/** XP for a raised run: its blocks and perfects, times what the raise did for the colour. */
export const raiseXp = (r: RaiseXpInput): RaiseXp => {
  const why: RaiseWhy =
    r.kind === 'take' ? (r.own ? 'replace' : r.back ? 'retake' : 'take') : r.kind;
  const extra = why === 'take' || why === 'retake' ? Math.max(0, (r.fell ?? 1) - 1) : 0;
  const mult = Math.min(XP.MULT_MAX, XP.MULT[why] + extra * XP.PER_TOPPLED);
  const base =
    Math.max(0, Math.floor(r.blocks)) * XP.PER_BLOCK +
    Math.max(0, Math.floor(r.perfects)) * XP.PER_PERFECT;
  return { why, base, mult, xp: Math.round(base * mult) };
};

/** XP for blocks landed on the relay. */
export const relayXp = (blocks: number, perfects: number): number =>
  Math.max(0, blocks) * XP.RELAY_PER_BLOCK + Math.max(0, perfects) * XP.RELAY_PER_PERFECT;

// --- Orders ----------------------------------------------------------------------------------

export type OrderKind = 'take' | 'take-up' | 'topple' | 'claim' | 'stack' | 'relay' | 'perfects';

export interface Order {
  kind: OrderKind;
  /** How many it takes. */
  n: number;
  xp: number;
}

/** The three slots a day's orders are drawn from: a fight, ground, and craft or the relay. */
const SLOTS: ReadonlyArray<ReadonlyArray<Omit<Order, 'xp'>>> = [
  [
    { kind: 'take', n: 1 },
    { kind: 'take-up', n: 1 },
    { kind: 'topple', n: 1 },
  ],
  [
    { kind: 'claim', n: 2 },
    { kind: 'claim', n: 3 },
  ],
  [
    { kind: 'perfects', n: 10 },
    { kind: 'relay', n: 5 },
    { kind: 'relay', n: 8 },
    { kind: 'stack', n: 2 },
  ],
];

/** FNV-1a, the same hash a colour is handed out with: stable, and spread evenly. */
const hash = (text: string): number => {
  let h = 2166136261;
  for (let i = 0; i < text.length; i += 1) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
};

/** A colour's orders for a map day: the same for every player of it. */
export const ordersFor = (day: string, faction: FactionId): Order[] =>
  SLOTS.map((slot, i) => ({
    ...slot[hash(`${day}:${faction}:${i}`) % slot.length]!,
    xp: XP.ORDER,
  }));

/** An order, said the way the board says it. */
export const orderWords = (o: Pick<Order, 'kind' | 'n'>): string => {
  switch (o.kind) {
    case 'take':
      return o.n === 1 ? 'Take a tower' : `Take ${o.n} towers`;
    case 'take-up':
      return "Take a leader's tower";
    case 'topple':
      return 'Topple a stack';
    case 'claim':
      return `Win ${o.n} cells`;
    case 'stack':
      return o.n === 1 ? 'Stack on your land' : `Stack ${o.n} on your land`;
    case 'relay':
      return `Land ${o.n} relay blocks`;
    case 'perfects':
      return `${o.n} perfects in a run`;
  }
};

/** Something done that orders count. */
export type ProgressEvent =
  | {
      type: 'raise';
      kind: RaiseXpInput['kind'];
      own: boolean;
      /** The tower taken was a colour holding more ground than the raiser's, or the raiser's led. */
      ahead: boolean;
      fell: number;
      perfects: number;
    }
  | { type: 'relay'; blocks: number };

/** An order's count after something done. Never past `n`. */
export const advanceOrder = (order: Order, count: number, e: ProgressEvent): number => {
  const won = e.type === 'raise' && e.kind === 'take' && !e.own;
  let next = count;
  switch (order.kind) {
    case 'take':
      if (won) next += 1;
      break;
    case 'take-up':
      if (won && e.type === 'raise' && e.ahead) next += 1;
      break;
    case 'topple':
      if (won && e.type === 'raise' && e.fell >= 2) next += 1;
      break;
    case 'claim':
      // Ground won, whether it was empty or somebody's.
      if (e.type === 'raise' && (e.kind === 'claim' || won)) next += 1;
      break;
    case 'stack':
      if (e.type === 'raise' && e.kind === 'stack') next += 1;
      break;
    case 'relay':
      if (e.type === 'relay') next += e.blocks;
      break;
    case 'perfects':
      if (e.type === 'raise') next = Math.max(next, e.perfects);
      break;
  }
  return Math.min(order.n, Math.max(0, next));
};

// --- The day's own progress ------------------------------------------------------------------

/** A player's progress on one map day, as stored. */
export interface DayProgress {
  day: string;
  /** The colour the orders were for: changing colour gives the new colour's, from nothing. */
  faction: FactionId;
  counts: number[];
  /** Today's capstone has fallen. */
  capstone: boolean;
  /** Every order done, and its capstone fallen. */
  bonus: boolean;
}

export const freshDay = (day: string, faction: FactionId): DayProgress => ({
  day,
  faction,
  counts: [0, 0, 0],
  capstone: false,
  bonus: false,
});

/** A stored day's progress, or a fresh one for anything that is not this day and colour. */
export const dayProgressOf = (raw: string | undefined, day: string, faction: FactionId) => {
  if (raw) {
    try {
      const p = JSON.parse(raw) as Partial<DayProgress>;
      if (p.day === day && p.faction === faction && Array.isArray(p.counts)) {
        return {
          day,
          faction,
          counts: [0, 1, 2].map((i) => Math.max(0, Number(p.counts?.[i]) || 0)),
          capstone: p.capstone === true,
          bonus: p.bonus === true,
        } satisfies DayProgress;
      }
    } catch {
      // A fresh day, below.
    }
  }
  return freshDay(day, faction);
};

export interface OrderNews extends Order {
  count: number;
  done: boolean;
}

/** The day's orders as the client is shown them. */
export const ordersNews = (p: DayProgress): OrderNews[] =>
  ordersFor(p.day, p.faction).map((o, i) => {
    const count = Math.min(o.n, p.counts[i] ?? 0);
    return { ...o, count, done: count >= o.n };
  });

/**
 * Count something done against the day's orders. Mutates `p`; returns the orders it finished,
 * by index.
 */
export const countEvent = (p: DayProgress, e: ProgressEvent): number[] => {
  const done: number[] = [];
  ordersFor(p.day, p.faction).forEach((o, i) => {
    const before = p.counts[i] ?? 0;
    const after = advanceOrder(o, before, e);
    p.counts[i] = after;
    if (before < o.n && after >= o.n) done.push(i);
  });
  return done;
};

/** Every order of the day done. */
export const allDone = (p: DayProgress): boolean =>
  ordersFor(p.day, p.faction).every((o, i) => (p.counts[i] ?? 0) >= o.n);

// --- The capstone ----------------------------------------------------------------------------

export interface CapstoneParts {
  /** Days in a row, today included. */
  streak: number;
  /** Cells the player held when yesterday's map closed. */
  held: number;
  /** Their colour held the most ground yesterday. */
  won: boolean;
}

export interface Capstone extends CapstoneParts {
  xp: number;
  golden: boolean;
}

/** Whether a player's capstone on a day is gold: every seventh day in a row, or by chance. */
export const isGolden = (userId: string, day: string, streak: number, salt = ''): boolean =>
  (streak > 0 && streak % XP.CAPSTONE.GOLD_EVERY === 0 && salt === '') ||
  hash(`${userId}:${day}${salt}`) % XP.CAPSTONE.GOLD_ODDS === 0;

/** The day's capstone: its XP and what made it up. */
export const capstoneFor = (userId: string, day: string, p: CapstoneParts): Capstone => {
  const c = XP.CAPSTONE;
  const streak = Math.max(0, Math.floor(p.streak));
  const held = Math.max(0, Math.floor(p.held));
  const base =
    c.BASE +
    Math.min(streak, c.STREAK_DAYS) * c.PER_STREAK_DAY +
    Math.min(held, c.HELD_MAX) * c.PER_HELD +
    (p.won ? c.WON : 0);
  const golden = isGolden(userId, day, streak);
  return { streak, held, won: p.won, golden, xp: golden ? base * c.GOLD : base };
};

/** The capstone for every order of the day done: a fixed size, gold by its own chance. */
export const ordersCapstone = (userId: string, day: string): { xp: number; golden: boolean } => {
  const golden = isGolden(userId, day, 0, ':orders');
  return { golden, xp: golden ? XP.ORDERS_DONE * XP.CAPSTONE.GOLD : XP.ORDERS_DONE };
};

// --- What the client is told -----------------------------------------------------------------

/** One thing that earned XP, in the order it happened, for the board to play out. */
export type XpGain =
  | { kind: 'raise'; xp: number; base: number; mult: number; why: RaiseWhy }
  | { kind: 'relay'; xp: number; blocks: number }
  | { kind: 'order'; xp: number; order: number }
  | {
      kind: 'capstone';
      xp: number;
      golden: boolean;
      /** The capstone for every order done, rather than the day's first. */
      orders?: boolean;
      streak?: number;
      held?: number;
      won?: boolean;
    };

/** Where a player stands with progress, sent with whatever may have earned some. */
export interface ProgressNews {
  /** Total XP, ever. The level is `levelOf(xp)`. */
  xp: number;
  /** Today's orders. */
  orders: OrderNews[];
  /** Whether today's capstone has fallen yet. */
  capstone: boolean;
  /** What the thing just done earned, in order. Empty when it earned nothing. */
  gains: XpGain[];
}

/** XP before the gains in a piece of news: where the level ring starts filling from. */
export const xpBefore = (news: Pick<ProgressNews, 'xp' | 'gains'>): number =>
  news.xp - news.gains.reduce((n, g) => n + g.xp, 0);
