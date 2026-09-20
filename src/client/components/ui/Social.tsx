import React from 'react';
import type { BragKind, BragRecord } from '../../../shared/types/api';
import { factionRgb } from '../../../shared/types/factions';
import { cellName } from '../../../shared/types/worldGrid';
import type { Target } from '../../hooks/useSocial';
import { AudioPlayer } from '../audio/AudioPlayer';
import { Button } from './Chrome';
import { FactionDot } from './Factions';

/**
 * The two places the thread shows up inside the game.
 *
 * `ChatterStrip` is what other people have been saying, so the board is populated by names
 * rather than by anonymous geometry. `BragBar` is the one moment the game asks the player to say
 * something back, and it appears once, straight after a tower is raised, because that is the
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
  onChallenge: (target: Target) => void;
}

const verbOf = (b: BragRecord): string | null => {
  switch (b.kind) {
    case 'passed':
      return b.passedUsername ? `passed u/${b.passedUsername}` : null;
    case 'took':
      return b.passedUsername
        ? `took ${b.cell ? cellName(b.cell.x, b.cell.z) : 'land'} from u/${b.passedUsername}`
        : 'took land';
    case 'claimed':
      return b.cell ? `claimed ${cellName(b.cell.x, b.cell.z)}` : 'claimed land';
    case 'best':
      return 'new best';
    case 'first':
      return 'first tower';
    case 'fell':
      return `fell at ${b.blocks}`;
    default:
      return null;
  }
};

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
  const verb = verbOf(b);

  return (
    <button
      type="button"
      key={`${b.commentId}-${i}`}
      className="chatter"
      style={{ ['--rim-rgb' as string]: factionRgb(b.faction) }}
      onClick={() => {
        AudioPlayer.unlock();
        AudioPlayer.playTap(1.15);
        onChallenge({ kind: 'beat', username: b.username, score: b.score });
      }}
      title={`Beat u/${b.username}`}
    >
      <span className="chatter__who">
        <FactionDot faction={b.faction} size={6} />
        u/{b.username}
      </span>
      <span className="chatter__score">{b.score.toLocaleString()}</span>
      {verb && <span className="chatter__verb">{verb}</span>}
      <span className="chatter__when">{ago(b.timestamp)}</span>
    </button>
  );
};

export interface PlacedRun {
  sessionId: string;
  score: number;
  blocks: number;
  perfectStreak: number;
  /** Set when the run beat the score the player was chasing. */
  passed?: { username: string; score: number } | undefined;
  /** Set when the tower took a cell from somebody else. */
  took?: { username: string; score: number } | undefined;
  /** The cell it stands on, when it stands on land. */
  cell?: { x: number; z: number } | undefined;
  /** Set when the run beat everything else the player has standing. */
  isBest: boolean;
  /** Set when this is the first tower they have raised. */
  isFirst: boolean;
}

/** Which of the fixed phrasings a raised run has earned. Naming somebody wins. */
export const bragKindFor = (run: PlacedRun): BragKind =>
  run.took
    ? 'took'
    : run.passed
      ? 'passed'
      : run.cell
        ? 'claimed'
        : run.isFirst
          ? 'first'
          : run.isBest
            ? 'best'
            : 'plain';

interface BragBarProps {
  run: PlacedRun;
  isPosting: boolean;
  onBrag: (kind: BragKind) => void;
  onDismiss: () => void;
}

/**
 * The ask, once, right after a tower is raised.
 *
 * Named buttons rather than a text box. The player picks which true thing to say and the server
 * writes the sentence, so there is no free text to moderate and no way to use the game to send
 * somebody an insult. That constraint is what makes it safe to put a Reddit mention behind a
 * button at all. While it is up it is the only primary on the screen.
 */
export const BragBar: React.FC<BragBarProps> = ({ run, isPosting, onBrag, onDismiss }) => {
  const kind = bragKindFor(run);
  const label =
    kind === 'took'
      ? `Tell u/${run.took!.username}`
      : kind === 'passed'
        ? `Tell u/${run.passed!.username}`
        : kind === 'claimed'
          ? 'Post the claim'
          : kind === 'first'
            ? 'Post your first tower'
            : kind === 'best'
              ? 'Post your new best'
              : 'Post it';

  return (
    <div className="brag" role="group" aria-label="Share this run">
      <Button onClick={() => onBrag(kind)} disabled={isPosting}>
        {isPosting ? 'Posting' : label}
      </Button>
      <Button variant="ghost" onClick={onDismiss} disabled={isPosting}>
        Not now
      </Button>
    </div>
  );
};
