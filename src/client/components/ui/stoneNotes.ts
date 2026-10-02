import type { StoneNews } from '../../../shared/types/api';
import { postingWouldEarn, type StoneId } from '../../../shared/social/stones';

/**
 * What posting today would do for the player's stones, for the line under the comment offer:
 * "Posting unlocks Marble", or how far it goes towards the next. Null when today already counted.
 */
export const postingNote = (news: StoneNews | null): { text: string; stone: StoneId } | null => {
  if (!news) return null;
  const next = postingWouldEarn(news, news.postedToday);
  if (!next) return null;
  return {
    stone: next.stone.id,
    text:
      next.day >= next.of
        ? `Posting unlocks ${next.stone.name}`
        : `Posting counts toward ${next.stone.name}, day ${next.day} of ${next.of}`,
  };
};
