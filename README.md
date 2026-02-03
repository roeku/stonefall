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

## Deployment Workflow

- `npm run build` — Compile client and server bundles
- `npm run deploy` — Build and upload the current version to Reddit
- `npm run launch` — Build, upload, and submit for publish review
- `npm run login` — Authenticate the Reddit CLI

## Changelog
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
