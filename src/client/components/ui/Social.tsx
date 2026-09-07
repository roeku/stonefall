import React from 'react';
import type { BragKind, BragRecord } from '../../../shared/types/api';
import type { Rival } from '../../hooks/useSocial';
import { Button } from './Chrome';

/**
 * The two places the thread shows up inside the game.
 *
 * `ChatterStrip` is what other people have been saying, so the board is populated by names
 * rather than by anonymous geometry. `BragBar` is the one moment the game asks the player to say
 * something back, and it appears once, straight after a tower is placed, because that is the
 * only second where a person actually wants to.
 */

/** A short, non-precious relative time. Nothing here is worth a date. */
const ago = (ts: number): string => {
  const s = Math.max(0, Math.floor((Date.now() - ts) / 1000));
  if (s < 60) return 'just now';
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h`;
  return `${Math.floor(h / 24)}d`;
};

interface ChatterStripProps {
  brags: ReadonlyArray<BragRecord>;
  /** Take a name from the strip straight into a run. */
  onChallenge: (rival: Rival) => void;
}

/**
 * The last few runs anyone announced, as a single line that cycles.
 *
 * One line rather than a list because there is no room for a list in a Reddit inline post and
 * because a feed nobody scrolls is worse than a headline everyone reads. Tapping it takes the
 * name into a run, so the strip is an entry point and not decoration.
 */
export const ChatterStrip: React.FC<ChatterStripProps> = ({ brags, onChallenge }) => {
  const [i, setI] = React.useState(0);
  React.useEffect(() => {
    if (brags.length < 2) return;
    const t = setInterval(() => setI((n) => (n + 1) % brags.length), 4200);
    return () => clearInterval(t);
  }, [brags.length]);
  React.useEffect(() => {
    if (i >= brags.length) setI(0);
  }, [brags.length, i]);

  const b = brags[i % Math.max(1, brags.length)];
  if (!b) return null;

  return (
    <button
      type="button"
      key={`${b.commentId}-${i}`}
      className="chatter"
      onClick={() => onChallenge({ username: b.username, score: b.score })}
      title={`Beat u/${b.username}`}
    >
      <span className="chatter__who">u/{b.username}</span>
      <span className="chatter__score">{b.score.toLocaleString()}</span>
      {b.passedUsername && <span className="chatter__verb">passed u/{b.passedUsername}</span>}
      <span className="chatter__when">{ago(b.timestamp)}</span>
    </button>
  );
};

export interface PlacedRun {
  sessionId: string;
  score: number;
  blocks: number;
  perfectStreak: number;
  /** Set when the run beat the tower the player was chasing. */
  passed?: Rival | undefined;
  /** Set when the run beat everything else on the player's own plot. */
  isBest: boolean;
  /** Set when this is the first tower on the plot. */
  isFirst: boolean;
}

interface BragBarProps {
  run: PlacedRun;
  isPosting: boolean;
  onBrag: (kind: BragKind) => void;
  onDismiss: () => void;
}

/**
 * The ask, once, right after placement.
 *
 * Named buttons rather than a text box. The player picks which true thing to say and the server
 * writes the sentence, so there is no free text to moderate and no way to use the game to send
 * somebody an insult. That constraint is what makes it safe to put a Reddit mention behind a
 * button at all.
 */
export const BragBar: React.FC<BragBarProps> = ({ run, isPosting, onBrag, onDismiss }) => {
  const kind: BragKind = run.passed ? 'passed' : run.isFirst ? 'first' : run.isBest ? 'best' : 'plain';
  const label = run.passed
    ? `Tell u/${run.passed.username}`
    : run.isFirst
      ? 'Post your first tower'
      : run.isBest
        ? 'Post your new best'
        : 'Post this run';

  return (
    <div className="brag" role="group" aria-label="Share this run">
      <Button onClick={() => onBrag(kind)} disabled={isPosting}>
        {isPosting ? 'Posting…' : label}
      </Button>
      <Button variant="ghost" onClick={onDismiss} disabled={isPosting}>
        Not now
      </Button>
    </div>
  );
};
