import { Devvit, useState, useAsync, useInterval } from '@devvit/public-api';
import { GameDataService } from '../core/gameDataService';

interface GameBlocksProps {
  username: string;
  userId: string;
  postId: string;
}

export const GameBlocks: Devvit.BlockComponent<GameBlocksProps> = (props, context) => {
  const { username, userId, postId } = props;

  // State for current view
  const [currentView, setCurrentView] = useState<'home' | 'stats' | 'leaderboard' | 'game'>('home');

  // Fetch user stats
  const { data: userStatsData } = useAsync(async () => {
    return await GameDataService.getUserStats();
  }, {});

  // Fetch leaderboard
  const { data: leaderboardData } = useAsync(async () => {
    return await GameDataService.getLeaderboard(10);
  }, {});

  // Auto-refresh leaderboard every 30 seconds
  const refreshInterval = useInterval(async () => {
    // Trigger re-fetch
    return Date.now();
  }, 30000);

  const stats = userStatsData?.stats;
  const recentSessions = userStatsData?.recentSessions || [];
  const highScores = leaderboardData?.highScores || [];
  const perfectStreaks = leaderboardData?.perfectStreaks || [];

  // Find user's rank in leaderboard
  const userRank = highScores.findIndex(entry => entry.userId === userId) + 1;

  // Render different views based on state
  if (currentView === 'game') {
    return <GameLaunchView onBack={() => setCurrentView('home')} />;
  }

  if (currentView === 'stats') {
    return (
      <StatsView
        stats={stats}
        recentSessions={recentSessions}
        onBack={() => setCurrentView('home')}
      />
    );
  }

  if (currentView === 'leaderboard') {
    return (
      <LeaderboardView
        highScores={highScores}
        perfectStreaks={perfectStreaks}
        currentUserId={userId}
        onBack={() => setCurrentView('home')}
      />
    );
  }

  // Home view
  return (
    <blocks height="tall">
      <zstack width="100%" height="100%" alignment="top start">
        {/* TRON Grid Background */}
        <TronBackground />

        {/* Main Content */}
        <vstack width="100%" height="100%" padding="medium" gap="medium">
          {/* Header with Logo */}
          <GameHeader username={username} userId={userId} rank={userRank} />

          {/* Stats Summary Card */}
          {stats && <StatsCard stats={stats} rank={userRank} />}

          {/* Quick Actions */}
          <ActionButtons
            onPlayGame={() => setCurrentView('game')}
            onViewStats={() => setCurrentView('stats')}
            onViewLeaderboard={() => setCurrentView('leaderboard')}
          />

          {/* Mini Leaderboard Preview */}
          <LeaderboardPreview highScores={highScores.slice(0, 3)} currentUserId={userId} />

          {/* Footer */}
          <GameFooter totalPlayers={highScores.length} />
        </vstack>
      </zstack>
    </blocks>
  );
};

// ============================================================================
// TRON Background Component
// ============================================================================
const TronBackground: Devvit.BlockComponent = () => {
  return (
    <vstack width="100%" height="100%" backgroundColor="#000811">
      {/* Cyan grid lines effect - simulated with stacked elements */}
      <hstack width="100%" height="1px" backgroundColor="#00ffff20" />
      <spacer size="large" />
      <hstack width="100%" height="1px" backgroundColor="#00ffff20" />
      <spacer grow />
      <hstack width="100%" height="1px" backgroundColor="#00ffff20" />
    </vstack>
  );
};

// ============================================================================
// Header Component
// ============================================================================
interface GameHeaderProps {
  username: string;
  userId: string;
  rank: number;
}

