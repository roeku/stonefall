import { GameDataService } from '../core/gameDataService';
import { reddit, context } from '@devvit/web/server';

export async function dailyResetJob(_event: any) {
  console.log('Running daily reset job');

  const previousCycleId = GameDataService.getPreviousCycleId();
  console.log(`Processing previous cycle: ${previousCycleId}`);

  try {
    const topPlayers = await GameDataService.getTopPlayersForCycle(previousCycleId, 10);

    if (topPlayers.length === 0) {
      console.log('No players found for previous cycle.');
      return;
    }

    let body = `## 💠 GRID ARCHIVE: CYCLE ${previousCycleId}\n\n`;
    body += `Cycle terminated. Archiving top performance metrics. The following Users/Programs achieved optimal stack efficiency:\n\n`;
    body += `| RANK | USERS/PROGRAMS | SCORE |\n`;
    body += `|:---|:---|:---|\n`;

    topPlayers.forEach((player, index) => {
      body += `| ${index + 1} | u/${player.username} | ${player.score.toLocaleString()} |\n`;
    });

    body += `\n\n### 🔄 SYSTEM RESET COMPLETE\n\nThe Grid has been re-initialized. New cycle active. Resume construction protocols.`;

    let subredditName = context.subredditName;
    if (!subredditName) {
      console.warn('Context subredditName missing, trying to fetch current subreddit');
      const subreddit = await reddit.getCurrentSubreddit();
      subredditName = subreddit.name;
    }

    await reddit.submitPost({
      title: `[SYSTEM] CYCLE COMPLETE: ${previousCycleId}`,
      subredditName: subredditName,
      text: body,
    });
    console.log('Daily leaderboard post created.');
  } catch (error) {
    console.error('Failed to create daily leaderboard post:', error);
  }
}
