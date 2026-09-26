import React from 'react';
import type { BragRecord } from '../../../shared/types/api';
import { commentPreview, type ScoreComment } from '../../../shared/social/comments';
import { factionRgb } from '../../../shared/types/factions';
import { cellName } from '../../../shared/types/worldGrid';
import type { Target } from '../../hooks/useSocial';
import { AudioPlayer } from '../audio/AudioPlayer';
import { Button } from './Chrome';
import { bragKindFor, type PlacedRun } from './placedRun';

/**
 * The two places the thread shows up inside the game.
 *
 * `ChatterStrip` is what other people have been saying, so the board is populated by names
 * rather than by anonymous geometry. `BragChip` is the one moment the game asks the player to say
 * something back, and it appears once, straight after a tower is raised, because that is the
 * only second where a person actually wants to. `CommentConfirm` is the yes it needs.
 */

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
 * The last few runs anyone announced, as a single line that cycles: the name in its owner's
 * colour, the score, what they did.
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
      <span className="chatter__who">u/{b.username}</span>
      <span className="chatter__score">{b.score.toLocaleString()}</span>
      {verb && <span className="chatter__verb">{verb}</span>}
    </button>
  );
};

interface BragChipProps {
  run: PlacedRun;
  /** Open the confirmation. Nothing is posted from here. */
  onOpen: () => void;
}

/**
 * What the offer says: the true thing the run did, in the fewest words, and that saying it is a
 * comment. Naming somebody wins, and the name is set in their colour.
 */
const bragLabel = (run: PlacedRun): React.ReactNode => {
  const kind = bragKindFor(run);
  const who = kind === 'took' ? run.took : kind === 'passed' ? run.passed : null;
  if (who) {
    return (
      <>
        Tell{' '}
        <span
          className="ui-name"
          style={who.faction ? { ['--rim-rgb' as string]: factionRgb(who.faction) } : undefined}
        >
          u/{who.username}
        </span>{' '}
        in the comments
      </>
    );
  }
  return kind === 'claimed'
    ? 'Comment your claim'
    : kind === 'first'
      ? 'Comment your first tower'
      : kind === 'best'
        ? 'Comment your new best'
        : 'Comment this run';
};

/**
 * The offer to say something, once, after a raise worth telling people about.
 *
 * Named buttons rather than a text box. The player picks which true thing to say and the server
 * writes the sentence, so there is no free text to moderate and no way to use the game to send
 * somebody an insult. That constraint is what makes it safe to put a Reddit mention behind a
 * button at all.
 *
 * One underlined line, not a button: it sits above Build and goes away with the next run, so
 * saying something is always optional and never stands between the player and playing again.
 * It opens `CommentConfirm`; it never posts by itself.
 */
export const BragChip: React.FC<BragChipProps> = ({ run, onOpen }) => (
  <div className="brag" role="group" aria-label="Share this run">
    <Button variant="link" onClick={onOpen}>
      {bragLabel(run)}
    </Button>
  </div>
);

interface CommentConfirmProps {
  /** Exactly what will be posted. */
  comment: ScoreComment;
  /** The account it will be posted from. */
  username: string | null;
  isPosting: boolean;
  /** Post it. Given the trusted click, which Reddit's own consent check needs. */
  onConfirm: (event: Event) => void;
  /** Open the comment to edit it first (`utils/platform.ts` editComment). Given the click too. */
  onEdit: (event: Event) => void;
  onCancel: () => void;
}

/**
 * The yes a comment needs.
 *
 * Devvit's rules for acting as a player: they must see what will appear on Reddit, know it goes
 * out under their own name, and confirm it themselves. So the offer only ever opens this, which
 * quotes the comment word for word, says whose account it comes from and where it goes, and
 * offers the way out as plainly as the way on.
 *
 * Edit opens the comment in Reddit's own form, where the player can put it in their own words;
 * words of their own make it a comment of theirs in the thread rather than a reply under Scores.
 */
export const CommentConfirm: React.FC<CommentConfirmProps> = ({
  comment,
  username,
  isPosting,
  onConfirm,
  onEdit,
  onCancel,
}) => (
  <div className="ui-switch ui-comment" role="alertdialog" aria-label="Post a comment">
    <span className="ui-switch__title">Post a comment?</span>
    <span className="ui-comment__text">&ldquo;{commentPreview(comment)}&rdquo;</span>
    <span className="ui-comment__note">
      From {username ? `u/${username}` : 'your account'}, as a reply under the pinned scores
      comment.
    </span>
    <Button onClick={(e) => onConfirm(e.nativeEvent)} disabled={isPosting}>
      {isPosting ? 'Posting' : 'Post comment'}
    </Button>
    <div className="ui-comment__row">
      <Button variant="ghost" onClick={(e) => onEdit(e.nativeEvent)} disabled={isPosting}>
        Edit
      </Button>
      <Button variant="ghost" onClick={onCancel} disabled={isPosting}>
        Cancel
      </Button>
    </div>
  </div>
);