const GameHeader: Devvit.BlockComponent<GameHeaderProps> = (props) => {
  const { username, userId, rank } = props;

  return (
    <vstack width="100%" gap="small" padding="small" cornerRadius="small">
      {/* Logo Section */}
      <hstack width="100%" alignment="center middle" gap="small">
        <text
          size="xxlarge"
          weight="bold"
          color="#00ffff"
          style="heading"
        >
          ⬢ STONEFALL
        </text>
      </hstack>

      {/* Tagline */}
      <hstack width="100%" alignment="center middle">
        <text size="small" color="#00ffff99">
          STACK · SURVIVE · DOMINATE THE GRID
        </text>
      </hstack>

      {/* User Info Card */}
      <hstack
        width="100%"
        padding="small"
        gap="small"
        backgroundColor="#00111180"
        cornerRadius="small"
        border="thin"
        borderColor="#00ffff40"
      >
        {/* Avatar */}
        <avatar
          thingId={userId}
          facing="left"
          size="small"
          background="dark"
        />

        {/* User Details */}
        <vstack gap="none" grow>
          <text size="medium" weight="bold" color="#ffffff">
            {username}
          </text>
          {rank > 0 && (
            <text size="small" color="#ffd700">
              Rank #{rank} on Grid
            </text>
          )}
          {rank === 0 && (
            <text size="small" color="#ff660099">
              Not yet on Grid
            </text>
          )}
        </vstack>

        {/* Rank Badge */}
        {rank > 0 && rank <= 10 && (
          <hstack
            width="40px"
            height="40px"
            backgroundColor={rank === 1 ? "#ffd700" : rank <= 3 ? "#c0c0c0" : "#cd7f32"}
            cornerRadius="full"
            alignment="center middle"
          >
            <text size="large" weight="bold" color="#000000">
              {rank}
            </text>
          </hstack>
        )}
      </hstack>
    </vstack>
  );
};

// ============================================================================
// Stats Card Component
// ============================================================================
interface StatsCardProps {
  stats: {
    highScore: number;
    bestTowerHeight: number;
    longestPerfectStreak: number;
    totalGames: number;
    averageScore: number;
  };
  rank: number;
}

const StatsCard: Devvit.BlockComponent<StatsCardProps> = (props) => {
  const { stats } = props;

  return (
    <vstack
      width="100%"
      padding="medium"
      gap="small"
      backgroundColor="#00111180"
      cornerRadius="small"
      border="thin"
      borderColor="#00ffff60"
    >
      {/* Title */}
      <text size="medium" weight="bold" color="#00ffff">
        ▸ YOUR STATS
      </text>

      {/* Stats Grid */}
      <hstack width="100%" gap="small">
        <StatItem label="HIGH SCORE" value={stats.highScore.toString()} color="#00ffff" />
        <StatItem label="BEST HEIGHT" value={stats.bestTowerHeight.toString()} color="#ff6600" />
        <StatItem label="PERFECT STREAK" value={stats.longestPerfectStreak.toString()} color="#ffd700" />
      </hstack>

      <hstack width="100%" gap="small">
        <StatItem label="GAMES PLAYED" value={stats.totalGames.toString()} color="#ffffff" />
        <StatItem label="AVG SCORE" value={Math.round(stats.averageScore).toString()} color="#00ffff" />
        <StatItem label="STATUS" value="ACTIVE" color="#00ff00" />
      </hstack>
    </vstack>
  );
};

interface StatItemProps {
  label: string;
  value: string;
  color: string;
}

const StatItem: Devvit.BlockComponent<StatItemProps> = (props) => {
  const { label, value, color } = props;

  return (
    <vstack
      grow
      padding="small"
      gap="none"
      backgroundColor="#00000080"
      cornerRadius="small"
      alignment="center middle"
    >
      <text size="xsmall" color="#00ffff99">
        {label}
      </text>
      <text size="xlarge" weight="bold" color={color}>
        {value}
      </text>
    </vstack>
  );
};

// ============================================================================
// Action Buttons Component
// ============================================================================
interface ActionButtonsProps {
  onPlayGame: () => void;
  onViewStats: () => void;
  onViewLeaderboard: () => void;
}

const ActionButtons: Devvit.BlockComponent<ActionButtonsProps> = (props) => {
  const { onPlayGame, onViewStats, onViewLeaderboard } = props;

  return (
    <vstack width="100%" gap="small">
      {/* Primary Action - Play Game */}
      <button
        size="large"
        appearance="primary"
        onPress={onPlayGame}
        grow
      >
        ▶ ENTER THE GRID
      </button>

      {/* Secondary Actions */}
      <hstack width="100%" gap="small">
        <button
          size="medium"
          appearance="secondary"
          onPress={onViewStats}
          grow
        >
          📊 STATS
        </button>
        <button
          size="medium"
          appearance="secondary"
          onPress={onViewLeaderboard}
          grow
        >
          🏆 LEADERBOARD
        </button>
      </hstack>
    </vstack>
  );
};

