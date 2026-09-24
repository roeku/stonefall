import React from 'react';
import { Canvas } from '@react-three/fiber';
import { GameScene } from './components/game/GameScene_Simple';
import { BoardScene, type GridTarget } from './components/board/BoardScene';
import { BoardChrome, type BoardHint } from './components/board/BoardChrome';
import { CRUMBLE_MS, type Crumble } from './components/board/CrumblingTowers';
import type { Quake } from './components/board/BoardCamera';
import type { LandingRing } from './components/game/LandingRings';
import { DEFAULT_TOWER_GRID_SIZE } from '../shared/types/towerPlacement';
import { RunHud } from './components/ui/RunHud';
import { AudioPlayer } from './components/audio/AudioPlayer';
import { useGameState } from './hooks/useGameState';
import { useViewState, type AppView } from './hooks/useViewState';
import { useMe } from './hooks/useMe';
import { useBoard } from './hooks/useBoard';
import { useGridView, type GridScope } from './hooks/useGridView';
import { useSocial, type Target } from './hooks/useSocial';
import type { PlacedRun } from './components/ui/Social';
import type { BragKind, SaveRunResponse, TowerMapEntry } from '../shared/types/api';
import type { FactionId } from '../shared/types/factions';
import { factionTheme } from './constants/factions';
import { factionRgb } from '../shared/types/factions';
import { MAX_PLACEMENTS_PER_PLAYER } from '../shared/constants/towers';
import { MAX_STACK_PER_CELL } from '../shared/types/towerPlacement';
import {
  cellKey,
  cellKind,
  judgePlacement,
  type PlacementVerdict,
} from '../shared/types/territory';
import { cellToWorld, isGlobalCellInRegion } from '../shared/types/worldGrid';
import { stackTopAt } from './components/board/boardCells';
import { openPost } from './utils/postLink';
import { enableServerLogging } from './utils/serverLogger';
import { Telemetry } from './utils/telemetry';

enableServerLogging();

/**
 * Identifier for one run, made client-side.
 *
 * Its only job is to let a retried save be recognised as the same run rather than stored twice.
 * It carries no authority: the server looks up who is calling and what the inputs actually
 * scored, so a made-up id buys nothing.
 */
