import React from 'react';
import { cellName } from '../../../shared/types/worldGrid';
import { streakName } from '../../constants/streakTiers';
import { AudioPlayer } from '../audio/AudioPlayer';
import { Readout, Stat, StatRow } from './Chrome';
import { HeightIcon, SparkIcon } from './icons';
import type { Target } from '../../hooks/useSocial';

interface RunHudProps {
  score: number;
  /** Consecutive non-breaking placements. 0 or 1 means there is no chain to show. */
  combo: number;
  perfectCount: number;
  blockCount: number;
  /** The run has ended; hold on the result before the board takes over. */
  over: boolean;
  /** What this run is aimed at, if anything. */
  target?: Target | null | undefined;
  /** The player's best standing tower, so a run can be measured against it as it happens. */
  myBest: number;
  /** How many towers the player has standing. Zero makes this their first. */
  myTowers: number;
  /** Where this score would stand on the map, once the run is over. */
  rank: { n: number; of: number } | null;
}

interface Callout {
  key: number;
  word: string;
  streak: number;
}

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

const cellOf = (t: Target): string => (t.cell ? cellName(t.cell.x, t.cell.z) : '');

/**
 * Readout shown while a run is in progress, and the beat at the end of one.
 *
 * Type only, pinned to a corner, out of the way of the tower. Everything is pointer-events:
 * none -- every tap during a run is a block drop and the HUD must never eat one.
 *
 * The loud feedback is the perfect callout: the tier name the streak has earned, big and
 * centred for a moment. Passing a rival's bar, or your own best, gets the same treatment the
 * instant it happens: a best beaten in front of you is the reason to keep playing.
 */
