import React from 'react';
import { factionRgb } from '../../../shared/types/factions';
import { cellName } from '../../../shared/types/worldGrid';
import { streakName, streakTierIndex } from '../../constants/streakTiers';
import { AudioPlayer } from '../audio/AudioPlayer';
import type { RunPass } from '../game/PassRings';
import type { Target } from '../../hooks/useSocial';

interface RunHudProps {
  score: number;
  perfectCount: number;
  blockCount: number;
  /** The run has ended; hold on the result before the board takes over. */
  over: boolean;
  /**
   * What the run is for, as the end of it reads it: the highest rival bar passed, or the first
   * still ahead. What the result says it did.
   */
  target?: Target | null | undefined;
  /** The bars this run is shown, lowest first. The one under the score is the next not passed. */
  ladder: readonly Target[];
  /** Bars passed so far, in the order they fell. */
  passes: readonly RunPass[];
  /** The player's best standing tower, so a run can be measured against it as it happens. */
  myBest: number;
  /** How many towers the player has standing. Zero makes this their first. */
  myTowers: number;
}

/**
 * One word just above the top of the tower. Streak words escalate with the streak; the two
 * milestones, a new best and passing somebody, outrank them for a moment so a perfect landing on
 * the same drop cannot wipe them out.
 */
interface Callout {
  key: number;
  kind: 'streak' | 'pass' | 'best';
  word: string;
  /** A name under the word, in its owner's colour. */
  sub?: { text: string; rgb: string | null } | undefined;
  /** Streak tier, 0 for Flush. */
  tier: number;
}

/** How long a milestone callout keeps the word slot from streak words, ms. */
const MILESTONE_HOLD_MS = 700;

/** The end of a run: the fall plays this long before the result comes in, ms. */
const RESULT_DELAY_MS = 400;
/** Gap between one line of the result arriving and the next, ms. */
const RESULT_STAGGER_MS = 60;
/** How long the result's score takes to count up, ms. */
const RESULT_TALLY_MS = 600;

/**
 * The size and colour a callout earns. Streak words grow 5 percent a tier up to Monolith, and go
 * from white to the player's colour to gold, so a long streak is seen climbing, not just read.
 */
const calloutLook = (c: Callout): { scale: number; tone: 'ink' | 'accent' | 'gold' | 'good' } => {
  if (c.kind === 'best') return { scale: 1.2, tone: 'gold' };
  if (c.kind === 'pass') return { scale: 1.1, tone: 'ink' };
  return {
    scale: 1 + 0.05 * Math.min(c.tier, 7),
    tone: c.tier >= 6 ? 'gold' : c.tier >= 3 ? 'accent' : 'ink',
  };
};

/**
 * Counts a number up to its new value rather than jumping, so a score reads as earned.
 * Frame-driven and short: a placement is worth watching for a third of a second, not longer.
 */
const useCountUp = (value: number, ms = 320): number => {
  const [shown, setShown] = React.useState(value);
  const shownRef = React.useRef(value);
  React.useEffect(() => {
    const from = shownRef.current;
    if (from === value) return;
    const start = performance.now();
    let frame = 0;
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / ms);
      const eased = 1 - Math.pow(1 - t, 3);
      const next = Math.round(from + (value - from) * eased);
      shownRef.current = next;
      setShown(next);
      if (t < 1) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [value, ms]);
  return shown;
};

