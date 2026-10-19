import React from 'react';
import {
  levelOf,
  xpBefore,
  type OrderNews,
  type ProgressNews,
  type XpGain,
} from '../../shared/social/progress';
import { AudioPlayer } from '../components/audio/AudioPlayer';
import { capstoneTimes, CAPSTONE, type CapstoneDrop } from '../components/board/Capstone';
import type { Project } from '../components/board/ScreenProjector';
import { burstMs, fireSparks, shares, sparkCount, type Point } from '../components/ui/xpSparks';

/**
 * Rewards, played out: what a raise earned arriving on screen in the order it was earned.
 *
 * The server has already counted it all (shared/social/progress.ts); this is the opening of the
 * gift. The level on the chrome shows `shownXp`, which lags the real total while XP is in the air
 * and catches up spark by spark, so the ring fills because something visibly reached it. A level
 * is gained the moment the spark that crosses it lands, not when the response arrives.
 *
 * Order of a sequence: the raise's own XP bursts off the tower, then the day's capstone falls onto
 * it and breaks, then each order done flashes its line and sends its XP up, then the capstone for
 * every order done. A run starting in the middle of it finishes it at once (`flush`): nothing is
 * lost, it is only not watched.
 */

/** Every number the sequence is tuned by, ms. */
export const REWARDS = {
  /** After the raise's mark appears, before its XP leaves the tower. */
  RAISE_XP_AFTER: 420,
  /** Between one gain's sparks arriving and the next gain starting. */
  GAP: 260,
  /** How long an order's line holds "done" before showing the next one. */
  ORDER_HOLD: 1400,
  /** How long the level-up callout is up. */
  LEVEL_UP_MS: 2200,
  /** How much higher than the tower's top a capstone's mark floats. */
  MARK_LIFT: 7,
  /** How long the map stays stepped back after a capstone's XP has landed. */
  CAPSTONE_LIGHT_MS: 500,
} as const;

const GOLD = '#ffd166';

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

/** What the sequence asks of the rest of the board, which owns these things. */
export interface RewardStage {
  /** The scene's camera, to start sparks from a point in the world. */
  project: React.MutableRefObject<Project | null>;
  /** The DOM layer sparks are drawn in, over everything. */
  layer: React.MutableRefObject<HTMLElement | null>;
  /** A word floating off the tower, like a raise's. */
  mark: (m: { at: Vec3; text: string; color: string; sub: string; note?: string }) => void;
  /** A shockwave on a tower's top, `size` times a capstone's width. */
  ring: (at: Vec3, size: number) => void;
  /** A jolt to the camera, 0 to 1. */
  quake: (strength: number) => void;
  /** Light the player's towers while the map steps back, for `ms`. */
  spotlight: (ms: number) => void;
  /** A level gained: whatever is floating over the map makes way for it. */
  clearMarks: () => void;
}

export interface RewardsHook {
  /** The XP the chrome shows: behind the real total while XP is still arriving. Null until known. */
  shownXp: number | null;
  /** Bumped by every spark that lands, so the level can take the hit. */
  hit: number;
  /** A level just gained, for the callout. */
  levelUp: { key: number; level: number } | null;
  /** An order just done, by index, for its line. */
  orderDone: { key: number; index: number } | null;
  /** Capstones falling or breaking. */
  capstones: CapstoneDrop[];
  capstoneBeats: {
    onLand: (d: CapstoneDrop) => void;
    onCrack: (d: CapstoneDrop, i: number) => void;
    onBurst: (d: CapstoneDrop) => void;
    onDone: (d: CapstoneDrop) => void;
  };
  /** Take on where progress stands, without playing anything: the first load, a refresh. */
  adopt: (news: ProgressNews | null | undefined) => void;
  /**
   * Play what something earned, from `at` (the top of the tower it is about), starting `delay` ms
   * from now. `size` is how big a capstone is drawn there. Returns how long the whole sequence
   * takes, a level gained's callout included.
   */
  play: (news: ProgressNews, at: Vec3, color: string, delay?: number, size?: number) => number;
  /** A sequence is playing: the board keeps its own tags out of the way. */
  busy: boolean;
  /**
   * Keep what something earned for the next sequence: a raise that went straight into another run
   * (Again) is not watched, and its capstone falls on the next tower that is.
   */
  defer: (news: ProgressNews) => void;
  /** Finish everything now. */
  flush: () => void;
  /**
   * Something that may earn XP has been asked for (a raise): hold the level where it is, so the
   * answer arriving does not jump it before the sequence plays. `release` lets go when it failed.
   */
  expect: () => void;
  release: () => void;
  /** The orders as the chrome shows them: an order turns done when its beat plays, not before. */
  orders: OrderNews[] | null;
}

