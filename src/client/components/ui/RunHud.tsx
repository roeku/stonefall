import React from 'react';
import { streakName } from '../../constants/streakTiers';
import { Readout, Stat, StatRow } from './Chrome';
import { BlocksIcon, HeightIcon, SparkIcon } from './icons';
import type { Rival } from '../../hooks/useSocial';

interface RunHudProps {
  score: number;
  /** Consecutive non-breaking placements. 0 or 1 means there is no streak to show. */
  combo: number;
  perfectCount: number;
  blockCount: number;
  /** The run has ended; hold on the result before the board takes over. */
  over: boolean;
  /** Whose score this run is chasing, if the player tapped a tower to challenge it. */
  rival?: Rival | null | undefined;
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

/**
 * Readout shown while a run is in progress, and the beat at the end of one.
 *
 * Type only, pinned to a corner, out of the way of the tower. Everything is pointer-events:
 * none -- every tap during a run is a block drop and the HUD must never eat one.
 *
 * The loud feedback is the perfect callout: the tier name the streak has earned, big and
 * centred for a moment. The game scene already knew the tier; it just never said it.
 */
export const RunHud: React.FC<RunHudProps> = ({
  score,
  combo,
  perfectCount,
  blockCount,
  over,
  rival,
}) => {
  const shownScore = useCountUp(score);
  // Combo counts from 1 for a single placement, so a streak only exists from 2 upward.
  const hasCombo = combo > 1;

  const [callout, setCallout] = React.useState<Callout | null>(null);
  const [lost, setLost] = React.useState(0);

  /**
   * Passing the rival is the loudest moment in the run, so it gets its own callout and it fires
   * the instant it happens rather than waiting for the results screen. A best beaten after the
   * fact is a statistic; a best beaten in front of you is the reason to keep playing.
   */
  const passed = rival != null && score > rival.score;
  const announcedPass = React.useRef(false);
  React.useEffect(() => {
    if (!passed || announcedPass.current) return;
    announcedPass.current = true;
    setCallout((prev) => ({
      key: (prev?.key ?? 0) + 1,
      word: `Passed u/${rival!.username}`,
      streak: 0,
    }));
  }, [passed, rival]);
  React.useEffect(() => {
    announcedPass.current = false;
  }, [rival]);
  React.useEffect(() => {
    const onPerfect = (e: Event) => {
      const detail = (e as CustomEvent<{ streak: number }>).detail;
      const streak = detail?.streak ?? 1;
      setCallout((prev) => ({ key: (prev?.key ?? 0) + 1, word: streakName(streak), streak }));
    };
    const onMiss = () => setLost((n) => n + 1);
    window.addEventListener('perfect-streak-advance', onPerfect);
    window.addEventListener('imperfect-streak-advance', onMiss);
    return () => {
      window.removeEventListener('perfect-streak-advance', onPerfect);
      window.removeEventListener('imperfect-streak-advance', onMiss);
    };
  }, []);

  if (over) {
    return (
      <div className="hud hud--over">
        <div className="hud-final">
          <Readout label="Tower complete" value={score.toLocaleString()} size="large" />
          <StatRow>
            <Stat icon={<BlocksIcon />} value={blockCount.toLocaleString()} title="Blocks" />
            {perfectCount > 0 && (
              <Stat
                icon={<SparkIcon />}
                value={perfectCount.toLocaleString()}
                title="Perfect placements"
                tone="good"
              />
            )}
          </StatRow>
          {rival && (
            <span className={`hud-final__rival${passed ? ' hud-final__rival--passed' : ''}`}>
              {passed
                ? `Beat u/${rival.username} on ${rival.score.toLocaleString()}`
                : `u/${rival.username} still ahead on ${rival.score.toLocaleString()}`}
            </span>
          )}
          <span className="hud-final__next">Now choose where it stands</span>
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
        />
        <StatRow>
          <Stat icon={<HeightIcon />} value={blockCount.toLocaleString()} title="Blocks stacked" />
          {perfectCount > 0 && (
            <Stat
              icon={<SparkIcon />}
              value={perfectCount.toLocaleString()}
              title="Perfect placements"
              tone="good"
            />
          )}
          {hasCombo && (
            <Stat value={<>{combo}&times;</>} title="Combo" tone="warm" popKey={combo} />
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

      {rival && !over && (
        <div className={`hud-target${passed ? ' hud-target--passed' : ''}`}>
          <span className="hud-target__who">u/{rival.username}</span>
          <span className="hud-target__score">{rival.score.toLocaleString()}</span>
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
