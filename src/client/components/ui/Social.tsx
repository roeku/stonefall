import React from 'react';
import type { BragRecord } from '../../../shared/types/api';
import { NOTE_MAX, commentPreview, type ScoreComment } from '../../../shared/social/comments';
import { factionRgb, type FactionId } from '../../../shared/types/factions';
import { cellName } from '../../../shared/types/worldGrid';
import { AudioPlayer } from '../audio/AudioPlayer';
import { Button } from './Chrome';
import { StoneChip } from './Stones';
import type { StoneId } from '../../../shared/social/stones';

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
  /** Go to the tower the line is about. */
  onFind: (brag: BragRecord) => void;
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
 * because a feed nobody scrolls is worse than a headline everyone reads. Tapping it goes to the
 * tower the line is about, whose card offers the run against it, so the strip is an entry point
 * and not decoration.
 */
export const ChatterStrip: React.FC<ChatterStripProps> = ({ brags, onFind }) => {
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
        onFind(b);
      }}
      title={`Find u/${b.username}'s tower`}
    >
      <span className="chatter__who">u/{b.username}</span>
      <span className="chatter__score">{b.score.toLocaleString()}</span>
      {verb && <span className="chatter__verb">{verb}</span>}
    </button>
  );
};

interface CommentOfferProps {
  /** The game's line, exactly as it is posted. */
  comment: ScoreComment;
  /** The colour of the person the comment names, so their name is set in it. */
  nameFaction?: FactionId | null | undefined;
  /** The account it will be posted from. */
  username: string | null;
  isPosting: boolean;
  /**
   * Post it: the game's line alone, or the player's words with the line under them. Given the
   * trusted tap or submit, which Reddit's consent check needs.
   */
  onPost: (event: Event, note?: string) => void;
  /** What posting will do for the player's stones, if anything, with the stone it is about. */
  reward?: { text: string; stone: StoneId } | null | undefined;
  /** The player's colour, for the stone chip. */
  faction?: FactionId | null | undefined;
}

/** The line under the quote saying what the post will do for the player's stones. */
const Reward: React.FC<{ text: string; stone: StoneId; faction: FactionId | null | undefined }> = ({
  text,
  stone,
  faction,
}) => (
  <span className="brag__reward">
    <StoneChip stone={stone} faction={faction} size={12} />
    {text}
  </span>
);

/** The game's line, quoted, with the name in it set in its owner's colour. */
const QuotedLine: React.FC<{
  text: string;
  name: string | null;
  nameFaction?: FactionId | null | undefined;
}> = ({ text, name, nameFaction }) => {
  const at = name ? text.indexOf(name) : -1;
  if (!name || at < 0) return <>{text}</>;
  return (
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
  );
};

/**
 * The offer to say something, once, after a raise worth telling people about.
 *
 * It is the comment itself: the one line the game would post, quoted word for word, with Post
 * and Write your own under it. Post sends the line from the player's account in one tap. Write
 * your own opens a box right here, in the game, with the line under it as it will sit under their
 * words; whatever they write goes above the line, as their own comment in the thread. The line is
 * always posted: the player adds to it and cannot edit it away (`commentToPost`).
 *
 * Devvit's rules ask that the player sees what will appear and whose account it comes from before
 * it is sent, which the quote and "Post as u/name" are. Nothing is posted until Post is tapped,
 * and the offer goes away with the next run. What they write is never kept or shown in the game.
 *
 * Inline, the documented rule is taps and clicks only; the box is a deliberate exception the
 * player opens themselves, bounded to the offer, and it takes nothing from the feed's scrolling.
 */
export const CommentOffer: React.FC<CommentOfferProps> = ({
  comment,
  nameFaction,
  username,
  isPosting,
  onPost,
  reward,
  faction,
}) => {
  const [writing, setWriting] = React.useState(false);
  const [note, setNote] = React.useState('');
  const text = commentPreview(comment);
  const name = comment.passedUsername ? `u/${comment.passedUsername}` : null;
  const postLabel = isPosting ? 'Posting' : username ? `Post as u/${username}` : 'Post it';

  if (!writing) {
    return (
      <div className="brag brag--offer" role="group" aria-label="Comment on this run">
        <span className="brag__quote">
          &ldquo;
          <QuotedLine text={text} name={name} nameFaction={nameFaction} />
          &rdquo;
        </span>
        {reward && <Reward text={reward.text} stone={reward.stone} faction={faction} />}
        <div className="brag__row">
          <Button variant="link" onClick={(e) => onPost(e.nativeEvent)} disabled={isPosting}>
            {postLabel}
          </Button>
          <Button variant="link" onClick={() => setWriting(true)} disabled={isPosting}>
            Write your own
          </Button>
        </div>
      </div>
    );
  }

  return (
    <form
      className="brag brag--offer brag--writing"
      aria-label="Write your comment"
      onSubmit={(e) => {
        e.preventDefault();
        if (!isPosting) onPost(e.nativeEvent, note);
      }}
    >
      <input
        className="brag__input"
        type="text"
        value={note}
        onChange={(e) => setNote(e.target.value)}
        maxLength={NOTE_MAX}
        placeholder="Say something"
        aria-label="Your words, above the game's line"
        enterKeyHint="send"
        autoComplete="off"
        // Opened by a tap on Write your own, so the keyboard comes up with it.
        autoFocus
        disabled={isPosting}
      />
      <span className="brag__quote brag__quote--under">
        <QuotedLine text={text} name={name} nameFaction={nameFaction} />
      </span>
      {reward && <Reward text={reward.text} stone={reward.stone} faction={faction} />}
      <div className="brag__row">
        <Button variant="link" type="submit" disabled={isPosting}>
          {postLabel}
        </Button>
        <Button variant="link" onClick={() => setWriting(false)} disabled={isPosting}>
          Back
        </Button>
      </div>
    </form>
  );
};