/**
 * What a sequence nobody watched keeps for the next: the capstones and orders, the gifts. A
 * raise's own XP is only counted, since the tower it left is already behind a run.
 */
const giftsOf = (gains: readonly XpGain[]): XpGain[] =>
  gains.filter((g) => g.kind === 'capstone' || g.kind === 'order');

/** XP in a list of gains. */
const xpIn = (gains: readonly XpGain[]): number => gains.reduce((n, g) => n + g.xp, 0);

/** Orders as shown while some are still to be opened: those not done yet, one short. */
const ordersBefore = (orders: readonly OrderNews[], gains: readonly XpGain[]): OrderNews[] => {
  const pending = new Set(gains.flatMap((g) => (g.kind === 'order' ? [g.order] : [])));
  return orders.map((o, i) =>
    pending.has(i) ? { ...o, done: false, count: Math.max(0, o.n - 1) } : o
  );
};

/** Where on screen an element's middle is, in the layer's pixels. */
const middleOf = (el: Element | null, layer: HTMLElement): Point | null => {
  if (!el) return null;
  const r = el.getBoundingClientRect();
  const l = layer.getBoundingClientRect();
  if (r.width === 0 && r.height === 0) return null;
  return { x: r.left + r.width / 2 - l.left, y: r.top + r.height / 2 - l.top };
};