// ============================================================================
// Leaderboard Preview Component
// ============================================================================
interface LeaderboardPreviewProps {
  highScores: Array<{
    userId: string;
    username: string;
    score: number;
    blockCount: number;
  }>;
  currentUserId: string;
}

const LeaderboardPreview: Devvit.BlockComponent<LeaderboardPreviewProps> = (props) => {
  const { highScores, currentUserId } = props;

  if (highScores.length === 0) {
    return null;
  }

  return (
    <vstack
      width="100%"
      padding="medium"
      gap="small"
      backgroundColor="#00111180"
      cornerRadius="small"
      border="thin"
      borderColor="#ffd70060"
    >
      {/* Title */}
      <text size="medium" weight="bold" color="#ffd700">
        ⭐ TOP PERFORMERS
      </text>

      {/* Top 3 Players */}
      {highScores.map((entry, index) => (
        <LeaderboardEntry
          key={entry.userId}
          rank={index + 1}
          username={entry.username}
          score={entry.score}
          blocks={entry.blockCount}
          isCurrentUser={entry.userId === currentUserId}
        />
      ))}
    </vstack>
  );
};

interface LeaderboardEntryProps {
  rank: number;
  username: string;
  score: number;
  blocks: number;
  isCurrentUser: boolean;
}

const LeaderboardEntry: Devvit.BlockComponent<LeaderboardEntryProps> = (props) => {
  const { rank, username, score, blocks, isCurrentUser } = props;

  const rankColor = rank === 1 ? "#ffd700" : rank === 2 ? "#c0c0c0" : "#cd7f32";
  const bgColor = isCurrentUser ? "#00ffff20" : "#00000060";

  return (
    <hstack
      width="100%"
      padding="small"
      gap="small"
      backgroundColor={bgColor}
      cornerRadius="small"
      alignment="middle"
    >
      {/* Rank */}
      <text size="medium" weight="bold" color={rankColor} width="30px">
        #{rank}
      </text>

      {/* Username */}
      <text
        size="medium"
        weight={isCurrentUser ? "bold" : "regular"}
        color={isCurrentUser ? "#00ffff" : "#ffffff"}
        grow
      >
        {username}
      </text>

      {/* Score */}
      <vstack gap="none" alignment="end middle">
        <text size="small" color="#00ffff">
          {score.toLocaleString()}
        </text>
        <text size="xsmall" color="#ffffff99">
          {blocks} blocks
        </text>
      </vstack>
    </hstack>
  );
};

// ============================================================================
// Game Footer Component
// ============================================================================
interface GameFooterProps {
  totalPlayers: number;
}

const GameFooter: Devvit.BlockComponent<GameFooterProps> = (props) => {
  const { totalPlayers } = props;

  return (
    <vstack width="100%" gap="small" alignment="center middle">
      <hstack width="100%" height="1px" backgroundColor="#00ffff40" />
      <text size="xsmall" color="#00ffff99">
        {totalPlayers} USERS ON THE GRID
      </text>
    </vstack>
  );
};

// ============================================================================
// Game Launch View
// ============================================================================
interface GameLaunchViewProps {
  onBack: () => void;
}

const GameLaunchView: Devvit.BlockComponent<GameLaunchViewProps> = (props, context) => {
  const { onBack } = props;

  // Launch the web view for the actual game
  const handleLaunch = () => {
    context.ui.webView.postMessage('myWebView', {
      type: 'LAUNCH_GAME',
    });
  };

  return (
    <blocks height="tall">
      <zstack width="100%" height="100%" alignment="center middle">
        <TronBackground />

        <vstack padding="large" gap="large" alignment="center middle">
          {/* Logo */}
          <text size="xxlarge" weight="bold" color="#00ffff">
            ⬢ STONEFALL
          </text>

          {/* Instructions */}
          <vstack
            padding="medium"
            gap="small"
            backgroundColor="#00111180"
            cornerRadius="small"
            border="thin"
            borderColor="#00ffff60"
            width="90%"
          >
            <text size="large" weight="bold" color="#00ffff" alignment="center">
              HOW TO PLAY
            </text>
            <text size="small" color="#ffffff" alignment="center">
              • Tap to drop blocks and build your tower
            </text>
            <text size="small" color="#ffffff" alignment="center">
              • Perfect drops earn combo multipliers
            </text>
            <text size="small" color="#ffffff" alignment="center">
              • Survive as long as possible
            </text>
            <text size="small" color="#ffd700" alignment="center">
              • Reach the top 50 to join THE GRID
            </text>
          </vstack>

          {/* Launch Button */}
          <button
            size="large"
            appearance="primary"
            onPress={handleLaunch}
            grow
          >
            ⚡ START GAME
          </button>

          {/* Back Button */}
          <button
            size="medium"
            appearance="secondary"
            onPress={onBack}
          >
            ← BACK
          </button>
        </vstack>
      </zstack>
    </blocks>
  );
};

