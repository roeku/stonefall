# Stonefall

StoneFall is a precision-based 3D tower stacking game built for Reddit's developer platform. Players tap to drop neon blocks that sweep across the platform in alternating directions, chaining perfect placements for massive score multipliers and sharing the resulting towers with the community.

## Inspiration

- Combines classic block-stacking tension with rhythm-game timing for a fast replay loop
- Designed around Reddit's social surface: quick rounds, easy-to-replay runs, and shareable leaderboards
- Visual direction draws from neon sci-fi edges, minimal geometry, and clean HUD overlays

## What It Does

- Blocks traverse the tower on alternating axes; players tap to lock in alignment before the block slides past
- Perfect drops carve trimmed blocks and build a combo multiplier that explodes the score when maintained
- Leaderboards, shared tower viewing, and Reddit-native posts let community members compare runs and celebrate highlights together

## Technology Stack

- **Frontend**: React, @react-three/fiber, and ThreeJS for performant 3D rendering with custom bloom and outline passes
- **Server**: Node with Express deployed on Reddit's developer platform for gameplay endpoints and moderation tooling
- **Data**: In-memory storage powers runs, leaderboards, and spatial tower placement metadata
- **Shared**: Deterministic simulation utilities reused across client preview and server verification

## Key Technical Features

- Instanced mesh rendering, object pooling, and adaptive quality levels keep mobile frame rates near 60 fps
- Replay submission plus server-side deterministic verification combat cheating while staying within platform request limits
- A shared 3D tower grid lets players fly through community creations directly inside the Reddit app post
- Neon-inspired visual effects: glowing outlines, particle bursts for perfect chains, and cinematic post-processing

## How to Use (Player View)
- Open the Stonefall post or app surface on Reddit and press "Initialize" to start a run.
- Tap/click anywhere on the game canvas to drop the moving block; keep timing tight to build perfect streaks.
- Watch your combo and score climb; when the run ends, share or view your tower directly in the post.

## Challenges We Solved

- Crafted data structures that scale leaderboard reads and tower snapshots for active subreddits
- Matched client previews with server verification to avoid sync issues across browsers and devices
- Balanced visual fidelity with mobile GPU budgets through aggressive instancing and effect toggles
- Built anti-cheat replay checks that stay responsive without WebSockets or long-lived connections

## Getting Started

> Requires Node 22+

1. Install dependencies: `npm install`
2. Start local builds and the preview session: `npm run dev`
3. Open the generated preview URL to interact with the app live on Reddit

To play and review changes without Devvit, `npm run play` serves the client on http://localhost:7474 against an in-memory mock of the server (`src/client/devServer/mockApi.ts`). To see it at the size it ships at, `tools/shoot.mjs` drives that page in headless Chrome and saves screenshots -- a Reddit inline post on a phone is about 375 x 512 -- and can tap, switch scope, and play a run from a script. See the header of that file.

## Deployment Workflow

- `npm run build` — Compile client and server bundles
- `npm run deploy` — Build and upload the current version to Reddit
- `npm run launch` — Build, upload, and submit for publish review
- `npm run login` — Authenticate the Reddit CLI

## Changelog
- 2026-09-05 (backend rewrite): The server had two destructive routes with no authorization anywhere in the app: `DELETE /api/game/clear-all` wiped every leaderboard, session and user record, and `DELETE /api/game/user/:userId` took the victim's id from the URL and never compared it to the caller. Both were reachable from any web view. The capability is kept, because clearing Redis before a deploy is a real need, but it now lives under `/internal/*` (which Devvit does not expose to web views) behind a moderator-only menu and a form that requires the subreddit name typed back.

  `verifyGameReplay` never ran the simulation. Every check compared the client's replay to the client's own summary, so a request asserting a score of 999,999 with one fake input and stub blocks agreed with itself and went onto the leaderboard. The server now replays the recorded inputs through the shared deterministic simulation and derives the score, block count, perfect count and tower geometry itself; nothing the client says about the outcome is read. Because the server's number is authoritative rather than compared, the Math.sin divergence between browser engines and Node changes a score by a rounding error instead of rejecting an honest player. The tuning the replay depends on moved into `RUN_TUNING` so both sides read one copy. `runs.test.ts` locks reproducibility and the forgery cases.

  `/api/grid/community` resolved four hundred plots in a serial loop with one hash read per placement: up to twenty thousand sequential Redis calls per viewer, every tower's geometry in one response, writes issued during the GET, and an index range that was not reversed, so past four hundred players the board served the four hundred stalest plots and nobody new ever appeared. The board is now built when a placement changes it and read as fixed pages, capped by tower and block count. Reads never write.

  `save-session` cost about fifty sequential Redis round-trips and its retry loop wrapped twenty-odd untransacted commands, so a partial failure could delete a personal best from the leaderboard and then promote a lower score in its place. Saving is now idempotent on a client-generated session id, and a new best is a single compare-and-set on one member.

  Deleted: nine `/api` routes with no client caller, `gameDataService` (1,760 lines), `playerGridService`, both scheduled jobs, `createSharePost` and `createLeaderboardPost`, the tournament and Elo types and view states, the unreachable ghost/replay system in `useGameState`, and the per-tick debug scaffolding in the simulation, which had started running on the server once for every tick of every saved run. `storage-cleanup` had an endpoint and no cron; the board rebuild that replaces it has one. `server/index.ts` went from 1,050 lines to 330, `api.ts` from 401 to 240.

