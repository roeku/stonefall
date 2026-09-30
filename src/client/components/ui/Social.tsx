import React from 'react';
import type { BragRecord } from '../../../shared/types/api';
import { commentPreview, type ScoreComment } from '../../../shared/social/comments';
import { factionRgb, type FactionId } from '../../../shared/types/factions';
import { cellName } from '../../../shared/types/worldGrid';
import type { Target } from '../../hooks/useSocial';
import { AudioPlayer } from '../audio/AudioPlayer';
import { Button } from './Chrome';

/**
 * The two places the thread shows up inside the game.
 *
 * `ChatterStrip` is what other people have been saying, so the board is populated by names
 * rather than by anonymous geometry. `CommentOffer` is the one moment the game asks the player to
 * say something back, and it appears once, straight after a tower is raised, because that is the
 * only second where a person actually wants to.
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

interface CommentOfferProps {
  /** Exactly what will be posted. */
  comment: ScoreComment;
  /** The colour of the person the comment names, so their name is set in it. */
  nameFaction?: FactionId | null | undefined;
  /** The account it will be posted from. */
  username: string | null;
  isPosting: boolean;
  /** Post the line as it stands. Given the trusted click, which Reddit's consent check needs. */
  onPost: (event: Event) => void;
  /** Open Reddit's form on the line, to put it in the player's own words. Given the click too. */
  onWrite: (event: Event) => void;
}

/**
 * The offer to say something, once, after a raise worth telling people about.
 *
 * It is the comment itself: the one line the game would post, quoted word for word, and two
 * words under it. Post sends that line from the player's account in one tap; Write your own
 * opens it in Reddit's form, where whatever they add makes it their own comment in the thread.
 *
 * It used to be a link that opened a confirmation, which quoted a paragraph and offered Edit,
 * which opened the form: three taps and a read before anything happened. Devvit's rules ask that
 * the player sees the exact text and whose account it goes from before it is sent, and a quote
 * over a button saying "Post as u/name" is that, so the separate confirmation is gone.
 *
 * The game still writes the sentence from the true things the run did, so there is no free text
 * inside the game to moderate and no way to use it to send somebody an insult; a player's own
 * words only ever go through Reddit's form, as a comment of theirs. Nothing is posted until one
 * of the two words is tapped, and the offer goes away with the next run.
 */
export const CommentOffer: React.FC<CommentOfferProps> = ({
  comment,
  nameFaction,
  username,
  isPosting,
  onPost,
  onWrite,
}) => {
  const text = commentPreview(comment);
  const name = comment.passedUsername ? `u/${comment.passedUsername}` : null;
  const at = name ? text.indexOf(name) : -1;
  return (
    <div className="brag brag--offer" role="group" aria-label="Comment on this run">
      <span className="brag__quote">
        &ldquo;
        {name && at >= 0 ? (
          <>
            {text.slice(0, at)}
            <span
              className="ui-name"
              style={nameFaction ? { ['--rim-rgb' as string]: factionRgb(nameFaction) } : undefined}
            >
              {name}
            </span>
            {text.slice(at + name.length)}
          </>
        ) : (
          text
        )}
        &rdquo;
      </span>
      <div className="brag__row">
        <Button variant="link" onClick={(e) => onPost(e.nativeEvent)} disabled={isPosting}>
          {isPosting ? 'Posting' : username ? `Post as u/${username}` : 'Post it'}
        </Button>
        <Button variant="link" onClick={(e) => onWrite(e.nativeEvent)} disabled={isPosting}>
          Write your own
        </Button>
      </div>
    </div>
  );
};
