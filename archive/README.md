# Archive

Code, docs and assets removed from the live tree during the pre-pivot cleanup (2026-08-09).

Nothing here is compiled, linted, bundled or shipped. `archive/` sits outside every tsconfig
project, is listed in `eslint.config.js` `ignores`, and is in `.prettierignore`. Whole files were
moved with `git mv`, so `git log --follow` still works on each one.

**Everything in here was verified unreachable before it was moved** — traced from the two real
entrypoints (`src/client/main.tsx` and `src/server/index.ts`) plus `devvit.json`, not merely
"looked unused".

Files named `removed-*.ts` are excerpts lifted out of files that are still live. They are
**records, not modules** — they reference identifiers (`router`, `redis`, `this.KEYS`) that only
existed in their original scope, and will not compile on their own. That is intentional.

---

## `client/`

Unreferenced React components, hooks and utilities.

| Path | Why |
|---|---|
| `components/tower/TowerMap.tsx` | Standalone tower browser. Superseded by `InlineGridDisplay`. |
| `components/tower/TowerVisualization.tsx` | Only ever imported by `TowerMap`. |
| `components/game/InstancedTowerRenderer.tsx` | Superseded by `GPUInstancedTowerSystem`. |
| `components/effects/TronLegacyParticles.tsx` | Superseded by `FloatingParticles` / `TronClearDisintegration`. |
| `components/effects/TrimEffects.tsx` | Superseded by `GPUTrimEffects` in `GPUGameBlocks.tsx`. |
| `components/effects/PerfectPlacementGlow.tsx` | Never wired into the scene graph. |
| `components/system/GeometryBatcher.ts` | Sole survivor of the abandoned "animated data flow outlines" feature — see `docs/specs/`. |
| `components/system/AppStateMonitor.tsx` | Backgrounding-remount workaround, never mounted. |
| `components/audio/TowerAudioManager.ts` | Superseded by `AudioPlayer` / `MusicManager`. |
| `components/effects/FloatingParticles.tsx` | Its `<FloatingParticles>` JSX in `GameScene_Simple` was already commented out; only the leftover `import` kept it looking reachable. |
| `components/system/PerformanceConnector.tsx` | Existed solely to lift the three.js renderer into App state that nothing read. |
| `components/__tests__/ContinuousPathIntegration.test.ts` | Empty file (0 bytes). |
| `hooks/usePerfectDropEffect.ts` | Never called. |
| `hooks/usePostGameState.ts` | Post-game state lives inline in `App.tsx` instead. |
| `hooks/useScreenShake.ts` | Never called. |
| `simulation/SimulationLoader.ts` | Lazy-import wrapper; the simulation is imported directly. |
| `utils/fontLoader.ts` | FontFace-API loader. `index.css` `@font-face` does this instead. |
| `utils/webgpuRenderer.ts` | WebGL2 helper; its own header notes WebGPU wasn't viable on three r180. |
| `game.html` | Second HTML entrypoint. `vite.config.ts` only inputs `index.html`, and **both** `devvit.json` entrypoints (`default` and `game`) point at `index.html`. |
| `public/Orbitron/**` | The three font weights no `@font-face` rule declares, plus the variable font. |
| `removed-app-dead-code.tsx` | Dead handlers and state cut out of `App.tsx` / `GameUI.tsx`: the disabled replay-viewing mode, `TowerInfoPopup` / `GridReviewOverlay` / `TournamentResultModal` handlers, the never-wired camera-speed control, and four `useState` hooks that were written every render but never read. See the file header. |
| `components/ui/GridScreen.tsx` | The first post-pivot board: one screen for browsing and placing, built on `GPUInstancedTowerSystem`. Replaced by `components/board/` (2026-09-05), which draws the board in one instanced mesh, frames the camera per mode, and lets a tower be tapped. |
| `components/game/RegionOverlay.tsx` | Plot marker with a filled plate and corner brackets. Never wired in; `PlotPlatform` draws the boundary as a bare line instead. |
| `components/game/GPUInstancedTowerSystem.tsx` | The 1,800-line streaming tower renderer. Batched towers over many frames, grew blocks on a timer proportional to absolute height, and mounted its meshes lazily; on the board this showed as truncated and floating towers and, on some loads, nothing. Replaced by `components/board/BoardTowers.tsx` (2026-09-05): one instanced mesh built synchronously, with a short GPU build-in. |
| `components/tower/TowerCameraController.tsx` | Post-run camera that flew off to frame an overview of towers the game scene no longer held. The game scene now holds on the finished tower itself. |
| `components/effects/TronBackground.tsx` | The floor grid, drawn at full neon and 80% opacity, which bloom turned into a white haze at the horizon. Replaced by `components/board/BoardFloor.tsx`, shared by the board and the game. |
| `components/ui/TronHud.tsx`, `TronModalLogo.tsx`, `TowerCountDisplay.tsx`, `CycleScrubber.tsx`, `GameBalanceBar.tsx`, `ChunkLoadingIndicator.tsx`, `gameEndModal.css` | Pre-pivot HUD pieces that nothing imported any more once the shell was rebuilt. |
| `components/effects/TronClearDisintegration.tsx` | Trimmed-off pieces shown as a wireframe that then burst into particles and vanished. Replaced by `components/game/CutDebris.tsx` (2026-09-05): the cut piece is flung off, falls, and stays on the floor for the rest of the run. |
| `components/ui/TronArt.tsx` | The traced chrome artwork: chamfered panels with hatch marks, pill chips, double-outlined buttons, the split switch. Used as drawn for one iteration and judged ornamental over a board that is itself the ornament. Replaced by `components/ui/Chrome.tsx`: type, hairlines, one chamfered button. The icons moved to `components/ui/icons.tsx`. |