// ============================================================================
// Stats View
// ============================================================================
interface StatsViewProps {
  stats: any;
  recentSessions: any[];
  onBack: () => void;
}

const StatsView: Devvit.BlockComponent<StatsViewProps> = (props) => {
  const { stats, recentSessions, onBack } = props;

  return (
    <blocks height="tall">
      <zstack width="100%" height="100%" alignment="top start">
        <TronBackground />

        <vstack width="100%" height="100%" padding="medium" gap="medium">
          {/* Header */}
          <hstack width="100%" alignment="start middle" gap="small">
            <button size="small" appearance="secondary" onPress={onBack}>
              ←
            </button>
            <text size="xlarge" weight="bold" color="#00ffff">
              YOUR STATISTICS
            </text>
          </hstack>

          {/* Detailed Stats */}
          {stats && (
            <vstack
              width="100%"
              padding="medium"
              gap="medium"
              backgroundColor="#00111180"
              cornerRadius="small"
              border="thin"
              borderColor="#00ffff60"
            >
              <StatRow label="Total Games Played" value={stats.totalGames.toString()} />
              <StatRow label="Highest Score" value={stats.highScore.toLocaleString()} />
              <StatRow label="Best Tower Height" value={`${stats.bestTowerHeight} blocks`} />
              <StatRow label="Longest Perfect Streak" value={stats.longestPerfectStreak.toString()} />
              <StatRow label="Total Perfect Blocks" value={stats.totalPerfectBlocks.toString()} />
              <StatRow label="Average Score" value={Math.round(stats.averageScore).toLocaleString()} />
            </vstack>
          )}

          {/* Recent Games */}
          {recentSessions.length > 0 && (
            <vstack
              width="100%"
              padding="medium"
              gap="small"
              backgroundColor="#00111180"
              cornerRadius="small"
              border="thin"
              borderColor="#ff660060"
            >
              <text size="medium" weight="bold" color="#ff6600">
                RECENT GAMES
              </text>
              {recentSessions.slice(0, 5).map((session, index) => (
                <SessionEntry key={session.sessionId} session={session} />
              ))}
            </vstack>
          )}
        </vstack>
      </zstack>
    </blocks>
  );
};

interface StatRowProps {
  label: string;
  value: string;
}

const StatRow: Devvit.BlockComponent<StatRowProps> = (props) => {
  const { label, value } = props;

  return (
    <hstack width="100%" alignment="space-between middle">
      <text size="medium" color="#ffffff99">
        {label}
      </text>
      <text size="medium" weight="bold" color="#00ffff">
        {value}
      </text>
    </hstack>
  );
};

interface SessionEntryProps {
  session: {
    finalScore: number;
    blockCount: number;
    perfectStreakCount: number;
    endTime?: number;
  };
}

const SessionEntry: Devvit.BlockComponent<SessionEntryProps> = (props) => {
  const { session } = props;

  return (
    <hstack
      width="100%"
      padding="small"
      gap="small"
      backgroundColor="#00000060"
      cornerRadius="small"
    >
      <text size="small" color="#00ffff" grow>
        Score: {session.finalScore.toLocaleString()}
      </text>
      <text size="small" color="#ff6600">
        {session.blockCount} blocks
      </text>
      <text size="small" color="#ffd700">
        ⭐{session.perfectStreakCount}
      </text>
    </hstack>
  );
};