export const useRewards = (stage: RewardStage): RewardsHook => {
  const [shownXp, setShownXp] = React.useState<number | null>(null);
  const [hit, setHit] = React.useState(0);
  const [levelUp, setLevelUp] = React.useState<RewardsHook['levelUp']>(null);
  const [orderDone, setOrderDone] = React.useState<RewardsHook['orderDone']>(null);
  const [capstones, setCapstones] = React.useState<CapstoneDrop[]>([]);
  const [orders, setOrders] = React.useState<OrderNews[] | null>(null);
  const [busy, setBusy] = React.useState(false);
  const expecting = React.useRef(false);
  const finalOrders = React.useRef<OrderNews[] | null>(null);

  const shown = React.useRef<number | null>(null);
  const target = React.useRef<number | null>(null);
  const timers = React.useRef<number[]>([]);
  const stops = React.useRef<Array<() => void>>([]);
  const deferred = React.useRef<XpGain[]>([]);
  /** What each capstone falling is worth, for when it breaks. */
  const capGains = React.useRef(new Map<number, Extract<XpGain, { kind: 'capstone' }>>());
  const stageRef = React.useRef(stage);
  React.useEffect(() => {
    stageRef.current = stage;
  });

  const setShown = React.useCallback((xp: number) => {
    shown.current = xp;
    setShownXp(xp);
  }, []);

  /** XP arriving: the level moves, and gains a level the moment a spark crosses one. */
  const addXp = React.useCallback(
    (amount: number) => {
      const before = shown.current ?? 0;
      const after = before + amount;
      setShown(after);
      const gained = levelOf(after).level;
      if (gained > levelOf(before).level) {
        const key = performance.now();
        setLevelUp({ key, level: gained });
        AudioPlayer.playLevelUp();
        stageRef.current.clearMarks();
        stageRef.current.spotlight(REWARDS.LEVEL_UP_MS);
        const t = window.setTimeout(
          () => setLevelUp((l) => (l?.key === key ? null : l)),
          REWARDS.LEVEL_UP_MS
        );
        timers.current.push(t);
      }
    },
    [setShown]
  );

  const later = React.useCallback((ms: number, fn: () => void) => {
    timers.current.push(window.setTimeout(fn, Math.max(0, ms)));
  }, []);

  /** Send `xp` from a point on screen into the level, spark by spark. */
  const send = React.useCallback(
    (from: Point | null, xp: number, color: string) => {
      const layer = stageRef.current.layer.current;
      const level = layer
        ? middleOf(layer.parentElement?.querySelector('.ui-level') ?? null, layer)
        : null;
      const n = sparkCount(xp);
      if (!layer || !from || !level) {
        // Nowhere to fly from or to (the level is hidden): it still arrives, all at once.
        later(SPARKS_FALLBACK_MS, () => addXp(xp));
        return;
      }
      const parts = shares(xp, n);
      stops.current.push(
        fireSparks(layer, from, level, n, color, (i) => {
          addXp(parts[i] ?? 0);
          setHit((h) => h + 1);
          AudioPlayer.playXpTick(i, n);
        })
      );
    },
    [addXp, later]
  );

  const projectFrom = React.useCallback((at: Vec3): Point | null => {
    const p = stageRef.current.project.current?.(at.x, at.y, at.z) ?? null;
    return p;
  }, []);

  const flush = React.useCallback(() => {
    for (const t of timers.current) window.clearTimeout(t);
    timers.current = [];
    for (const stop of stops.current) stop();
    stops.current = [];
    capGains.current.clear();
    setCapstones([]);
    setOrderDone(null);
    setBusy(false);
    if (target.current !== null) setShown(target.current);
    if (finalOrders.current) setOrders(finalOrders.current);
  }, [setShown]);

  const adopt = React.useCallback(
    (news: ProgressNews | null | undefined) => {
      if (!news) return;
      target.current = news.xp;
      finalOrders.current = news.orders;
      // Mid-sequence, or waiting on one, the sequence brings the level there itself.
      if (expecting.current || timers.current.length > 0 || stops.current.length > 0) return;
      // Gifts kept for later are still to be opened.
      setShown(news.xp - xpIn(deferred.current));
      setOrders(ordersBefore(news.orders, deferred.current));
    },
    [setShown]
  );

  const expect = React.useCallback(() => {
    expecting.current = true;
  }, []);

  const release = React.useCallback(() => {
    expecting.current = false;
    if (timers.current.length > 0 || stops.current.length > 0) return;
    if (target.current !== null) setShown(target.current);
    if (finalOrders.current) setOrders(finalOrders.current);
  }, [setShown]);

  const defer = React.useCallback(
    (news: ProgressNews) => {
      expecting.current = false;
      deferred.current.push(...giftsOf(news.gains));
      target.current = news.xp;
      finalOrders.current = news.orders;
      // Nothing flies, so the level shows all of it but the gifts kept, which it shows when they
      // are opened.
      setShown(news.xp - xpIn(deferred.current));
      setOrders(ordersBefore(news.orders, deferred.current));
    },
    [setShown]
  );

  const play = React.useCallback(
    (news: ProgressNews, at: Vec3, color: string, delay = 0, size = 1): number => {
      flush();
      expecting.current = false;
      setBusy(true);
      // Gifts kept from a raise nobody watched open after this raise's own XP has left the tower,
      // so the two never float over each other; anything else they earned is counted already.
      const kept = deferred.current;
      deferred.current = [];
      const own = news.gains.filter((g) => g.kind === 'raise' || g.kind === 'relay');
      const rest = news.gains.filter((g) => g.kind !== 'raise' && g.kind !== 'relay');
      const gains = [...own, ...kept, ...rest];
      target.current = news.xp;
      finalOrders.current = news.orders;
      setShown(xpBefore({ xp: news.xp, gains }));
      // An order done here shows as still to do, nearly there, until its beat.
      setOrders(ordersBefore(news.orders, gains));
      let t = delay;
      /** When the first capstone starts to fall: the map steps back from then to the end. */
      let lightFrom: number | null = null;

      for (const gain of gains) {
        if (gain.kind === 'raise' || gain.kind === 'relay') {
          t += REWARDS.RAISE_XP_AFTER;
          const start = t;
          later(start, () => send(projectFrom(at), gain.xp, color));
          t = start + burstMs(sparkCount(gain.xp)) + REWARDS.GAP;
        } else if (gain.kind === 'capstone') {
          const start = t;
          const key = performance.now() + start + Math.random();
          capGains.current.set(key, gain);
          later(start, () => {
            setCapstones((c) => [
              ...c,
              {
                key,
                x: at.x,
                y: at.y,
                z: at.z,
                color,
                golden: gain.golden,
                at: performance.now(),
                size,
              },
            ]);
            AudioPlayer.playCapstoneFall(CAPSTONE.FALL_MS / 1000);
          });
          lightFrom ??= start;
          t = start + capstoneTimes.burst + burstMs(sparkCount(gain.xp)) + REWARDS.GAP;
        } else {
          const start = t;
          const index = gain.order;
          later(start, () => {
            setOrderDone({ key: performance.now(), index });
            setOrders((os) =>
              os ? os.map((o, i) => (i === index ? (news.orders[i] ?? o) : o)) : news.orders
            );
            AudioPlayer.playOrderDone();
            // From the line's little blocks, where the one for this order has just lit.
            const layer = stageRef.current.layer.current;
            const from = layer
              ? middleOf(layer.parentElement?.querySelector('.ui-orders__pips') ?? null, layer)
              : null;
            send(from ?? projectFrom(at), gain.xp, color);
          });
          later(start + REWARDS.ORDER_HOLD, () => setOrderDone(null));
          t = start + Math.max(REWARDS.ORDER_HOLD, burstMs(sparkCount(gain.xp))) + REWARDS.GAP;
        }
      }
      // However the sparks went, the level ends where the server says it is.
      later(t, () => {
        timers.current = [];
        stops.current = [];
        setShown(news.xp);
        setOrders(news.orders);
        setBusy(false);
      });
      const levelled = levelOf(news.xp).level > levelOf(xpBefore({ xp: news.xp, gains })).level;
      const end = t + (levelled ? REWARDS.LEVEL_UP_MS : 0);
      // From the first capstone on, the map stays stepped back, through every beat after it and a
      // level gained, so the gifts are the bright things on screen and the light never flickers
      // back between them.
      if (lightFrom !== null) {
        const from = lightFrom;
        later(from, () => stageRef.current.spotlight(end - from + REWARDS.CAPSTONE_LIGHT_MS));
      }
      return end;
    },
    [flush, later, send, projectFrom, setShown]
  );

  const capstoneBeats = React.useMemo(
    () => ({
      onLand: (d: CapstoneDrop) => {
        AudioPlayer.playCapstoneLand();
        stageRef.current.quake(0.45);
        stageRef.current.ring({ x: d.x, y: d.y, z: d.z }, d.size);
      },
      onCrack: (_d: CapstoneDrop, i: number) => AudioPlayer.playCapstoneCrack(i),
      onBurst: (d: CapstoneDrop) => {
        const gain = capGains.current.get(d.key);
        AudioPlayer.playCapstoneBreak(d.golden);
        stageRef.current.ring({ x: d.x, y: d.y + CAPSTONE.HEIGHT * d.size, z: d.z }, d.size * 1.6);
        if (!gain) return;
        const top = { x: d.x, y: d.y + REWARDS.MARK_LIFT * d.size, z: d.z };
        const words: string[] = [];
        if (!gain.orders) {
          if ((gain.streak ?? 0) > 1) words.push(`${gain.streak}-day streak`);
          if ((gain.held ?? 0) > 0) words.push(`${gain.held} held`);
          if (gain.won) words.push('Your colour won');
        }
        stageRef.current.mark({
          at: top,
          text: `+${gain.xp.toLocaleString()}`,
          color: d.golden ? GOLD : d.color,
          sub: gain.orders
            ? d.golden
              ? 'Gold · every order done'
              : 'Every order done'
            : d.golden
              ? 'Gold capstone'
              : 'Capstone',
          ...(words.length > 0 ? { note: words.join(' · ') } : {}),
        });
        send(projectFrom({ x: d.x, y: d.y, z: d.z }), gain.xp, d.golden ? GOLD : d.color);
      },
      onDone: (d: CapstoneDrop) => {
        capGains.current.delete(d.key);
        setCapstones((c) => c.filter((x) => x.key !== d.key));
      },
    }),
    [send, projectFrom]
  );

  React.useEffect(
    () => () => {
      for (const t of timers.current) window.clearTimeout(t);
      for (const stop of stops.current) stop();
    },
    []
  );

  return {
    shownXp,
    hit,
    levelUp,
    orderDone,
    capstones,
    capstoneBeats,
    adopt,
    play,
    defer,
    flush,
    expect,
    release,
    orders,
    busy,
  };
};

/** XP with nowhere to fly arrives this long after it would have left. */
const SPARKS_FALLBACK_MS = 500;