## `server/`

| Path | Why |
|---|---|
| `blocks/GameBlocks.tsx` | 798-line Devvit **Blocks** UI from before the webview migration. Imports `@devvit/public-api`, which is not a dependency of this project — it could not have built. |
| `removed-endpoints.ts` | 8 routes deleted from `src/server/index.ts`. See the file header for the per-route reason. |
| `removed-tournament-migration.ts` | `TournamentService.migrateGameSessionsToChallengeMode()` — one-shot backfill whose only caller was an endpoint Devvit could never invoke. |
| `removed-clear-all-towers.ts` | `GameDataService.clearAllTowers()` — near-duplicate of the still-live `clearAllGameData()`. |

## `shared/`

| Path | Why |
|---|---|
| `test/simulationTest.ts` | Ad-hoc determinism check. Not a vitest suite, no runner, no `test` script in `package.json`. |
| `test/perfectStackingTest.ts` | Same — its own comment says "run manually via ts-node". |
| `utils/gameDataConverter.ts` | Only consumer was the archived `TowerVisualization`. |
| `utils/noise.ts` | `valueNoise2`, imported only by the archived `FloatingParticles`. |
| `types/removed-api-types.ts` | `IncrementResponse`, `DecrementResponse`, `ClearTowersResponse` — typed only the removed routes. |

## `scripts/`

`test-block-spawning.js`, `test-simulation.js`, `test-tower-placement.js` — root-level scratch
scripts. `test-block-spawning.js` `require()`s `./dist/shared/simulation/index.js`, a path the
build has never produced (`build:server` emits a single `dist/server/index.cjs`), so it could not
have run in its committed state.

## `tools/`

| Path | Why |
|---|---|
| `convertFont.js` | TTF→three.js JSON converter that never worked: it emits placeholder JSON with an **empty `glyphs` object**, requires `opentype.js` (not a dependency), and writes to `src/client/public/fonts/`, which was never created. |
| `devvit-dotenv.js.broken-symlink` | A symlink **committed to git** pointing at an absolute path inside a local npx cache (`~/.npm/_npx/…`). Dangling on this machine and meaningless on any other. Nothing referenced it. |