// ============================================================================
// Leaderboard View
// ============================================================================
interface LeaderboardViewProps {
  highScores: any[];
  perfectStreaks: any[];
  currentUserId: string;
  onBack: () => void;
}

const LeaderboardView: Devvit.BlockComponent<LeaderboardViewProps> = (props) => {
  const { highScores, perfectStreaks, currentUserId, onBack } = props;
  const [activeTab, setActiveTab] = useState<'scores' | 'streaks'>('scores');

  return (
    <blocks height="tall">
      <zstack width="100%" height="100%" alignment="top start">
        <TronBackground />

        <vstack width="100%" height="100%" padding="medium" gap="medium">
          {/* Header */}
          <hstack width="100%" alignment="start middle" gap="small">
            <button size="small" appearance="secondary" onPress={onBack}>
              ←
            </button>
            <text size="xlarge" weight="bold" color="#ffd700">
              🏆 LEADERBOARD
            </text>
          </hstack>

          {/* Tab Buttons */}
          <hstack width="100%" gap="small">
            <button
              size="medium"
              appearance={activeTab === 'scores' ? 'primary' : 'secondary'}
              onPress={() => setActiveTab('scores')}
              grow
            >
              HIGH SCORES
            </button>
            <button
              size="medium"
              appearance={activeTab === 'streaks' ? 'primary' : 'secondary'}
              onPress={() => setActiveTab('streaks')}
              grow
            >
              PERFECT STREAKS
            </button>
          </hstack>

          {/* Leaderboard Content */}
          {activeTab === 'scores' && (
            <vstack width="100%" gap="small">
              {highScores.map((entry, index) => (
                <FullLeaderboardEntry
                  key={entry.userId}
                  rank={index + 1}
                  username={entry.username}
                  value={entry.score.toLocaleString()}
                  subValue={`${entry.blockCount} blocks`}
                  isCurrentUser={entry.userId === currentUserId}
                />
              ))}
            </vstack>
          )}

          {activeTab === 'streaks' && (
            <vstack width="100%" gap="small">
              {perfectStreaks.map((entry, index) => (
                <FullLeaderboardEntry
                  key={entry.userId}
                  rank={index + 1}
                  username={entry.username}
                  value={`⭐ ${entry.perfectStreak}`}
                  subValue={`Score: ${entry.score.toLocaleString()}`}
                  isCurrentUser={entry.userId === currentUserId}
                />
              ))}
            </vstack>
          )}
        </vstack>
      </zstack>
    </blocks>
  );
};

interface FullLeaderboardEntryProps {
  rank: number;
  username: string;
  value: string;
  subValue: string;
  isCurrentUser: boolean;
}

const FullLeaderboardEntry: Devvit.BlockComponent<FullLeaderboardEntryProps> = (props) => {
  const { rank, username, value, subValue, isCurrentUser } = props;

  const rankColor = rank === 1 ? "#ffd700" : rank === 2 ? "#c0c0c0" : rank === 3 ? "#cd7f32" : "#00ffff";
  const bgColor = isCurrentUser ? "#00ffff20" : "#00111180";
  const borderColor = isCurrentUser ? "#00ffff" : "#00ffff40";

  return (
    <hstack
      width="100%"
      padding="medium"
      gap="small"
      backgroundColor={bgColor}
      cornerRadius="small"
      border="thin"
      borderColor={borderColor}
      alignment="middle"
    >
      {/* Rank Badge */}
      <hstack
        width="40px"
        height="40px"
        backgroundColor={rank <= 3 ? rankColor + "40" : "#00000080"}
        cornerRadius="small"
        alignment="center middle"
        border={rank <= 3 ? "thick" : "thin"}
        borderColor={rankColor}
      >
        <text size="large" weight="bold" color={rankColor}>
          {rank}
        </text>
      </hstack>

      {/* User Info */}
      <vstack gap="none" grow>
        <text
          size="medium"
          weight={isCurrentUser ? "bold" : "regular"}
          color={isCurrentUser ? "#00ffff" : "#ffffff"}
        >
          {username}
        </text>
        <text size="xsmall" color="#ffffff99">
          {subValue}
        </text>
      </vstack>

      {/* Value */}
      <text size="large" weight="bold" color={rankColor}>
        {value}
      </text>
    </hstack>
  );
};
