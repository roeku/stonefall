# Stonefall

Stonefall is a 3D tower-stacking game played inside Reddit posts, for communities that want a daily game their members can play in a minute from the feed, on a phone or a computer. Tap to drop each sliding block and land it flush. Every day brings two posts: a map, where finished towers claim ground for the player's colour, and a relay, where every colour stacks a tower of its own and races the others.

## For moderators

- Install it on your subreddit. It puts up today's map and relay posts straight away, then at 12:00 UTC every day posts the next pair and comments each day's result on the old ones. There is nothing to configure.
- The subreddit menu has **Create today's map post** and **Create today's relay post** (safe to run again: they find today's post), **[Storage] 1. Purge dry run**, and **[Storage] 2. Purge all game data**, which deletes today's game and asks you to type the subreddit name first.
- Keep the app account a moderator: it pins one comment on each game post, naming the day before's best players, and players' score comments go under it. It also sets every player's flair, from their first game: their colour, stone and streak, and what they won the day before until the next day's winners. Turn on user flair in the subreddit's settings to show it. Its own posts get a **Map** or **Relay** post flair, so the feed can be filtered by them; the app makes the two templates, moderator-only, and keeps using them if you rename or recolour them.
- If a daily post is deleted, the game forgets it, and the menu item puts up a new one.

## How to play

- **Map**: tap Build, tap to drop each block, then raise the tower on your colour's ground. The first player of a colour each day founds its keep, a safe cell every player of that colour can stack on; everyone after builds out from there, on land within reach of anything the colour holds. A tower raised on your colour's land goes on top of what stands there, never topples it. A higher score than the best tower in a rival stack takes the cell and brings the whole stack down. Signed-out visitors can play a run and sign in to raise it.
- **Levels**: every raised tower earns XP for its blocks and perfects, more for winning ground: half as much again for a claim, double for taking a rival's tower, triple for taking back your own, and more for each tower a take brings down. Relay blocks earn XP too. XP never resets, and your level shows beside your colour and in your flair. Each colour has three orders a day (take a tower, win cells, land relay blocks and the like), the same for all its players; finishing all three drops a bonus. The first tower you raise each day has a capstone fall onto it: it grows with your streak, pays for every cell you still held when yesterday's map closed and more if your colour won, and is sometimes gold, every seventh day in a row always.
- **Stones**: blocks are neon until you earn a stone (Marble, Slate, Crystal, Granite, Obsidian, Basalt, Quartz) by playing days in a row or by posting about a run on different days. The stone you pick covers your blocks and every tower you have standing; your colour stays your colour, so the map still reads by side. Your flair in the subreddit shows your colour, stone and streak from your first game, and what you won for a day: every player of the colour with the most ground, the best tower, the most land and the most relay blocks. **Remove from your flair**, under the stones, gives back the flair you had.
- **Relay**: every colour has its own tower, and you build yours. Take a seat, and when your turn comes stack as many blocks as you can in ten seconds, each one a little faster; perfects in a row build a streak. Turns get shorter when more than six of a colour are seated, so the wait stays near a minute. The top of the screen says where your colour stands and how far it is from the next; passing a colour is called out. The colour with the tallest tower at the end of the day wins its builders a flair award. While you wait, the five best turns on the tower are marked beside the blocks they laid, with the builder's avatar. A miss ends your turn, and the top heals back to full width over the base. You have two lives a day: one miss and you carry on, the second puts you out until tomorrow. Subscribing to the subreddit from the game gives one more life a day. While you wait, the camera shows the whole tower with your own blocks lit.
- **Turning the view**: the hand under the zoom buttons turns the map by dragging. In the feed it opens the post full screen first, because there a drag scrolls the feed.
- **Older posts** show how their day ended: the map's standings and best score, the relay's final towers. Build or Take a seat there plays today's.

## Comments, data and support

- After a notable run the game shows the exact one-line comment it would post, with **Post as u/name** and **Write your own**. Nothing is posted until the player taps Post. Write your own opens a box in the game: their words go above the game's line and are posted as their own comment in the thread; without words of their own, the line goes under the pinned Scores comment. A comment about taking somebody's tower, or passing their score, is posted as a reply to that person's comment about it, when they made one. Either way it is theirs, posted from their account, and they can delete it; the game never shows what they wrote. A day on which a player posts counts toward their stones, once a day however many comments they post.
- Each day's post titles say how the day before ended in numbers only; the pinned comment names its best players, which notifies them.
- It stores each player's Reddit id and name, colour, runs, stone, their XP and today's orders, the days they have played and posted (for stones), whether they subscribed from the game, whether they wear the game's flair, what they won the day before, the flair they had before the game's (to give it back), whether they turned notifications on and their offset from UTC (so nothing is sent at night), and for relay seats their avatar. Player records expire 30 days after their last game, a day's map 14 days after that day, and a relay 14 days after it was last played. Deleted posts and comments are removed from its records. Nothing is sent outside Reddit.
- When a player is out of relay lives the game offers **Subscribe**, which subscribes them to the subreddit from their account. Only that tap does it, after Reddit asks the player's permission, and it does nothing else: a player it brings back takes their seat with a tap of their own.
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

To play and review changes without Devvit, `npm run play` serves the client on http://localhost:7474 against an in-memory mock of the server (`src/client/devServer/mockApi.ts`); add `?relay` to the URL for the relay post, where bots fill two crews and take turns. The mock has a few controls for looking at states on purpose: `/api/mock/map?live=0` opens the map as yesterday's post, which shows that day as it ended and plays today's from Build (`?live=1` back), `/api/mock/relay?old=1` does the same for the relay (`?old=0` back), `/api/mock/map?turn=1` moves the day on so a raise aimed on the old day is refused and re-aimed, `/api/mock/map?push=1` shows the notifications bell as it will be once Devvit grants the beta, `/api/mock/map?retake=1` makes your next take a retake, `/api/mock/map?pace=1` plays runs at the pace from before the tower swayed (`?pace=2` back), `/api/mock/relay?bots=14` seats more bots so crews fill and new towers start, `?miss=1` makes the next bot drop a miss (`&tower=N` for one on that tower), `?youmiss=1` makes your own next drop one, `/api/mock/map?stone=quartz` earns every stone and wears that one, `/api/mock/map?capstone=1` lets today's capstone fall again (`&gold=1` makes it gold, `&xp=N` sets your XP, `&orders=nearly` puts every order one short), and `/api/mock/relay?grow=N&on=K` grows only tower K. To see it at the size it ships at, `tools/shoot.mjs` drives that page in headless Chrome and saves screenshots -- a Reddit inline post on a phone is about 375 x 512 -- and can tap, switch scope, and play a run from a script. On a Mac it renders on the GPU, which is fast enough to capture an animation frame by frame. See the header of that file.

## Deployment Workflow

- `npm run build` — Compile client and server bundles
- `npm run deploy` — Build and upload the current version to Reddit
- `npm run launch` — Build, upload, and submit for publish review
- `npm run login` — Authenticate the Reddit CLI

What an upload sends to Reddit: every file in `dist/client`, unfiltered, as public web view assets, so anything in `src/client/public/` ships whether it is used or not; the server bundle and its source map, which stay private; `devvit.json`; and this README, as the app's About text. `devvit publish` also uploads a zip of the repository for review, minus `.gitignore` and the `sourceIgnores` in `devvit.json`.

The app icon is `branding/icon.png`, 1024 px, set as `marketingAssets.icon` in `devvit.json`. Reddit takes it when a publish is approved, so a new icon needs a new review. The same folder has the community icon, logo, banners and featuring assets, all rendered from the game by `tools/promo` (see `branding/README.md`).

## Analytics (Devvit Journeys)

`permissions.journeys` in `devvit.json` turns Journeys on; nothing else has to be requested (the docs still describe an allowlist, which is no longer required). `src/server/index.ts` mounts the SDK's router on `/api/telemetry/*`, and on the client `utils/journeys.ts` says what a journey is (with tests) while `utils/telemetry.ts` binds it to the page. Each response carries a receipt saying whether the event was recorded, and the first refusal of each kind on a page (rate limited, duplicate, invalid) is logged as `[journeys] ...`, so it shows in `devvit logs`. The numbers are on the app's Analytics tab in the developer portal, one row per UTC day. The journey map:

| Event                 | Map post: a run                                                                                                                                                                                                                                            | Relay post: a sitting                                                                                                                                                                                |
| --------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `App.Ready`           | The board has drawn with real data                                                                                                                                                                                                                         | The first tower state has arrived                                                                                                                                                                    |
| `Journey.Start`       | Build, a card's Take it / Beat it, or Again                                                                                                                                                                                                                | Take a seat, Join tower, or Start a new tower                                                                                                                                                        |
| `Journey.Progress`    | Tower height at 10, 25, 50, 80 and 120 blocks, 0.2 to 1.0 (`tower_height`)                                                                                                                                                                                 | Blocks the player has landed this sitting at 1, 3, 6, 10 and 15, 0.2 to 1.0 (`blocks_landed`)                                                                                                        |
| `Journey.Interaction` | `aim_beat`, `aim_take`, `aim_claim` (own, rival, open); `tower_raised` (keep, claim, stack, take); `tower_inspected` (own, ally, rival); `cell_inspected` (keep, land, road); `scope_changed` (mine, all); `faction_chosen` (colour); `brag_posted` (kind) | `relay_join` (joined, started); `brag_posted`                                                                                                                                                        |
| `Journey.End`         | Complete when the tower is raised onto the grid. Not complete when it is discarded, dropped for Again, not saved, or left with the page. `win`: passed the target, took the land, or a personal best. `score`: the run's score                             | Complete when the player's last life goes or the day tops out with them seated. Not complete when the seat is given up or the page is left. `win`: topped out still standing. `score`: blocks landed |

Starts are always a button, never a load or a view. Interactions fire on click, after the action has happened, and their details name a kind of thing, never a user and never a score. Events are sent one at a time, so each lands on the journey it belongs to; the journey id lives in memory, because nothing a journey stands for survives a reload and both posts can be open in one feed.

## Changelog

- 2026-10-21: The game's comments end on their link ("Took u/name's cell with 4,638. Your move: E7."), so a notification shows what happened instead of a URL.
- 2026-10-19: Relay: a fall heals the top back over the tower's base, so a tall tower no longer leans further with every fall. While you wait, the best turns on a colour's tower are marked beside the blocks they laid, with the builder's face, the blocks and the perfects in a row; your own best is always marked.
- 2026-10-19: XP and levels: raised towers earn XP, most for ground won from rivals, shown as your level beside your colour and in your flair. Three orders a day per colour, a daily capstone that falls on your first tower, and a relay tower per colour, racing, from the next day's relay.
- 2026-10-16: The offer to post about a run can be put away with its ×, and your colour opens over it.
- 2026-10-16: While you wait, the relay shows the top 100 blocks of a tall tower at their true size, or with **Whole** under its height the whole tower squashed to fit; it stretches back as your turn begins.
- 2026-10-16: Run blocks draw their edges on their faces, about two pixels wide with a darker band inside, so the block in hand and the top it lands on stay sharp however bright a streak makes them.
- 2026-10-16: From the next day's map, past block 195 a run's tower sways: blocks come in part way into their swing and a little off the beat, and can swing clean off a whole top, so the top speed has to be read rather than counted. A day already in play keeps the old pace.
- 2026-10-16: Relay turns are ten seconds of stacking, each block faster than the last, with streak words for perfects in a row; a miss ends the turn. Crews of four. Tall towers keep getting harder: the speed keeps climbing past block 320, and past block 500 the sweep can carry a block clean off the top. While you wait, the camera shows the whole tower with your blocks lit and counted.
- 2026-10-16: The map glows less, so a crowded quarter keeps its colours instead of washing out. A hand under zoom turns the view by dragging.
- 2026-10-15: Stones redrawn so they never make a drop harder to judge: nothing in them looks like an edge, no pixel noise, and a stone moves with its block instead of sliding through it. Tall towers on the map keep their colour instead of turning to white static.
- 2026-10-11: Colours gather round one keep. Only the first player of a colour each day is given a plot, and its keep is the colour's, safe for all of it to stack on; everyone else builds from their colour's ground. A tower raised on your colour's land stacks on top instead of toppling it, and a rival who beats the best tower in a stack takes the cell and brings the whole stack down. It starts with the next day's map; a day already in play keeps a plot each.
- 2026-10-08: Map and relay posts carry a Map or Relay flair, the game's older posts included.
- 2026-10-05: Every player wears the game's flair from their first game, and the day before's winners wear what they won until the next day's: the winning colour, the best tower, the most land and the most relay blocks. Taking it off gives back the flair you had.
- 2026-10-05: Relay: two lives a day, and one more for subscribing, instead of three and two more.
- 2026-10-03: The game's comments link to their tower: the cell's name, or the score when the line names no cell, opens the post on it.
- 2026-10-03: The music is played by the run: every block that lands plays a driven synth bass note of the chord the tower is on, with a metal clank, and a perfect adds a gritty note over it. Perfect streaks climb the chord and keep singing as they run long, each new streak name rings an extra note, an arpeggio comes in with a streak, and the chord moves on as the tower rises. No music files to download.
- 2026-10-03: The sound effects play on the music's instruments, in its room and on its chord: a milestone runs up the chord, a run ends on it, a relay fall comes down it. None is out of tune with the music or doubles it.
- 2026-10-03: Daily titles lead with the day before's best score and how the colours did; the pinned comment names its best players.
- 2026-10-03: Taking a tower replies to its builder's comment about it.
- 2026-10-03: Stones can be worn as subreddit flair, with your colour and streak.
- 2026-10-03: Push notifications for a taken tower and a streak about to end, behind an On/Off bell; off until Devvit grants the beta.
- 2026-10-02: Relay: out of lives? Subscribe to the subreddit from the game for two more lives a day.
- 2026-10-02: Posts open faster: the map is asked for while the game is still downloading, its towers are sent at a seventh of the size, and the game's script is 15% smaller.
- 2026-10-02: The colour picker no longer opens by itself on a first visit; the latest posts show above Build instead, and tapping your colour opens colours and stones.
- 2026-10-02: Relay: three lives a day instead of one miss and out.
- 2026-10-02: Stones: earn Marble, Slate, Crystal and more by playing days in a row and by posting about your runs; your blocks and towers wear the one you choose, in your colour. A land claim now offers the comment too.
- 2026-09-30: Tapping a line in the game's feed ("u/name 5,687 claimed E1") goes to that tower; its card offers the run against it.
- 2026-09-30: Sharing a run is one tap: the game's comment is a single line, shown above Build with Post and Write your own, instead of a paragraph behind a confirmation and an Edit button. Your own words are typed in the game and posted with the game's line under them.
- 2026-09-30: Your safe ground is a single cell instead of a 3x3, so the land round it can be claimed and taken. It starts with the next day's map; a day already in play keeps its 3x3.
- 2026-09-30: A run no longer re-renders the whole game on every frame, which made phones and laptops run hot.
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