const newSessionId = (): string =>
  typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `run-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;

/**
 * How long the final score holds on screen before the board takes over, and how soon a tap is
 * allowed to cut that short. The hold is a beat, not a wait: long enough to read the number,
 * short enough that "one more" is never gated behind it.
 */
const RUN_END_HOLD_MS = 900;
const RUN_END_SKIP_MS = 500;

/**
 * How long a player waits for today's plot before the run starts anyway. Every player's first run
 * of the day asks for one, because the map starts over each day, so this has to be long enough
 * for a slow round trip: a run that started without its plot was built on the first plot ever
 * handed out, at the middle of the map, and then jumped when the answer came.
 */
const ENTER_WAIT_MS = 2500;

/** Most towers felled at once. More than this vanishing together is not a fight, it is a reset. */
const MAX_CRUMBLES = 24;

/** How often the whole map is re-read while it is on screen, so takes by others are seen. */
const MAP_POLL_MS = 45_000;

/**
 * Stonefall, the map post.
 *
 * Exactly one system owns each thing. The simulation owns gameplay, the board owns where towers
 * are and what the camera looks at, the server owns whether a placement is legal and the shared
 * rules in `territory.ts` are how the client predicts that answer before asking.
 *
 * The loop is: build a tower, raise it somewhere you can reach, hold it or lose it.
 */
export const App: React.FC = () => {
  const game = useGameState();
  const view = useViewState('grid');
  const me = useMe();
  const board = useBoard();
  // Camera state lives here because both the scene and the chrome need it: one turns it into a
  // camera, the other draws the buttons that change it.
  const gridView = useGridView('mine');
  const social = useSocial();

  /** The finished tower waiting to be raised. Null at every other moment. */
  const [pendingTower, setPendingTower] = React.useState<TowerMapEntry | null>(null);
  const [isPlacing, setIsPlacing] = React.useState(false);
  /** Cell the player has aimed at. Lifted here because both the scene and the chrome read it. */
  const [target, setTarget] = React.useState<GridTarget | null>(null);
  /** The tower the player tapped to look at. */
  const [selected, setSelected] = React.useState<TowerMapEntry | null>(null);
  /** The cell the player tapped to size up. */
  const [selectedCell, setSelectedCell] = React.useState<GridTarget | null>(null);
  /** The run that just went onto the grid, held for one beat so it can be announced. */
  const [placedRun, setPlacedRun] = React.useState<PlacedRun | null>(null);
  /** Towers coming down. Kept for a couple of seconds each. */
  const [crumbles, setCrumbles] = React.useState<Crumble[]>([]);
  /** The last jolt the board camera should feel. */
  const [quake, setQuake] = React.useState<Quake | null>(null);
  /**
   * Whether a run has happened this sitting. Until one has, the board camera arrives by
   * descending onto the player's plot; afterwards it inherits the run's camera and pulls back.
   */
  const [playedOnce, setPlayedOnce] = React.useState(false);
  /** Where the current run is built, fixed when it starts so a late answer cannot move it. */
  const [runOrigin, setRunOrigin] = React.useState(() => ({
    x: cellToWorld(0),
    z: cellToWorld(0),
  }));
  /** Shockwaves where a tower was just raised. */
  const [rings, setRings] = React.useState<LandingRing[]>([]);
  const [muted, setMuted] = React.useState(() => AudioPlayer.isMuted());
  const [entering, setEntering] = React.useState(false);
  /**
   * Whether the newcomer's colour card has been answered or waved past this sitting. Held here
   * rather than in the chrome because the chrome unmounts for every run, and a card that comes
   * back after each run is a nag.
   */
  const [colourAsked, setColourAsked] = React.useState(false);
  const [relayPostId, setRelayPostId] = React.useState<string | null>(null);

  /**
   * One line of transient feedback: a tap outside reach, a raise that landed.
   *
   * Transient rather than sticky: it answers one moment, and leaving it up would make the next
   * legitimate tap look like it had also failed.
   */
  const [hint, setHint] = React.useState<BoardHint | null>(null);
  const hintTimer = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const hintKey = React.useRef(0);
  const showHint = React.useCallback(
    (text: string, tone: BoardHint['tone'] = 'info', ms = 1700) => {
      hintKey.current += 1;
      setHint({ key: hintKey.current, text, tone });
      if (hintTimer.current) clearTimeout(hintTimer.current);
      hintTimer.current = setTimeout(() => setHint(null), ms);
    },
    []
  );
  React.useEffect(() => () => void (hintTimer.current && clearTimeout(hintTimer.current)), []);

  const travel = React.useCallback(
    (to: AppView, then?: () => void) => {
      then?.();
      view.goTo(to);
    },
    [view]
  );

  const colorTheme = React.useMemo(() => factionTheme(me.faction), [me.faction]);

  // Load the board once on mount. It is the landing screen, so this is the first thing a player
  // sees. The mute preference is read first so the first sound respects it.
  React.useEffect(() => {
    AudioPlayer.loadMutePreference();
    setMuted(AudioPlayer.isMuted());
    void board.refresh();
    void me.refresh();
    void social.refreshFeed();
    void fetch('/api/relay/today')
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { postId?: string | null } | null) => setRelayPostId(d?.postId ?? null))
      .catch(() => setRelayPostId(null));
    // Intentionally mount-only; refreshes are explicit.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // app.ready means drawn and touchable, not merely mounted, so it waits for the board's data.
  const readySent = React.useRef(false);
  React.useEffect(() => {
    if (readySent.current || !board.loaded || me.isLoading) return;
    readySent.current = true;
    Telemetry.appReady();
  }, [board.loaded, me.isLoading]);

  const isPlaying = view.is('playing');

  const mapLive = board.map?.live !== false;

  // The whole map is re-read every so often while it is on screen, because other people are
  // taking land in the meantime and a map that never changes is a picture. A closed map does not
  // change, so it is not re-read.
  React.useEffect(() => {
    if (isPlaying || gridView.scope !== 'all' || pendingTower || !mapLive) return;
    const t = setInterval(() => {
      if (typeof document !== 'undefined' && document.visibilityState !== 'visible') return;
      void board.refresh();
    }, MAP_POLL_MS);
    return () => clearInterval(t);
  }, [isPlaying, gridView.scope, pendingTower, board, mapLive]);

  /**
   * Bring towers down: crumble them, shake the ground under them, and sound it.
   *
   * `strength` is how hard the camera feels it: a take the player made or a switch they chose
   * is felt in full, a fall somebody else caused elsewhere on the map less so.
   */
  const crumbling = React.useRef(new Set<string>());
  const fell = React.useCallback((entries: readonly TowerMapEntry[], strength: number) => {
    const fresh = entries
      .filter((e) => !crumbling.current.has(e.sessionId) && e.worldX !== undefined)
      .slice(0, MAX_CRUMBLES);
    if (fresh.length === 0) return;
    const now = performance.now();
    for (const e of fresh) crumbling.current.add(e.sessionId);
    // Staggered a beat apart, so a row of towers goes over like a row rather than as one.
    const batch = fresh.map((entry, i) => ({
      key: `${entry.sessionId}-${now}`,
      entry,
      at: now + i * 70,
    }));
    const keys = new Set(batch.map((c) => c.key));
    setCrumbles((prev) => [...prev, ...batch]);
    setRings((prev) => [
      ...prev.slice(-6),
      ...fresh.slice(0, 3).map((e, i) => ({
        key: now + i + 0.5,
        x: e.worldX ?? 0,
        y: 0,
        z: e.worldZ ?? 0,
        width: DEFAULT_TOWER_GRID_SIZE * 1.3,
        depth: DEFAULT_TOWER_GRID_SIZE * 1.3,
        at: now + 180,
        perfect: true,
      })),
    ]);
    setQuake({ at: now + 150, strength });
    const tallest = Math.max(...fresh.map((e) => e.blockCount ?? e.towerBlocks.length ?? 0));
    AudioPlayer.playCrumble(Math.min(1, tallest / 300));
    setTimeout(
      () => {
        setCrumbles((prev) => prev.filter((c) => !keys.has(c.key)));
        for (const e of fresh) crumbling.current.delete(e.sessionId);
      },
      CRUMBLE_MS + fresh.length * 70 + 150
    );
  }, []);

  /**
   * Towers that were standing a moment ago and are not now have come down: taken from under
   * their owner, or lost when the owner changed sides. Fell them, whoever did the felling. A
   * different day's map arriving is not a fall, and neither is a whole board vanishing at once.
   */
  const lastTowers = React.useRef<{ day: string | null; towers: TowerMapEntry[] }>({
    day: null,
    towers: [],
  });
  /** The cell the player just raised on, so the tower they beat there is felt in full. */
  const justRaised = React.useRef<string | null>(null);
  React.useEffect(() => {
    const before = lastTowers.current;
    const after = board.towers;
    const day = board.map?.day ?? null;
    if (before.towers.length > 0 && before.day === day) {
      const alive = new Set(after.map((t) => t.sessionId));
      const gone = before.towers.filter(
        (t) => !alive.has(t.sessionId) && t.gridX !== undefined && t.gridZ !== undefined
      );
      if (gone.length > 0 && gone.length <= MAX_CRUMBLES) {
        const theirs = gone.some((t) => `${t.gridX},${t.gridZ}` === justRaised.current);
        fell(gone, theirs ? 1 : 0.6);
      }
      justRaised.current = null;
    }
    lastTowers.current = { day, towers: after };
  }, [board.towers, board.map?.day, fell]);

  const toggleMute = React.useCallback(() => {
    const next = !AudioPlayer.isMuted();
    AudioPlayer.setMuted(next);
    setMuted(next);
    AudioPlayer.unlock();
    if (!next) AudioPlayer.playTap(1.2);
  }, []);

  /** My towers standing in my keep, by cell, for the stack rule. */
  const keepStacks = React.useMemo(() => {
    const map = new Map<string, number>();
    for (const p of me.grid?.placements ?? []) {
      if ((p.kind ?? 'keep') !== 'keep') continue;
      const k = cellKey(p.gridX, p.gridZ);
      map.set(k, (map.get(k) ?? 0) + 1);
    }
    return map;
  }, [me.grid]);

  /** The rules, judged against what the board currently shows. Same function as the server. */
  const judge = React.useCallback(
    (x: number, z: number, score: number): PlacementVerdict =>
      judgePlacement({
        x,
        z,
        score,
        userId: me.userId ?? '',
        faction: me.faction,
        region: me.region ? { rx: me.region.rx, rz: me.region.rz } : null,
        holdings: board.holdings,
        keepStacks,
        maxStack: MAX_STACK_PER_CELL,
        standing: me.grid?.placements.length ?? 0,
        maxStanding: MAX_PLACEMENTS_PER_PLAYER,
      }),
    [me.userId, me.faction, me.region, me.grid, board.holdings, keepStacks]
  );

  const verdict = React.useMemo(
    () => (target && pendingTower ? judge(target.x, target.z, pendingTower.score) : null),
    [target, pendingTower, judge]
  );

  const startRun = React.useCallback(
    async (aim: Target | null) => {
      AudioPlayer.unlock();
      // A score of your own, taken from the chatter strip, is your own bar: say so rather than
      // treating you as your own rival.
      if (aim && aim.username && me.username && aim.username === me.username && !aim.own) {
        aim = { ...aim, own: true };
      }
      social.setTarget(aim);
      setPendingTower(null);
      setSelected(null);
      setSelectedCell(null);
      setTarget(null);
      setPlacedRun(null);
      // A player gets today's plot before their first run of the day, so the run is built where
      // the tower will stand. Bounded: a slow server is not allowed to make the button feel
      // broken, and the run keeps whatever origin it starts with.
      let region = me.region;
      if (!region && me.userId) {
        setEntering(true);
        region = await Promise.race([
          me.enter(),
          new Promise<null>((r) => setTimeout(() => r(null), ENTER_WAIT_MS)),
        ]);
        setEntering(false);
      }
      setRunOrigin(
        region
          ? { x: cellToWorld(region.centerX), z: cellToWorld(region.centerZ) }
          : { x: cellToWorld(0), z: cellToWorld(0) }
      );
      setPlayedOnce(true);
      Telemetry.runStarted();
      if (aim) Telemetry.did(`aim_${aim.kind}`, aim.own ? 'own' : aim.username ? 'rival' : 'open');
      travel('playing', () => game.startGame('rotating_block'));
    },
    [game, travel, me, social]
  );

  const myBestRef = React.useRef(0);
  const myCountRef = React.useRef(0);

  /**
   * A tower is standing. Announce it, sound it, and re-read the board so what is on screen is
   * what was actually stored.
   */
  const settle = React.useCallback(
    async (
      tower: TowerMapEntry,
      res: {
        kind?: 'keep' | 'claim' | 'take';
        took?: { userId?: string; username: string; score: number };
      },
      cell: GridTarget
    ) => {
      const aim = social.target;
      const beat =
        aim && aim.kind === 'beat' && aim.username && tower.score > aim.score ? aim : null;
      const onLand = cellKind(cell.x, cell.z) === 'land';
      setPlacedRun({
        sessionId: tower.sessionId,
        score: tower.score,
        blocks: tower.blockCount,
        perfectStreak: tower.perfectStreak,
        isBest: tower.score > myBestRef.current,
        isFirst: myCountRef.current === 0,
        ...(beat ? { passed: { username: beat.username!, score: beat.score } } : {}),
        // Toppling your own tower to stand a taller one there is a replace, not a take: there
        // is nobody to tell.
        ...(res.took && res.took.userId !== me.userId ? { took: res.took } : {}),
        ...(onLand ? { cell } : {}),
      });
      AudioPlayer.playRaise(res.kind ?? 'keep');
      // The ring lands on the cell the tower stands on, at the height it stands at.
      const at = performance.now();
      const base = res.kind === 'keep' ? (keepStacks.get(cellKey(cell.x, cell.z)) ?? 0) : 0;
      setRings((prev) => [
        ...prev.slice(-3),
        {
          key: at,
          x: cellToWorld(cell.x),
          y: base > 0 ? stackTopAt(board.towers, cell.x, cell.z) : 0,
          z: cellToWorld(cell.z),
          width: DEFAULT_TOWER_GRID_SIZE,
          depth: DEFAULT_TOWER_GRID_SIZE,
          at,
          perfect: res.kind === 'take',
        },
      ]);
      Telemetry.did('tower_raised', res.kind ?? 'keep');
      Telemetry.runEnded({
        placed: true,
        won: Boolean(beat) || Boolean(res.took) || tower.score > myBestRef.current,
        score: tower.score,
      });
      setPendingTower(null);
      setTarget(null);
      gridView.setScope(onLand ? 'all' : 'mine');
      justRaised.current = `${cell.x},${cell.z}`;
      await Promise.all([board.refresh(), me.refresh()]);
    },
    [social.target, gridView, board, me, keepStacks]
  );

  /**
   * A run has ended: save the tower, then raise it where it was aimed, or hand it to the board.
   *
   * No position is assigned here unless the run was aimed at a cell. The final score holds on
   * screen for a beat first -- the run deserves a moment before the next question is asked.
   */
  const finishRun = React.useCallback(async () => {
    const state = game.gameState;
    if (!state) return;

    // A tap after the first half-second ends the hold early. Captured on the window so it
    // runs before the canvas listener, which ignores drops once the run is over anyway.
    const hold = new Promise<void>((resolve) => {
      const started = performance.now();
      const done = () => {
        clearTimeout(timer);
        window.removeEventListener('pointerdown', onTap, true);
        resolve();
      };
      const onTap = () => {
        if (performance.now() - started >= RUN_END_SKIP_MS) done();
      };
      const timer = setTimeout(done, RUN_END_HOLD_MS);
      window.addEventListener('pointerdown', onTap, true);
    });

    // The request says what was played, never what it was worth: a seed and the taps. The server
    // replays them through the same deterministic simulation and works out the score, the block
    // count and the geometry itself. That is the whole anti-cheat.
    const sessionId = newSessionId();
    let data: SaveRunResponse | null = null;
    try {
      const res = await fetch('/api/game/save-run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sessionId,
          seed: state.seed,
          gameMode: game.gameMode,
          inputs: game.takeRecordedInputs(),
        }),
      });
      data = (await res.json()) as SaveRunResponse;
      if (!res.ok || !data.success) data = null;
    } catch {
      data = null;
    }

    await hold;

    if (!data) {
      // Nothing to raise, so the run is over here; left open, the next run would inherit it.
      Telemetry.runEnded({ placed: false, won: false, score: state.score });
      travel('grid', () => showHint('Run not saved. Try again.', 'alert', 2600));
      return;
    }

    const tower: TowerMapEntry = {
      sessionId: data.sessionId ?? sessionId,
      userId: me.userId ?? '',
      username: me.username ?? '',
      score: data.score ?? 0,
      blockCount: data.blockCount ?? 0,
      perfectStreak: data.perfectCount ?? 0,
      gameMode: game.gameMode,
      timestamp: Date.now(),
      towerBlocks: data.towerBlocks ?? [],
      faction: data.faction ?? me.faction,
    };

    setSelected(null);
    setSelectedCell(null);

    // Aimed at a cell: raise it there without asking, if it can be.
    const aim = social.target;
    if (aim && aim.cell && (aim.kind === 'claim' || tower.score > aim.score)) {
      setIsPlacing(true);
      const res = await me.raise(tower.sessionId, aim.cell.x, aim.cell.z);
      setIsPlacing(false);
      if (res.success) {
        travel('grid');
        await settle(tower, res, aim.cell);
        return;
      }
      // Somebody moved first, or the bar rose. Say so and let the tower be raised elsewhere.
      travel('grid', () => showHint(res.message ?? 'Could not take it.', 'alert', 2800));
    } else if (aim && aim.cell) {
      travel('grid', () =>
        showHint(`Short of ${aim.score.toLocaleString()}. Raise it somewhere else.`, 'alert', 2800)
      );
    } else {
      travel('grid');
    }
    setTarget(null);
    setPendingTower(tower);
  }, [game, me, social.target, travel, showHint, settle]);

  // A run ends exactly once, on the transition into game-over.
  const wasGameOver = React.useRef(false);
  React.useEffect(() => {
    const isOver = game.gameState?.isGameOver === true;
    if (isOver && !wasGameOver.current) {
      void finishRun();
    }
    wasGameOver.current = isOver;
  }, [game.gameState?.isGameOver, finishRun]);

  // Height milestones, reported as the tower grows rather than at the end, so a run that is
  // never raised still says how far it got.
  React.useEffect(() => {
    const blocks = game.gameState?.blocks.length ?? 0;
    if (blocks > 1) Telemetry.runProgress(blocks);
  }, [game.gameState?.blocks.length]);

  const placeTower = React.useCallback(
    async (gridX: number, gridZ: number) => {
      if (!pendingTower) return;
      setIsPlacing(true);
      try {
        const res = await me.raise(pendingTower.sessionId, gridX, gridZ);
        if (res.success) {
          await settle(pendingTower, res, { x: gridX, z: gridZ });
        } else if (res.message) {
          showHint(res.message, 'alert', 2400);
        }
      } finally {
        setIsPlacing(false);
      }
    },
    [pendingTower, me, settle, showHint]
  );

  const onBrag = React.useCallback(
    async (kind: BragKind) => {
      if (!placedRun) return;
      const named = placedRun.took ?? placedRun.passed;
      const result = await social.brag({
        sessionId: placedRun.sessionId,
        kind,
        passedUsername: named?.username,
        passedScore: named?.score,
        cell: placedRun.cell,
      });
      setPlacedRun(null);
      if (result.ok) Telemetry.did('brag_posted', kind);
      showHint(
        result.ok ? 'Posted to the thread' : (result.message ?? 'Could not post that'),
        result.ok ? 'good' : 'alert',
        2400
      );
      if (result.ok) social.setTarget(null);
    },
    [placedRun, social, showHint]
  );

  const setScope = React.useCallback(
    (scope: GridScope) => {
      setSelected(null);
      setSelectedCell(null);
      AudioPlayer.playTap(0.9);
      Telemetry.did('scope_changed', scope);
      gridView.setScope(scope);
    },
    [gridView]
  );
  const scopedView = React.useMemo(() => ({ ...gridView, setScope }), [gridView, setScope]);

  const selectTower = React.useCallback(
    (tower: TowerMapEntry | null) => {
      if (tower) {
        Telemetry.did(
          'tower_inspected',
          tower.userId === me.userId
            ? 'own'
            : me.faction && tower.faction === me.faction
              ? 'ally'
              : 'rival'
        );
        AudioPlayer.playTap(1.1);
      }
      setSelected(tower);
      if (tower) setSelectedCell(null);
      // The camera fits whatever is selected; a stale zoom would fight that.
      gridView.resetZoom();
    },
    [gridView, me.userId, me.faction]
  );

  const selectCell = React.useCallback(
    (cell: GridTarget | null) => {
      if (cell) {
        Telemetry.did('cell_inspected', cellKind(cell.x, cell.z));
        AudioPlayer.playTap(1);
      }
      setSelectedCell(cell);
      if (cell) setSelected(null);
      gridView.resetZoom();
    },
    [gridView]
  );

  /**
   * Towers for the current scope.
   *
   * Filtered by region membership rather than fetched separately, so there is one source of
   * truth for what stands where. Raising always shows everything, because reach goes past the
   * plot and you cannot aim at a cell you are not looking at.
   */
  const mine = React.useMemo(() => {
    const region = me.region;
    if (!region) return [];
    return board.towers.filter(
      (t) =>
        t.gridX !== undefined &&
        t.gridZ !== undefined &&
        (t.userId === me.userId ||
          isGlobalCellInRegion(region.centerX, region.centerZ, t.gridX, t.gridZ))
    );
  }, [board.towers, me.region, me.userId]);

  const onlyMine = gridView.scope === 'mine' && pendingTower === null;
  // A tower coming down is drawn by the crumble, not stood up again by the board.
  const crumblingIds = React.useMemo(
    () => new Set(crumbles.map((c) => c.entry.sessionId)),
    [crumbles]
  );
  const visibleTowers = React.useMemo(() => {
    const scoped = onlyMine ? (me.region ? mine : []) : board.towers;
    return crumblingIds.size === 0 ? scoped : scoped.filter((t) => !crumblingIds.has(t.sessionId));
  }, [onlyMine, me.region, mine, board.towers, crumblingIds]);

  // Nothing to see on Mine before a plot exists, so a newcomer lands on the map instead.
  const landed = React.useRef(false);
  React.useEffect(() => {
    if (landed.current || me.isLoading) return;
    landed.current = true;
    if (!me.region) gridView.setScope('all');
  }, [me.isLoading, me.region, gridView]);
  const myBest = React.useMemo(
    () =>
      board.towers.reduce(
        (best, t) => (t.userId === me.userId ? Math.max(best, t.score) : best),
        0
      ),
    [board.towers, me.userId]
  );
  const myCount = React.useMemo(
    () => board.towers.filter((t) => t.userId === me.userId).length,
    [board.towers, me.userId]
  );
  React.useEffect(() => {
    myBestRef.current = myBest;
    myCountRef.current = myCount;
  }, [myBest, myCount]);

  const goToRelay = React.useMemo(
    () => (relayPostId ? () => openPost(relayPostId) : null),
    [relayPostId]
  );

  const goToToday = React.useMemo(
    () => (board.map?.todayPostId ? () => openPost(board.map!.todayPostId!) : null),
    [board.map]
  );

  /**
   * Change sides. What was standing under the old colour comes down on the spot, felled in front
   * of the player who chose it, and the board is re-read behind it.
   */
  const onSetFaction = React.useCallback(
    (f: FactionId) => {
      AudioPlayer.unlock();
      AudioPlayer.playTap(1.4);
      Telemetry.did('faction_chosen', f);
      void me.setFaction(f).then(({ ok, razed }) => {
        if (!ok) {
          showHint('Could not change colour. Try again.', 'alert', 2400);
          return;
        }
        if (razed.length > 0) {
          const ids = new Set(razed);
          fell(
            board.towers.filter((t) => ids.has(t.sessionId)),
            0.9
          );
          showHint(
            `${razed.length === 1 ? 'Your tower is' : `All ${razed.length} of your towers are`} down.`,
            'alert',
            2600
          );
        }
        void board.refresh();
      });
    },
    [me, board, fell, showHint]
  );

  /** Where the run in progress would stand on the map, for the run-end beat. */
  const runRank = React.useMemo(() => {
    const s = game.gameState?.score ?? 0;
    let ahead = 0;
    for (const t of board.towers) if (t.score > s) ahead += 1;
    return { n: ahead + 1, of: board.towers.length + 1 };
  }, [game.gameState?.score, board.towers]);

  const onAgain = React.useCallback(() => {
    if (pendingTower) {
      Telemetry.runEnded({ placed: false, won: false, score: pendingTower.score });
    }
    void startRun(social.target?.cell ? social.target : null);
  }, [pendingTower, startRun, social.target]);

  return (
    <div
      // No click handler here. useGameState already attaches a `pointerdown` listener to the
      // element marked data-game-canvas, and that is the better path: it fires on press rather
      // than release, and calls preventDefault so a tap cannot also scroll or select.
      style={{
        position: 'fixed',
        inset: 0,
        width: '100%',
        height: '100%',
        background: '#000814',
        // The chrome is lit in the viewer's colour: every rim, fill and glow reads this.
        ['--accent-rgb' as string]: factionRgb(me.faction),
      }}
    >
      {/* A single Canvas for the entire app. Contents swap inside one WebGL context. */}
      <Canvas
        dpr={[0.7, 1.5]}
        data-game-canvas="true"
        style={{ position: 'absolute', inset: 0 }}
        camera={{ position: [70, 55, 70], fov: 30, near: 1, far: 12000 }}
        gl={{ antialias: false, alpha: false, powerPreference: 'high-performance' }}
        // A tap on nothing -- the sky, past the edge of the floor -- puts the tapped thing down.
        onPointerMissed={() => {
          if (isPlaying || pendingTower) return;
          if (selected) selectTower(null);
          else if (selectedCell) selectCell(null);
        }}
      >
        <color attach="background" args={['#000814']} />

        {isPlaying ? (
          <GameScene
            gameState={game.gameState}
            gameMode={game.gameMode}
            isPlaying={game.isPlaying}
            stepSimulationFrame={() => {
              game.stepSimulationFrame();
            }}
            playerColorTheme={colorTheme}
            originX={runOrigin.x}
            originZ={runOrigin.z}
          />
        ) : (
          <BoardScene
            towers={visibleTowers}
            holdings={board.holdings}
            viewer={{ userId: me.userId, faction: me.faction, region: me.region }}
            pendingTower={pendingTower}
            isPlacing={isPlacing}
            target={target}
            onTarget={setTarget}
            onPlace={placeTower}
            onHint={(text) => showHint(text, 'alert')}
            judge={judge}
            selected={selected}
            onSelect={selectTower}
            selectedCell={selectedCell}
            onSelectCell={selectCell}
            view={scopedView}
            crumbles={crumbles}
            quake={quake}
            rings={rings}
            ready={board.loaded && !me.isLoading}
            entrance={!playedOnce}
            live={mapLive}
          />
        )}
      </Canvas>

      {isPlaying && game.gameState && (
        <RunHud
          score={game.gameState.score}
          combo={game.gameState.combo}
          perfectCount={game.gameState.perfectBlockCount}
          blockCount={game.gameState.blocks.length}
          over={game.gameState.isGameOver}
          target={social.target}
          myBest={myBest}
          myTowers={myCount}
          rank={runRank}
        />
      )}

      {!isPlaying && (
        <BoardChrome
          towers={visibleTowers}
          allTowers={board.towers}
          holdings={board.holdings}
          isLoading={!board.loaded || me.isLoading}
          pendingTower={pendingTower}
          isPlacing={isPlacing || entering}
          error={me.error}
          target={target}
          verdict={verdict}
          hint={hint}
          view={scopedView}
          selected={selected}
          selectedCell={selectedCell}
          brags={social.feed}
          placedRun={placedRun}
          isPosting={social.isPosting}
          me={{ userId: me.userId, faction: me.faction, chosen: me.chosen, region: me.region }}
          myBest={myBest}
          muted={muted}
          colourAsked={colourAsked}
          onColourAsked={() => setColourAsked(true)}
          judge={judge}
          onToggleMute={toggleMute}
          onSetFaction={onSetFaction}
          onAim={(aim) => void startRun(aim)}
          onBrag={onBrag}
          onDismissBrag={() => setPlacedRun(null)}
          onDeselect={() => selectTower(null)}
          onDeselectCell={() => selectCell(null)}
          onConfirmPlacement={() => {
            if (target && verdict?.ok) void placeTower(target.x, target.z);
          }}
          onDiscard={() => {
            // A run abandoned before it is raised is the drop-off the dashboard needs to see.
            Telemetry.runEnded({ placed: false, won: false, score: pendingTower?.score ?? 0 });
            setPendingTower(null);
            setTarget(null);
            social.setTarget(null);
          }}
          onAgain={onAgain}
          onPlay={() => void startRun(null)}
          onRelay={goToRelay}
          map={board.map}
          onToday={goToToday}
          entering={entering}
        />
      )}
    </div>
  );
};
