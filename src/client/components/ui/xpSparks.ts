/**
 * XP as sparks: little squares of the player's colour that burst out of whatever earned them and
 * are pulled into the level, each one ticking it up as it arrives.
 *
 * The number is told by the count of things arriving, not only by a figure: a take sends twice as
 * many as a keep, a gold capstone a swarm. They are drawn straight into a layer of the DOM, one
 * element each, and animated by the browser, so a burst costs React nothing.
 */

/** Every number the sparks are tuned by. Times in ms, distances in CSS px. */
export const SPARKS = {
  /** Fewest and most sparks in one burst, and XP per spark between them. */
  MIN: 4,
  MAX: 18,
  XP_EACH: 12,
  /** How far they burst out before turning for the level. */
  BURST: 54,
  /** How long one takes to arrive, and the stagger between them. */
  FLIGHT_MS: 760,
  STAGGER_MS: 34,
  /** Side of a spark's core; its ring of colour is drawn round it. */
  SIZE: 6,
} as const;

/** How many sparks a sum of XP is. */
export const sparkCount = (xp: number): number =>
  Math.max(SPARKS.MIN, Math.min(SPARKS.MAX, Math.round(xp / SPARKS.XP_EACH)));

/** How long a burst of `n` takes, from the first leaving to the last arriving. */
export const burstMs = (n: number): number => SPARKS.FLIGHT_MS + (n - 1) * SPARKS.STAGGER_MS;

/** `xp` split into `n` whole shares that add back up to it, the remainder on the last. */
export const shares = (xp: number, n: number): number[] => {
  const each = Math.floor(xp / n);
  return Array.from({ length: n }, (_, i) => (i === n - 1 ? xp - each * (n - 1) : each));
};

export interface Point {
  x: number;
  y: number;
}

/**
 * Fire a burst of `n` sparks from `from` into `to`, both in the layer's own pixels. `onArrive`
 * hears each landing, in order. Returns a function that stops them where they are.
 */
export const fireSparks = (
  layer: HTMLElement,
  from: Point,
  to: Point,
  n: number,
  color: string,
  onArrive: (i: number) => void
): (() => void) => {
  const animations: Animation[] = [];
  const nodes: HTMLElement[] = [];
  const half = SPARKS.SIZE / 2;
  for (let i = 0; i < n; i++) {
    const node = document.createElement('span');
    node.className = 'xp-spark';
    // A white-hot core in a ring of the colour: bright enough to follow over a lit map.
    node.style.background = '#ffffff';
    node.style.boxShadow = `0 0 0 2px ${color}, 0 0 10px 2px ${color}`;
    layer.appendChild(node);
    nodes.push(node);
    // Out in a ring, a little uneven, then in to the level, faster and faster.
    const a = (i / n) * Math.PI * 2 + Math.random() * 0.6;
    const r = SPARKS.BURST * (0.6 + Math.random() * 0.6);
    const out = { x: from.x + Math.cos(a) * r, y: from.y + Math.sin(a) * r * 0.7 - 12 };
    const at = (p: Point, s: number, turn: number) =>
      `translate(${p.x - half}px, ${p.y - half}px) scale(${s}) rotate(${turn}deg)`;
    const anim = node.animate(
      [
        // Each keyframe's easing is its leg's: a burst that slows, then a pull that quickens.
        {
          transform: at(from, 0.3, 0),
          opacity: 0,
          offset: 0,
          easing: 'cubic-bezier(0.2, 0.8, 0.3, 1)',
        },
        {
          transform: at(out, 1.15, 90),
          opacity: 1,
          offset: 0.34,
          easing: 'cubic-bezier(0.55, 0, 0.9, 0.45)',
        },
        { transform: at(to, 0.45, 220), opacity: 1, offset: 1 },
      ],
      {
        duration: SPARKS.FLIGHT_MS,
        delay: i * SPARKS.STAGGER_MS,
        easing: 'linear',
        fill: 'both',
      }
    );
    animations.push(anim);
    anim.onfinish = () => {
      node.remove();
      onArrive(i);
    };
  }
  return () => {
    for (const a of animations) a.cancel();
    for (const node of nodes) node.remove();
  };
};