- 2026-09-05 (one grid): `cellToWorld(0)` is world 4, so cells span multiples of 8, but the run built its tower at world 0, which is a cell corner. The game's floor grid had been shifted half a cell to hide it, which meant the run and the board were drawing two different grids and the transition between them could never line up. The run is now built on the player's own plot centre cell and both scenes draw the same grid. The transition was a cut behind a black veil for three reasons: the run slammed the camera to a hard-coded position, the board's camera always arrived from high above its target, and the two used different lenses. Both now declare one lens and each inherits the pose the other left, so the veil is gone; a second `setTimeout` in `GameScene` that re-slammed the camera and reset the fov went with it. Placement drew the tower in hand only once a cell had been tapped, so a player arrived with nothing on screen: it now opens aimed at an empty cell, squashes standing towers to a map, and the camera rig clears the plot's skyline instead of fitting only its footprint. The target cell gets a light column so a two-block tower is findable next to two-hundred-unit neighbours.

- 2026-09-05 (feel and community): The run had no difficulty curve. Sweep bounds were fixed at 8 units while the block shrank on every miss, so by the third block about three quarters of the sweep was an instant loss and random tapping survived 3.2 blocks; the perfect window was ~99ms with no middle tier, and the 1.6^streak multiplier (capped at 100x) meant a 67ms difference in timing consistency moved the final score by 139x, which made the leaderboard meaningless. The sweep now follows the block it has to land on, a close band charges only part of a near miss, a perfect regrows the idle axis (recovery, which the run never had), the chain multiplier is linear and capped at 5x, and speed escalates linearly instead of logarithmically. All of it lives in `RUN_TUNING` at the top of `gameSimulation.ts` and is locked by `runTuning.test.ts`, which measures the curve rather than asserting constants. Measured outcome by timing precision: 0ms 166 blocks/8.6k, 67ms 83/1.6k, 167ms 29/449, 267ms 15/198 - runs of 10 to 60 seconds and roughly 2x between adjacent tiers.

  The first ten seconds now teach. A pulsing tap ring and three words sit at the bottom of the frame until the first drop lands, then one line names what to aim for.

  The community layer existed only as dead code: `POST /api/game/share-session` created a whole new post per run and nothing in the client had ever called it, and there was no comment integration at all. Runs are now announced as comments on the post the player is already in, as the player (`runAs: 'USER'`), assembled server-side from a fixed set of phrasings so there is no user-generated text to moderate. Tapping any tower takes its score into a run as a rival; passing it fires its own callout mid-run and offers a callout comment naming them, which is what pulls the other person back through a Reddit notification. A chatter strip on the board cycles recent runs and doubles as an entry point. Redis indexes the feed (sorted set, since Devvit has no list commands); the comment-delete trigger now prunes it instead of only logging.

  Devvit 0.14.0 to 0.14.2, and Journeys telemetry via `@devvit/analytics`: `app.ready` when the board has real data, `journey.start` per run, `journey.progress` at height milestones, `journey.interaction` for challenge/place/brag/scope/inspect, and `journey.end` where `complete` means the tower actually went onto the grid, so completion_rate measures the play-to-place funnel. Every call is fire-and-forget and swallows its own errors. The dead `asUser` permission is gone; `scope: "user"` is what was already doing the work.
