# Stonefall

Stonefall is a 3D tower-stacking game played inside Reddit posts, for communities that want a daily game their members can play in a minute from the feed, on a phone or a computer. Tap to drop each sliding block and land it flush. Every day brings two posts: a map, where finished towers claim ground for the player's colour, and a relay, where crews of up to six take turns stacking shared towers.

## For moderators

- Install it on your subreddit. It puts up today's map and relay posts straight away, then at 12:00 UTC every day posts the next pair and comments each day's result on the old ones. There is nothing to configure.
- The subreddit menu has **Create today's map post** and **Create today's relay post** (safe to run again: they find today's post), **[Storage] 1. Purge dry run**, and **[Storage] 2. Purge all game data**, which deletes today's game and asks you to type the subreddit name first.
- Keep the app account a moderator: it pins one "Scores" comment on each game post, and players' score comments go under it.
- If a daily post is deleted, the game forgets it, and the menu item puts up a new one.

## How to play

- **Map**: tap Build, tap to drop each block, then raise the tower on your plot or on land within reach. A higher score takes a held cell. Signed-out visitors can play a run and sign in to raise it.
- **Relay**: take a seat and tap when your turn comes. Miss the tower and you're out until tomorrow.
- **Older posts** show how their day ended: the map's standings and best score, the relay's final towers. Build or Take a seat there plays today's.

## Comments, data and support

- The game only comments for a player when they tap Comment and confirm the exact text it shows them. They can edit it first: add words of their own and it is posted as their own comment in the thread, otherwise it goes under the pinned Scores comment. Either way it is theirs, posted from their account, and they can delete it; the game never shows what they wrote.
- It stores each player's Reddit id and name, colour and runs, and for relay seats their avatar. Player records expire 30 days after their last game, a day's map 14 days after that day, and a relay 14 days after it was last played. Deleted posts and comments are removed from its records. Nothing is sent outside Reddit.
- To report a problem, use **Report a problem with Stonefall** in a game post's menu, or message the moderators of r/stonefall.

## Technology Stack

- **Client**: React, @react-three/fiber and three.js.
- **Server**: Express on Devvit Web, with Redis, realtime and scheduled jobs.
- **Shared**: a deterministic simulation the server replays to score every run and relay turn.

## Getting Started

> Node 24 (what Devvit runs apps on; the CLI warns on older versions)

1. Install dependencies: `npm install`
2. Start local builds and the preview session: `npm run dev`
3. Open the generated preview URL to interact with the app live on Reddit

To play and review changes without Devvit, `npm run play` serves the client on http://localhost:7474 against an in-memory mock of the server (`src/client/devServer/mockApi.ts`); add `?relay` to the URL for the relay post, where bots fill two crews and take turns. The mock has a few controls for looking at states on purpose: `/api/mock/map?live=0` opens the map as yesterday's post, which shows that day as it ended and plays today's from Build (`?live=1` back), `/api/mock/relay?old=1` does the same for the relay (`?old=0` back), `/api/mock/map?turn=1` moves the day on so a raise aimed on the old day is refused and re-aimed, `/api/mock/relay?bots=14` seats more bots so crews fill and new towers start, `?miss=1` makes the next bot drop a miss (`&tower=N` for one on that tower) and `?youmiss=1` makes your own next drop one. To see it at the size it ships at, `tools/shoot.mjs` drives that page in headless Chrome and saves screenshots -- a Reddit inline post on a phone is about 375 x 512 -- and can tap, switch scope, and play a run from a script. On a Mac it renders on the GPU, which is fast enough to capture an animation frame by frame. See the header of that file.

## Deployment Workflow

- `npm run build` — Compile client and server bundles
- `npm run deploy` — Build and upload the current version to Reddit
- `npm run launch` — Build, upload, and submit for publish review
- `npm run login` — Authenticate the Reddit CLI

What an upload sends to Reddit: every file in `dist/client`, unfiltered, as public web view assets, so anything in `src/client/public/` ships whether it is used or not; the server bundle and its source map, which stay private; `devvit.json`; and this README, as the app's About text. `devvit publish` also uploads a zip of the repository for review, minus `.gitignore` and the `sourceIgnores` in `devvit.json`.

The app icon is `branding/icon.png`, 1024 px, set as `marketingAssets.icon` in `devvit.json`. Reddit takes it when a publish is approved, so a new icon needs a new review. The same folder has the vector source, a 256 px community icon and the logo.

## Analytics (Devvit Journeys)

`permissions.journeys` in `devvit.json` turns Journeys on; nothing else has to be requested (the docs still describe an allowlist, which is no longer required). `src/server/index.ts` mounts the SDK's router on `/api/telemetry/*`, and on the client `utils/journeys.ts` says what a journey is (with tests) while `utils/telemetry.ts` binds it to the page. Each response carries a receipt saying whether the event was recorded, and the first refusal of each kind on a page (rate limited, duplicate, invalid) is logged as `[journeys] ...`, so it shows in `devvit logs`. The numbers are on the app's Analytics tab in the developer portal, one row per UTC day. The journey map:

| Event                 | Map post: a run                                                                                                                                                                                                                                     | Relay post: a sitting                                                                                                                                                                     |
| --------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `App.Ready`           | The board has drawn with real data                                                                                                                                                                                                                  | The first tower state has arrived                                                                                                                                                         |
| `Journey.Start`       | Build, a card's Take it / Beat it, or Again                                                                                                                                                                                                         | Take a seat, Join tower, or Start a new tower                                                                                                                                             |
| `Journey.Progress`    | Tower height at 10, 25, 50, 80 and 120 blocks, 0.2 to 1.0 (`tower_height`)                                                                                                                                                                          | Blocks the player has landed this sitting at 1, 3, 6, 10 and 15, 0.2 to 1.0 (`blocks_landed`)                                                                                             |
| `Journey.Interaction` | `aim_beat`, `aim_take`, `aim_claim` (own, rival, open); `tower_raised` (keep, claim, take); `tower_inspected` (own, ally, rival); `cell_inspected` (keep, land, road); `scope_changed` (mine, all); `faction_chosen` (colour); `brag_posted` (kind) | `relay_join` (joined, started); `brag_posted`                                                                                                                                             |
| `Journey.End`         | Complete when the tower is raised onto the grid. Not complete when it is discarded, dropped for Again, not saved, or left with the page. `win`: passed the target, took the land, or a personal best. `score`: the run's score                      | Complete when the player falls or the day tops out with them seated. Not complete when the seat is given up or the page is left. `win`: topped out still standing. `score`: blocks landed |

Starts are always a button, never a load or a view. Interactions fire on click, after the action has happened, and their details name a kind of thing, never a user and never a score. Events are sent one at a time, so each lands on the journey it belongs to; the journey id lives in memory, because nothing a journey stands for survives a reload and both posts can be open in one feed.

## Changelog

- 2026-09 (rebuild): Rebuilt from the ground up:
  - **Map**: drop sliding blocks to build a tower, then raise it on your plot or on land within reach. A higher score takes a held cell and brings its tower down.
  - **Relay**: crews of up to six take turns dropping blocks on shared towers. Miss the tower and you're out for the day.
  - **Factions**: eight colours race for the most ground each day. Switching colour takes down your towers on today's map.
  - **Comments**: players can post their result as themselves, in wording the app writes and shows them before they confirm, as a reply under the app's pinned Scores comment, or edit it into their own words and post it in the thread. The app comments each day's final results.
  - **Privacy and sign-in**: player records expire 30 days after their last game, deleted posts and comments leave the game's records, and signed-out visitors can play and then sign in to keep their run.
  - **Moderators**: menu items create today's posts and purge game data.
  - **Daily posts**: older posts show how their day ended, and play today's game.

## Quality Gates

- `npm run check` — Type-check, lint, and format the workspace
- `npm run type-check` / `npm run lint` / `npm run prettier` — Run individual tooling when iterating quickly