## `docs/`

| Path | Why |
|---|---|
| `game-design-document.json` | GDD v4.0 (2025-10-29) for the stacking game. Kept as the pre-pivot design snapshot. |
| `test-score-verification.md` | Change note for one 2026-02 PR, written as a doc. The behaviour it describes is still live in `gameDataService.verifyGameReplay()`. |
| `components-README.md` | Was `src/client/components/README.md`. Indexed 8 components that are now in this archive, and described a structure that has since drifted. |
| `specs/animated-data-flow-outlines/` | Kiro spec. **Abandoned** — task 1 was never checked off and no implementation survives beyond `GeometryBatcher.ts`. |
| `specs/tron-game-end-modal/` | Kiro spec. Describes a `GameEndModal.tsx` that **never existed**; the feature shipped instead as `GameEndControls.tsx` + `gameEndModal.css`, so the spec never matched the code. |

## `assets/`

Six unreferenced GIFs, ~8.3 MB total — `tower.gif` (5.5 MB), `output_small.gif` (1.1 MB), and
four iterations of a loading animation (`loading.gif`, `_loading.gif`, `__loading.gif`,
`___loading.gif`). Nothing in `src/` or `devvit.json` referenced any of them, and their only
plausible consumer was the archived Blocks UI.

`assets/` is Devvit's `media.dir`, so the community icons, `Background.png` and the two SVG logos
were **deliberately left in place** — Devvit may surface them in the app listing.

---

## Restoring something

```bash
git mv archive/client/hooks/useScreenShake.ts src/client/hooks/
```

Then fix its relative imports: paths that were `../../shared/…` from `src/client/` are
`../../../shared/…` from `archive/client/`, and vice versa.

---

# The 2026-08-12 rebuild

The app layer was archived and rebuilt. The engine was not.

Recover the full pre-rebuild build with:

```bash
git checkout pre-rebuild-2026-08-12
```

**Why.** The shell had grown to ~2,000 lines holding a dozen independent view flags and two
competing placement systems. The decisive symptom: a change could be correct, compile, pass
tests, be fully reachable — and still have no visible effect, because an older path was quietly
still in charge. Towers were positioned by score rank and persisted *before* the player was
asked where to put them, while the cell they chose went to storage nothing rendered from.

**Kept, because none of it is affected by the pivot.** The deterministic simulation
(`shared/simulation`, fixed-point maths, PRNG, replay verification), the instanced renderer
(`GPUInstancedTowerSystem`, `GameScene`, `GPUGameBlocks`), the `tron-*` design system, and the
shared grid/region coordinate model. The pivot changes what happens to a tower *after* it is
built, not how one is built or drawn.

**Archived here.**

| Path | Why |
|---|---|
| `client/App.tsx` | The 2,166-line shell. Replaced by a small one. |
| `client/components/ui/InlineGridDisplay.tsx` | Community grid, superseded by `GridScreen`. |
| `client/components/ui/GameUI.tsx` | Start screen and HUD, tied to the retired flow. |
| `client/components/ui/{TournamentOverlay,EloLeaderboardOverlay,GameEndControls}.tsx` | Tournament and challenge UI. |
| `client/hooks/{useGameData,useTournament,useTowerPreloader,usePlacementMode}.ts` | Orchestration for retired flows. `useTowerPreloader` held the rank-based auto-placement. |
| `client/types/gameMode.ts` | A *view* mode type that shared the name `GameMode` with the actual game mode. Two different things with one name. |
| `server/core/{tournamentService,userFlairService}.ts` | Tournament, Elo, ghosts, matchmaking, flair sync. |

**Still live but not yet used by the new shell:** `TronHud`, `TowerCountDisplay`,
`GameBalanceBar`, `CycleScrubber`, `ChunkLoadingIndicator`, `TronModalLogo`, `GridViewControls`.
These are the visual language, kept deliberately for the shell to grow back into. They are
staged, not dead — if they are still unreferenced when the shell settles, archive them then.