export const RunHud: React.FC<RunHudProps> = ({
  score,
  combo,
  perfectCount,
  blockCount,
  over,
  target,
  myBest,
  myTowers,
  rank,
}) => {
  const shownScore = useCountUp(score);
  // Combo counts from 1 for a single placement, so a chain only exists from 2 upward.
  const hasCombo = combo > 1;

  const [callout, setCallout] = React.useState<Callout | null>(null);
  const [lost, setLost] = React.useState(0);
  const say = React.useCallback((word: string, streak = 0) => {
    setCallout((prev) => ({ key: (prev?.key ?? 0) + 1, word, streak }));
  }, []);

  const hasBar = target != null && target.score > 0;
  const passed = hasBar && score > target.score;
  const announcedPass = React.useRef(false);
  React.useEffect(() => {
    if (!passed || announcedPass.current || !target) return;
    announcedPass.current = true;
    AudioPlayer.playChime(0.22, 1180);
    say(
      target.own ? 'Past your bar' : target.username ? `Past u/${target.username}` : 'Past the bar'
    );
  }, [passed, target, say]);
  React.useEffect(() => {
    announcedPass.current = false;
  }, [target]);

  // The run mounts fresh each time, so a ref is enough to say this once per run.
  const hasBest = myBest > 0;
  const isNewBest = hasBest && score > myBest;
  const announcedBest = React.useRef(false);
  React.useEffect(() => {
    if (!isNewBest || announcedBest.current) return;
    announcedBest.current = true;
    AudioPlayer.playChime(0.22, 1320);
    say('New best');
  }, [isNewBest, say]);

  React.useEffect(() => {
    const onPerfect = (e: Event) => {
      const detail = (e as CustomEvent<{ streak: number }>).detail;
      const streak = detail?.streak ?? 1;
      say(streakName(streak), streak);
    };
    const onMiss = () => setLost((n) => n + 1);
    window.addEventListener('perfect-streak-advance', onPerfect);
    window.addEventListener('imperfect-streak-advance', onMiss);
    return () => {
      window.removeEventListener('perfect-streak-advance', onPerfect);
      window.removeEventListener('imperfect-streak-advance', onMiss);
    };
  }, [say]);

  if (over) {
    const short = target ? (target.score - score + 1).toLocaleString() : '';
    const outcome = !target
      ? null
      : target.kind === 'claim'
        ? `Claiming ${cellOf(target)}`
        : target.own
          ? passed
            ? `Replacing ${cellOf(target)}`
            : `Short of your ${target.score.toLocaleString()} by ${short}`
          : passed
            ? target.kind === 'take'
              ? `Taking ${cellOf(target)} from u/${target.username}`
              : `Beat u/${target.username} on ${target.score.toLocaleString()}`
            : `Short of u/${target.username} by ${short}`;
    const raisingNow =
      target !== null &&
      target !== undefined &&
      (target.kind === 'claim' || (target.kind === 'take' && passed));
    return (
      <div className="hud hud--over">
        <div className="hud-final">
          <Readout
            label={`Fell at ${blockCount.toLocaleString()}`}
            value={score.toLocaleString()}
            size="large"
            tone={isNewBest ? 'good' : 'default'}
          />
          <StatRow>
            {perfectCount > 0 && (
              <Stat
                icon={<SparkIcon />}
                value={perfectCount.toLocaleString()}
                title="Perfects"
                tone="good"
              />
            )}
            {myTowers === 0 && <Stat value="First tower" title="Your first tower" tone="best" />}
            {myTowers > 0 && hasBest && isNewBest && (
              <Stat value="New best" title="Your best tower yet" tone="best" />
            )}
            {myTowers > 0 && hasBest && !isNewBest && (
              <Stat value={`Best ${myBest.toLocaleString()}`} title="Your best standing tower" />
            )}
            {rank && rank.of > 1 && (
              <Stat
                value={`#${rank.n.toLocaleString()} of ${rank.of.toLocaleString()}`}
                title="Where it would stand on the map"
              />
            )}
          </StatRow>
          {outcome && (
            <span
              className={`hud-final__rival${passed || target?.kind === 'claim' ? ' hud-final__rival--passed' : ''}`}
            >
              {outcome}
            </span>
          )}
          <span className="hud-final__next">
            {raisingNow ? 'Raising it now' : 'Tap to raise it'}
          </span>
        </div>
      </div>
    );
  }

  return (
    <div className="hud">
      <div className="hud-top">
        <Readout
          label="Score"
          value={
            <span key={score} className="ui-pop">
              {shownScore.toLocaleString()}
            </span>
          }
          size="large"
          tone={isNewBest ? 'good' : 'default'}
        />
        <StatRow>
          <Stat icon={<HeightIcon />} value={blockCount.toLocaleString()} title="Blocks" />
          {perfectCount > 0 && (
            <Stat
              icon={<SparkIcon />}
              value={perfectCount.toLocaleString()}
              title="Perfects"
              tone="good"
            />
          )}
          {hasCombo && (
            <Stat value={<>{combo}&times;</>} title="Chain" tone="warm" popKey={combo} />
          )}
          {!hasCombo && lost > 0 && (
            <span key={`lost-${lost}`} className="hud-lost" aria-hidden="true">
              &times;
            </span>
          )}
        </StatRow>
      </div>

      {/*
        The first ten seconds.

        A player landing on this post has never seen it: one slab on an empty grid, a block
        sweeping over it, and previously not one word about what to do. Three words, low, near
        the thumb that has to act, and gone the moment they act -- not on a timer, because a
        hint that expires before it is read is worse than none. Blocks start at one, so this is
        showing exactly until the first drop lands.
      */}
      {!over && blockCount <= 1 && (
        <div className="hud-teach">
          <span className="hud-teach__ring" aria-hidden="true" />
          <span className="hud-teach__word">Tap to drop</span>
        </div>
      )}

      {/* Second beat, once: name the thing worth aiming for, while it is still cheap to learn. */}
      {!over && blockCount === 2 && perfectCount === 0 && (
        <div className="hud-teach hud-teach--quiet">
          <span className="hud-teach__word">Land it flush to keep the width</span>
        </div>
      )}

      {target && !over && (
        <div className={`hud-target${passed ? ' hud-target--passed' : ''}`}>
          {target.kind !== 'beat' && (
            <span className="hud-target__what">
              {target.kind === 'claim' ? 'Claim' : target.own ? 'Replace' : 'Take'} {cellOf(target)}
            </span>
          )}
          {(target.own || target.username) && (
            <span className="hud-target__who">
              {target.own ? 'Your tower' : `u/${target.username}`}
            </span>
          )}
          {hasBar && <span className="hud-target__score">{target.score.toLocaleString()}</span>}
        </div>
      )}

      {callout && (
        <div key={callout.key} className="hud-callout" aria-live="polite">
          <span className="hud-callout__word">{callout.word}</span>
          {callout.streak > 1 && (
            <span className="hud-callout__streak">{callout.streak} in a row</span>
          )}
        </div>
      )}
    </div>
  );
};
