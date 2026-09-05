import React from 'react';
import { streakName } from '../../constants/streakTiers';
import { ArtChip, ArtPanel, BlocksIcon, HeightIcon, SparkIcon } from './tron/TronArt';

interface RunHudProps {
  score: number;
  /** Consecutive non-breaking placements. 0 or 1 means there is no streak to show. */
  combo: number;
  perfectCount: number;
  blockCount: number;
  /** The run has ended; hold on the result before the board takes over. */
  over: boolean;
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
  const fromRef = React.useRef(value);
  const shownRef = React.useRef(value);
  React.useEffect(() => {
    const from = shownRef.current;
    fromRef.current = from;
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
 * Built from the same artwork as the board's chrome, deliberately: the two sides of the
 * transition are one game. Everything here is pointer-events: none -- every tap during a run is
 * a block drop and the HUD must never eat one.
 *
 * Feedback comes from the game scene's own events. It already knew when a placement was perfect
 * and what tier the streak had reached, and told nobody; the HUD was a static number.
 */
export const RunHud: React.FC<RunHudProps> = ({ score, combo, perfectCount, blockCount, over }) => {
  const shownScore = useCountUp(score);
  // Combo counts from 1 for a single placement, so a streak only exists from 2 upward.
  const hasCombo = combo > 1;

  const [callout, setCallout] = React.useState<Callout | null>(null);
  const [lost, setLost] = React.useState(0);
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
          <ArtPanel className="tron-status hud-final__panel">
            <span className="tron-status__title">Tower complete</span>
            <span className="tron-status__value hud-final__score">{score.toLocaleString()}</span>
          </ArtPanel>
          <div className="hud-chips">
            <ArtChip className="tron-chip" title="Blocks stacked">
              <BlocksIcon />
              <span className="tron-chip__value">{blockCount.toLocaleString()}</span>
            </ArtChip>
            {perfectCount > 0 && (
              <ArtChip className="tron-chip tron-chip--perfect" title="Perfect placements">
                <SparkIcon />
                <span className="tron-chip__value">{perfectCount.toLocaleString()}</span>
              </ArtChip>
            )}
          </div>
          <span className="hud-final__next">Now choose where it stands</span>
        </div>
      </div>
    );
  }

  return (
    <div className="hud">
      <div className="hud-top">
        <ArtPanel className="tron-status hud-score">
          <span className="tron-status__title">Score</span>
          <span className="tron-status__value">{shownScore.toLocaleString()}</span>
        </ArtPanel>
        <div className="hud-chips">
          <ArtChip className="tron-chip" title="Blocks stacked">
            <HeightIcon />
            <span className="tron-chip__value">{blockCount.toLocaleString()}</span>
          </ArtChip>
          {perfectCount > 0 && (
            <ArtChip className="tron-chip tron-chip--perfect" title="Perfect placements">
              <SparkIcon />
              <span className="tron-chip__value">{perfectCount.toLocaleString()}</span>
            </ArtChip>
          )}
          {hasCombo && (
            // Keyed on the value so every step re-runs the pop.
            <div key={`combo-${combo}`} className="hud-pop">
              <ArtChip className="tron-chip tron-chip--combo" title="Combo">
                <span className="tron-chip__value">{combo}&times;</span>
              </ArtChip>
            </div>
          )}
          {!hasCombo && lost > 0 && (
            <div key={`lost-${lost}`} className="hud-lost" aria-hidden="true">
              <ArtChip className="tron-chip tron-chip--lost" title="Streak lost">
                <span className="tron-chip__value">&times;</span>
              </ArtChip>
            </div>
          )}
        </div>
      </div>

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
