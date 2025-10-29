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

## Quality Gates

- `npm run check` — Type-check, lint, and format the workspace
- `npm run type-check` / `npm run lint` / `npm run prettier` — Run individual tooling when iterating quickly

## Roadmap Highlights

- **Phase 1 (Immediate)**: Tournament scheduling, detailed analytics, spectator replays, hardened anti-cheat
- **Phase 2 (Mid-term)**: Global leaderboards across subreddits, theme customization
- **Phase 3 (Long-term)**: Community-created block sets, visual themes, and alternate game modes