- 2026-09-05 (later): Towers now sit on the grid. The simulation's base block is `TOWER_WIDTH * 2` = 8 units and every block inherits that width, but the board cell had been set to 4 on the belief that towers were 4 wide, so every real tower overhung its cell by half a cell and collided with its neighbours; the cell is 8 again, the game's floor is offset so the tower it grows is on-grid too, and the harness mock now builds towers the way the simulation does. The run got its feel: hit stop, screen shake and a camera punch on every landing (harder on a perfect), a squash-and-flash on the landed block, a shockwave ring on the plane it hit, sparks off the cut, offcuts that fall and stay on the floor for the rest of the run, the missed block tumbling down at game over, a heavier thud, and a stinger that climbs a semitone per consecutive perfect. The chrome is type and hairlines now; the traced art panels are archived. The city view squashes heights logarithmically into a map and grows a tapped tower back to true scale.
- 2026-09-05: Rebuilt the board and the run HUD around the phone-in-a-post frame. The board is drawn by one instanced mesh (`components/board/`) with a short build-in, a per-mode camera rig (your plot, the city from above, one tower, placement), tap-to-select with everyone else dimmed, a beacon over your own plot in the city view, and a floor that fades with the camera instead of blooming to white. The run HUD counts the score up, names perfect streaks, and holds on the finished tower before placement; placement dims the standing towers and lifts the camera to wherever a stacked tower will land. The streaming renderer, its camera controller and the old floor are in `archive/`. `tools/shoot.mjs` screenshots the local harness headlessly at exact phone sizes.
- 2026-02-17: Added a dedicated Elo leaderboard experience with inline leaderboard posts, Top 5 and Around Me views, and pagination. Improved leaderboard presentation for mobile (responsive spacing/typography and cleaner standalone layout), and fixed duplicate leaderboard requests when switching tabs so Top 5 fetches once per click.
- 2026-02-17: Added automatic user flair syncing for competitive progression. Introduced `UserFlairService` to update subreddit user flairs with `ELO` and `MAX` tower score, wired to run after `/api/game/save-session` (personal best authority) and `/api/tournament/report-match` (ELO authority), with non-blocking error handling so gameplay responses are unaffected if flair writes fail.
- 2026-02-17: Fixed critical Challenge Mode request duplication and view reset issues. Added guards so Enter Grid no longer bounces back to the inline grid during late async session/init responses, deduplicated opponent tower fetches during matchmaking/find-match transitions, and made match reporting idempotent so `report-match` is only sent once per match ID.
- 2026-02-13: Implemented practice match fallback for Challenge Mode matchmaking to solve the chicken-and-egg problem where users couldn't find matches when no challenge towers existed. When matchmaking fails to find human opponents, the system now creates a practice match that allows players to play and create challenge towers without ELO changes. This enables organic tower pool growth for the matchmaking ecosystem. Includes code cleanup and improved error handling in tournament service structure.
- 2026-02-03: Enhanced anti-cheat system with server-side score integrity verification. All game sessions now require replay data and undergo consistency checks: validating replay structure, cross-field consistency, sanity bounds on scores/blocks/combos, and tower block count accuracy. Prevents score manipulation while maintaining fast verification without expensive game simulation.
- 2026-02-03: Challenge Mode with ticket-limited elo matchmaking, live battle HUD displaying opponent scores, ghost tower visualization, and session-based state management. Fixed mode switching bugs to ensure clean transitions between daily/cycle and challenge gameplay.
- 2026-02-03: Removed All-Time view due to unresolved bugs.
- 2026-01-19: Completely disabled client-side localStorage caching for towers to resolve persistent mobile crashes.
- 2026-01-18: Implemented asynchronous Tournament Mode backend (Elo matchmaking, Ghost Replays, Redis storage) and frontend visualization (transparent ghost towers). Hidden entry point pending final ghost synchronization fixes.
- 2026-01-18: Critical fix for localStorage overflow crashes - debounced tower cache writes to persist only after loading completes instead of on every render, eliminating 50+ writes per second that caused QuotaExceededError on mobile devices.
- 2026-01-15: Daily cycles now use session timestamps when saving to ensure every attempt lands in the correct day; updated Devvit dependencies to 0.12.8.
- Adjusted tower streaming to use viewport-size based mobile detection and slower batching on smaller canvases to avoid mobile resets.
- 2026-01-13: Fixed mobile storage crashes by capping client-side tower cache to 150 entries.
- 2026-01-13: Updated daily cycle logic to track all game sessions (removed per-user uniqueness filter) and fixed missing daily stats data.
- 2026-01-09: Fixed Redis response size limit errors by capping `zRange` queries to 500 entries max (previously fetched unbounded); optimized `getPlayerRank` to use `zRank` API instead of full member scan.
- 2026-01-09: Performance pass to reduce frame drops by reusing frustum-culling bounding boxes and memoizing render-time converters; smoother tower rendering on mobile GPUs.
- Reduced/removed tower filtering to display more unique player towers in cycle view.

## Quality Gates

- `npm run check` — Type-check, lint, and format the workspace
- `npm run type-check` / `npm run lint` / `npm run prettier` — Run individual tooling when iterating quickly

## Roadmap Highlights

- **Phase 1 (Immediate)**: Tournament scheduling, detailed analytics, spectator replays, hardened anti-cheat
- **Phase 2 (Mid-term)**: Global leaderboards across subreddits, theme customization
- **Phase 3 (Long-term)**: Community-created block sets, visual themes, and alternate game modes