/** Counts from nothing to `value`, starting after `delay`: the result's tally. */
const useTally = (value: number, delay: number, ms: number): number => {
  const [shown, setShown] = React.useState(0);
  React.useEffect(() => {
    const start = performance.now() + delay;
    let frame = 0;
    const tick = (now: number) => {
      const t = Math.min(1, Math.max(0, (now - start) / ms));
      setShown(Math.round(value * (1 - Math.pow(1 - t, 3))));
      if (t < 1) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [value, delay, ms]);
  return shown;
};

const cellOf = (t: Target): string => (t.cell ? cellName(t.cell.x, t.cell.z) : '');

/** A player's own best, put in front of an unaimed run: "New best" says it when it goes. */
const isOwnBest = (t: Target | null | undefined): boolean =>
  !!t && t.kind === 'beat' && t.own === true;

/** The CSS colour variable for somebody's name, when their colour is known. */
const rimOf = (t: Target): React.CSSProperties | undefined =>
  t.faction
    ? ({ ['--rim-rgb' as string]: factionRgb(t.faction) } as React.CSSProperties)
    : undefined;

/** A username inside a sentence, in its owner's colour. */
const Name: React.FC<{ t: Target }> = ({ t }) => (
  <span className="ui-name" style={rimOf(t)}>
    u/{t.username}
  </span>
);

/** One line of the result, arriving in its turn. */
const line = (i: number): React.CSSProperties =>
  ({
    ['--delay' as string]: `${RESULT_DELAY_MS + i * RESULT_STAGGER_MS}ms`,
  }) as React.CSSProperties;

interface RunResultProps {
  score: number;
  target: Target | null | undefined;
  passed: boolean;
  isNewBest: boolean;
  hasBest: boolean;
  myBest: number;
  myTowers: number;
}

/**
 * The end of a run, as a scene.
 *
 * The fall plays first and nothing covers it. Then the result comes in a line at a time: over
 * the tower the camera is pulling back to show, the score counting up from nothing, gold for a
 * new best with its own sound; under it, what the run did to whatever it was chasing. There is
 * no instruction: a tap after the fall moves on, and the board says what happens next.
 */
const RunResult: React.FC<RunResultProps> = ({
  score,
  target,
  passed,
  isNewBest,
  hasBest,
  myBest,
  myTowers,
}) => {
  const tally = useTally(score, RESULT_DELAY_MS + RESULT_STAGGER_MS, RESULT_TALLY_MS);

  // The result's own sound, as it arrives: the run is banked.
  React.useEffect(() => {
    const t = setTimeout(() => AudioPlayer.playResult(isNewBest), RESULT_DELAY_MS);
    return () => clearTimeout(t);
    // Once, as the result arrives; it does not change afterwards.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const chosen = target && !target.auto ? target : null;
  const short = target ? (target.score - score + 1).toLocaleString() : '';
  const outcome = ((): React.ReactNode => {
    if (!target || isOwnBest(target)) return null;
    if (target.kind === 'claim') return `Claiming ${cellOf(target)}`;
    if (target.own) {
      return passed
        ? `Replacing ${cellOf(target)}`
        : `Short of your ${target.score.toLocaleString()} by ${short}`;
    }
    if (!passed) {
      return (
        <>
          Short of <Name t={target} /> by {short}
        </>
      );
    }
    if (target.kind === 'take') {
      return chosen ? (
        <>
          Taking {cellOf(target)} from <Name t={target} />
        </>
      ) : (
        <>
          Past <Name t={target} />.
          <br />
          {cellOf(target)} is yours to take.
        </>
      );
    }
    return (
      <>
        Beat <Name t={target} /> on {target.score.toLocaleString()}
      </>
    );
  })();
  const raisingNow =
    chosen !== null && (chosen.kind === 'claim' || (chosen.kind === 'take' && passed));
  const badge = myTowers === 0 ? 'First tower' : isNewBest ? 'New best' : null;

  let i = 0;
  return (
    <div className="hud hud--over">
      <div className="hud-final">
        <div className="hud-final__head">
          {badge && (
            <span className="hud-final__line hud-final__badge" style={line(i++)}>
              {badge}
            </span>
          )}
          <span
            className={`hud-final__line hud-final__score${isNewBest ? ' hud-final__score--best' : ''}`}
            style={line(i++)}
          >
            {tally.toLocaleString()}
          </span>
          {!badge && hasBest && (
            <span className="hud-final__line hud-final__best" style={line(i++)}>
              Best {myBest.toLocaleString()}
            </span>
          )}
        </div>
        <div className="hud-final__foot">
          {outcome && (
            <span className="hud-final__line hud-final__rival" style={line(i++)}>
              {outcome}
            </span>
          )}
          {raisingNow && (
            <span className="hud-final__line hud-final__next" style={line(i++)}>
              Raising it now
            </span>
          )}
        </div>
      </div>
    </div>
  );
};

/**
 * What is on screen while a run is in progress, and the beat at the end of one.
 *
 * The score alone at the top, and under it the next bar to pass: a rival's, in their colour, or
 * the player's own best, in gold. Passing a rival puts the next one up there instead, with a
 * word and a sound, and the run scene rings the block that did it. Everything is
 * pointer-events: none, because every tap during a run is a block drop.
 *
 * The streak word sits just above the top of the tower, which is where the run camera holds it
 * and where the eyes already are: the name the streak has earned, bigger and warmer the longer
 * it runs.
 */
export const RunHud: React.FC<RunHudProps> = ({
  score,
  perfectCount,
  blockCount,
  over,
  target,
  ladder,
  passes,
  myBest,
  myTowers,
}) => {
  const shownScore = useCountUp(score);

  const [callout, setCallout] = React.useState<Callout | null>(null);
  const heldUntil = React.useRef(0);
  const say = React.useCallback((next: Omit<Callout, 'key'>) => {
    const now = performance.now();
    if (next.kind === 'streak' && now < heldUntil.current) return;
    if (next.kind !== 'streak') heldUntil.current = now + MILESTONE_HOLD_MS;
    setCallout((prev) => ({ ...next, key: (prev?.key ?? 0) + 1 }));
  }, []);

  // Each rival passed is said once, as it goes. The player's own best has its own milestone.
  const announced = React.useRef(0);
  React.useEffect(() => {
    for (let n = announced.current; n < passes.length; n++) {
      const p = passes[n];
      if (!p || p.own) continue;
      AudioPlayer.playMilestone('pass');
      say({ kind: 'pass', word: 'Passed', sub: { text: p.label, rgb: p.rgb }, tier: 0 });
    }
    announced.current = passes.length;
  }, [passes, say]);

  // The run mounts fresh each time, so a ref is enough to say this once per run.
  const hasBest = myBest > 0;
  const isNewBest = hasBest && score > myBest;
  const announcedBest = React.useRef(false);
  React.useEffect(() => {
    if (!isNewBest || announcedBest.current) return;
    announcedBest.current = true;
    AudioPlayer.playMilestone('best');
    say({ kind: 'best', word: 'New best', tier: 0 });
  }, [isNewBest, say]);

  React.useEffect(() => {
    const onPerfect = (e: Event) => {
      const detail = (e as CustomEvent<{ streak: number }>).detail;
      const streak = detail?.streak ?? 1;
      say({ kind: 'streak', word: streakName(streak), tier: streakTierIndex(streak) });
    };
    window.addEventListener('perfect-streak-advance', onPerfect);
    return () => window.removeEventListener('perfect-streak-advance', onPerfect);
  }, [say]);

  if (over) {
    const passed = target != null && target.score > 0 && score > target.score;
    return (
      <RunResult
        score={score}
        target={target}
        passed={passed}
        isNewBest={isNewBest}
        hasBest={hasBest}
        myBest={myBest}
        myTowers={myTowers}
      />
    );
  }

  // The next bar still ahead. A claim has no bar, so it names the cell instead.
  const next = ladder.find((r) => r.score > 0 && score <= r.score) ?? null;
  const claim = !next && target?.kind === 'claim' && !target.auto ? target : null;
  const look = callout ? calloutLook(callout) : null;

  return (
    <div className="hud">
      <div className={`hud-score${isNewBest ? ' hud-score--best' : ''}`}>
        <span key={score} className="hud-score__value ui-pop">
          {shownScore.toLocaleString()}
        </span>
        {next && (
          <span
            key={`${next.username ?? 'best'}-${next.score}`}
            className="hud-chase"
            style={rimOf(next)}
          >
            {next.own ? (
              <span className="hud-chase__word">{isOwnBest(next) ? 'Best' : 'Yours'}</span>
            ) : (
              <span className="hud-chase__who">u/{next.username}</span>
            )}
            <span className="hud-chase__n">{next.score.toLocaleString()}</span>
          </span>
        )}
        {claim && (
          <span className="hud-chase">
            <span className="hud-chase__word">Claim {cellOf(claim)}</span>
          </span>
        )}
      </div>

      {/*
        The first ten seconds.

        A player landing on this post has never seen it: one slab on an empty grid, a block
        sweeping over it, and previously not one word about what to do. Three words, low, near
        the thumb that has to act, and gone the moment they act -- not on a timer, because a
        hint that expires before it is read is worse than none. Blocks start at one, so this is
        showing exactly until the first drop lands.
      */}
      {blockCount <= 1 && (
        <div className="hud-teach">
          <span className="hud-teach__ring" aria-hidden="true" />
          <span className="hud-teach__word">Tap to drop</span>
        </div>
      )}

      {/* Second beat, once: name the thing worth aiming for, while it is still cheap to learn. */}
      {blockCount === 2 && perfectCount === 0 && (
        <div className="hud-teach hud-teach--quiet">
          <span className="hud-teach__word">Land it flush</span>
        </div>
      )}

      {callout && look && (
        <div
          key={callout.key}
          className={`hud-callout hud-callout--${look.tone}`}
          style={
            {
              ['--callout-scale' as string]: look.scale,
              // How many characters the word is, so the CSS can keep a long one inside the frame.
              ['--callout-chars' as string]: callout.word.length,
              ...(callout.sub?.rgb ? { ['--rim-rgb' as string]: callout.sub.rgb } : {}),
            } as React.CSSProperties
          }
          aria-live="polite"
        >
          <span className="hud-callout__word">{callout.word}</span>
          {callout.sub && <span className="hud-callout__sub">{callout.sub.text}</span>}
        </div>
      )}
    </div>
  );
};
