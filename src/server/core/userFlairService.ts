import { context, reddit } from '@devvit/web/server';

type UpdateUserFlairParams = {
  username: string;
  elo: number;
  maxTowerScore: number;
};

export class UserFlairService {
  private static formatFlairText(elo: number, maxTowerScore: number): string {
    const safeElo = Number.isFinite(elo) ? Math.max(0, Math.round(elo)) : 0;
    const safeMax = Number.isFinite(maxTowerScore) ? Math.max(0, Math.round(maxTowerScore)) : 0;
    return `ELO ${safeElo} | MAX ${safeMax}`;
  }

  static async updateUserFlair({
    username,
    elo,
    maxTowerScore,
  }: UpdateUserFlairParams): Promise<void> {
    if (!username) {
      return;
    }

    const subredditName = context.subredditName ?? (await reddit.getCurrentSubredditName());
    if (!subredditName) {
      return;
    }

    const text = this.formatFlairText(elo, maxTowerScore);

    await reddit.setUserFlair({
      subredditName,
      username,
      text,
    });
  }
}
