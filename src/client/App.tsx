import React from 'react';
import { Canvas } from '@react-three/fiber';
import { GameScene } from './components/game/GameScene_Simple';
import { BoardScene, type GridTarget } from './components/board/BoardScene';
import { BoardChrome, type BoardHint } from './components/board/BoardChrome';
import { CRUMBLE_MS, type Crumble } from './components/board/CrumblingTowers';
import type { Quake } from './components/board/BoardCamera';
import type { LandingRing } from './components/game/LandingRings';
import type { RunPass } from './components/game/PassRings';
import { DEFAULT_TOWER_GRID_SIZE } from '../shared/types/towerPlacement';
import { RunHud } from './components/ui/RunHud';
import { AudioPlayer } from './components/audio/AudioPlayer';
import { useGameState } from './hooks/useGameState';
import { useViewState, type AppView } from './hooks/useViewState';
import { useMe } from './hooks/useMe';
import { useBoard } from './hooks/useBoard';
import { useGridView, type GridScope } from './hooks/useGridView';
import { useSocial, type Target } from './hooks/useSocial';
import { commentFor, type PlacedRun } from './components/ui/placedRun';
import type { PlayerRegion, SaveRunResponse, TowerMapEntry } from '../shared/types/api';
import type { FactionId } from '../shared/types/factions';
import { factionTheme } from './constants/factions';
import { factionHex, factionRgb } from '../shared/types/factions';
import { MAX_PLACEMENTS_PER_PLAYER } from '../shared/constants/towers';
import { MAX_STACK_PER_CELL } from '../shared/types/towerPlacement';
import {
  KEEP_RADIUS,
  cellKey,
  cellKind,
  judgePlacement,
  type Holdings,
  type PlacementVerdict,
} from '../shared/types/territory';
import {
  REGION_RADIUS,
  cellName,
  cellToWorld,
  isGlobalCellInRegion,
} from '../shared/types/worldGrid';
import { countByCell, openingCellFor, stackTopAt } from './components/board/boardCells';
import { cellBrief, towerBrief } from './components/board/briefs';
import { RAISE_MARK_MS, type RaiseMark } from './components/board/RaiseMarks';
import { towerBox } from './components/board/boardInstancing';
import { compressHeight } from './components/board/rimMaterial';
import { openPost } from './utils/postLink';
import { enableServerLogging } from './utils/serverLogger';
import { Telemetry } from './utils/telemetry';
import { shortDay } from './utils/days';
import { dayResult } from './utils/dayResult';
import { aimFor, chaseLadder, standingOf } from './utils/stakes';
import { askToSignIn, editComment, mayPostAsUser } from './utils/platform';
import { commentDraft } from '../shared/social/comments';
import { dropKeptRun, keepRun, readKeptRun, type KeptRun } from './utils/keptRun';

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
 * How long the end of a run holds before the board takes over, and how soon a tap may cut it
 * short. The first 400 ms are the fall itself, which nothing interrupts; then the result comes
 * in (RunHud staggers it) and is left up long enough to read. Any tap after the fall skips the
 * rest, so "one more" is never gated behind it.
 */
const RUN_END_HOLD_MS = 2400;
const RUN_END_SKIP_MS = 400;

/** How long an older post says when it went up, on opening. */
const POST_DAY_HINT_MS = 4200;

/**
 * How long a player waits for today's plot before the run starts anyway. Every player's first run
 * of the day asks for one, because the map starts over each day, so this has to be long enough
 * for a slow round trip: a run that started without its plot was built on the first plot ever
 * handed out, at the middle of the map, and then jumped when the answer came.
 */
const ENTER_WAIT_MS = 2500;

/** Most towers felled at once. More than this vanishing together is not a fight, it is a reset. */
const MAX_CRUMBLES = 24;
/** Between one tower of a group starting to come down and the next, ms. */
const CRUMBLE_STAGGER_MS = 160;

/** How often the whole map is re-read while it is on screen, so takes by others are seen. */
const MAP_POLL_MS = 45_000;

/** Gold, for the player's own best wherever the world marks it. Matches --best in the CSS. */
const BEST_HEX = '#ffd166';
/** The chrome's white, for a mark that is nobody's colour. Matches --ink in the CSS. */
const INK_HEX = '#f3f7fa';
/** How long the side says where the colour climbed from, ms. */
const CLIMB_MS = 3400;

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
  /**
   * Whether the target came from the player's own tap, or is the default the placement screen
   * opened on. The chrome says "tap again" only after a tap.
   */
  const [aimedByTap, setAimedByTap] = React.useState(false);
  /** "+1" marks floating over cells just won, in world space. */
  const [marks, setMarks] = React.useState<RaiseMark[]>([]);
  /** Bumped when the viewer's colour gains ground, so its place and count can pop. */
  const [standingsPulse, setStandingsPulse] = React.useState(0);
  /** The colour just climbed: the place it climbed from, said under the side for a moment. */
  const [climb, setClimb] = React.useState<{ from: number; key: number } | null>(null);
  React.useEffect(() => {
    if (!climb) return;
    const t = setTimeout(() => setClimb(null), CLIMB_MS);
    return () => clearTimeout(t);
  }, [climb]);
  /** The tower the player tapped to look at. */
  const [selected, setSelected] = React.useState<TowerMapEntry | null>(null);
  /** The cell the player tapped to size up. */
  const [selectedCell, setSelectedCell] = React.useState<GridTarget | null>(null);
  /** The run that just went onto the grid, held for one beat so it can be announced. */
  const [placedRun, setPlacedRun] = React.useState<PlacedRun | null>(null);
  /** The score of a run played signed out and kept for after signing in (utils/keptRun). */
  const [keptScore, setKeptScore] = React.useState<number | null>(null);
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
  /**
   * The bars the current run is shown, lowest first: every rival hold in reach, and the player's
   * own best among them. Passing one puts the next one up under the score.
   */
  const [ladder, setLadder] = React.useState<Target[]>([]);
  /** The bars passed so far this run, each pinned to the block that passed it. */
  const [passes, setPasses] = React.useState<RunPass[]>([]);
  /** Which rungs of the ladder have been passed, by index, so each is said once. */
  const passedRungs = React.useRef(new Set<number>());
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
    const picked = entries
      .filter((e) => !crumbling.current.has(e.sessionId) && e.worldX !== undefined)
      .slice(0, MAX_CRUMBLES);
    if (picked.length === 0) return;
    // A cell's stacked towers come down together as one column: felled one at a time, the
    // upper ones were left standing on nothing while they waited their turn.
    const cells = new Map<string, TowerMapEntry[]>();
    for (const e of picked) {
      const k = `${e.worldX},${e.worldZ}`;
      cells.set(k, [...(cells.get(k) ?? []), e]);
    }
    // The tallest first, then the rest outward from it a beat apart: a player's whole holding
    // comes down as one spreading wave that starts with the thing they will be looking at,
    // rather than all at once, or in whatever order the board listed it.
    const size = (g: readonly TowerMapEntry[]) => g.reduce((n, e) => n + e.blockCount, 0);
    const groups = [...cells.values()].sort((a, b) => size(b) - size(a));
    const first = groups[0]![0]!;
    const away = (g: readonly TowerMapEntry[]) =>
      Math.hypot(
        (g[0]!.worldX ?? 0) - (first.worldX ?? 0),
        (g[0]!.worldZ ?? 0) - (first.worldZ ?? 0)
      );
    groups.sort((a, b) => away(a) - away(b));
    const now = performance.now();
    for (const e of picked) crumbling.current.add(e.sessionId);
    const batch: Crumble[] = groups.map((group, i) => ({
      key: `${group[0]!.sessionId}-${now}`,
      entries: group,
      at: now + i * CRUMBLE_STAGGER_MS,
    }));
    const keys = new Set(batch.map((c) => c.key));
    setCrumbles((prev) => [...prev, ...batch]);
    setRings((prev) => [
      ...prev.slice(-6),
      ...batch.slice(0, 3).map((c, i) => ({
        key: now + i + 0.5,
        x: c.entries[0]!.worldX ?? 0,
        y: 0,
        z: c.entries[0]!.worldZ ?? 0,
        width: DEFAULT_TOWER_GRID_SIZE * 1.3,
        depth: DEFAULT_TOWER_GRID_SIZE * 1.3,
        at: c.at + 180,
        perfect: true,
      })),
    ]);
    setQuake({ at: now + 150, strength });
    const tallest = size(groups[0]!);
    AudioPlayer.playCrumble(Math.min(1, tallest / 300));
    setTimeout(
      () => {
        setCrumbles((prev) => prev.filter((c) => !keys.has(c.key)));
        for (const e of picked) crumbling.current.delete(e.sessionId);
      },
      CRUMBLE_MS + batch.length * CRUMBLE_STAGGER_MS + 400
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
  /**
   * Whether a run is on screen. The board can be re-read during one (the end of a run refreshes
   * it, and Again raises straight into the next run), and a tower felled then is felled off
   * screen: it is simply gone when the board comes back, rather than rumbling under the run.
   */
  const playingRef = React.useRef(false);
  React.useEffect(() => {
    playingRef.current = isPlaying;
  }, [isPlaying]);
  React.useEffect(() => {
    const before = lastTowers.current;
    const after = board.towers;
    const day = board.map?.day ?? null;
    if (before.towers.length > 0 && before.day === day && !playingRef.current) {
      const alive = new Set(after.map((t) => t.sessionId));
      const gone = before.towers.filter(
        (t) => !alive.has(t.sessionId) && t.gridX !== undefined && t.gridZ !== undefined
      );
      if (gone.length > 0 && gone.length <= MAX_CRUMBLES) {
        const theirs = gone.some((t) => `${t.gridX},${t.gridZ}` === justRaised.current);
        fell(gone, theirs ? 1 : 0.6);
        // Land of yours taken while you watch: say who did it, since a tower coming down with
        // no name on it is just weather.
        const lost = theirs ? undefined : gone.find((t) => t.userId === me.userId);
        const taker = lost
          ? after.find(
              (t) => t.gridX === lost.gridX && t.gridZ === lost.gridZ && t.userId !== me.userId
            )
          : undefined;
        if (lost && taker && lost.gridX !== undefined && lost.gridZ !== undefined) {
          showHint(
            `u/${taker.username} took ${cellName(lost.gridX, lost.gridZ)} from you`,
            'alert',
            3200
          );
        }
      }
      justRaised.current = null;
    }
    lastTowers.current = { day, towers: after };
  }, [board.towers, board.map?.day, fell, me.userId, showHint]);

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

  /**
   * The rules, judged against what the board currently shows. Same function as the server.
   *
   * Built for a given plot and board, because the first run of the day asks for the plot, and a
   * run started from an older post asks for today's board, and both need the rules before the
   * answer has reached state.
   */
  const rulesFor = React.useCallback(
    (region: { rx: number; rz: number } | null, holdings: Holdings = board.holdings) =>
      (x: number, z: number, score: number): PlacementVerdict =>
        judgePlacement({
          x,
          z,
          score,
          userId: me.userId ?? '',
          faction: me.faction,
          region,
          holdings,
          keepStacks,
          maxStack: MAX_STACK_PER_CELL,
          standing: me.grid?.placements.length ?? 0,
          maxStanding: MAX_PLACEMENTS_PER_PLAYER,
        }),
    [me.userId, me.faction, me.grid, board.holdings, keepStacks]
  );
  const judge = React.useMemo(
    () => rulesFor(me.region ? { rx: me.region.rx, rz: me.region.rz } : null),
    [rulesFor, me.region]
  );

  const verdict = React.useMemo(
    () => (target && pendingTower ? judge(target.x, target.z, pendingTower.score) : null),
    [target, pendingTower, judge]
  );

  /** A cell the player tapped while placing. Only a tap earns "tap again" in the chrome. */
  const aimByTap = React.useCallback((cell: GridTarget) => {
    setTarget(cell);
    setAimedByTap(true);
  }, []);

  // Marks are CSS animations: once one has played out it is dropped, so a board that remounts
  // after a run does not play it again.
  React.useEffect(() => {
    if (marks.length === 0) return;
    const t = setTimeout(() => {
      const now = performance.now();
      setMarks((prev) => prev.filter((m) => now - m.key < RAISE_MARK_MS));
    }, RAISE_MARK_MS);
    return () => clearTimeout(t);
  }, [marks]);

  /** The keep cell placement falls back to: the centre, then the first with room. */
  const keepCell = React.useMemo(
    () =>
      me.region
        ? openingCellFor(
            { centerX: me.region.centerX, centerZ: me.region.centerZ, radius: KEEP_RADIUS },
            countByCell(board.towers),
            MAX_STACK_PER_CELL
          )
        : null,
    [me.region, board.towers]
  );

  const myBestRef = React.useRef(0);
  const myCountRef = React.useRef(0);

  const startRun = React.useCallback(
    async (aim: Target | null, opts: { skip?: GridTarget | null } = {}) => {
      AudioPlayer.unlock();
      // A score of your own, taken from the chatter strip, is your own bar: say so rather than
      // treating you as your own rival.
      if (aim && aim.username && me.username && aim.username === me.username && !aim.own) {
        aim = { ...aim, own: true };
      }
      setPendingTower(null);
      setSelected(null);
      setSelectedCell(null);
      setTarget(null);
      setAimedByTap(false);
      setPlacedRun(null);
      // A mark left mounted would float again when the board comes back after the run.
      setMarks([]);
      // A run is on today's map, whatever the post was showing: from here on it reads today's.
      // An older post fetches today's board before the run, so the run chases today's bars
      // rather than the ones its day ended on, and so does a player's first run of the day with
      // their plot, so the run is built where the tower will stand. Both are bounded: a slow
      // server is not allowed to make the button feel broken, and the run keeps whatever origin
      // it starts with.
      board.followLive();
      let region = me.region;
      let holdings = board.holdings;
      let best = myBestRef.current;
      const needPlot = !region && !!me.userId;
      // Before the first read has answered, the board on screen is not known to be today's.
      const needToday = !mapLive || !board.loaded;
      if (needPlot || needToday) {
        setEntering(true);
        const late = new Promise<null>((r) => setTimeout(() => r(null), ENTER_WAIT_MS));
        const [plot, today] = await Promise.all([
          needPlot ? Promise.race([me.enter(), late]) : region,
          needToday ? Promise.race([board.refresh(), late]) : null,
        ]);
        setEntering(false);
        region = plot;
        if (needToday) {
          holdings = today?.holdings ?? { keeps: [], land: [] };
          best = (today?.towers ?? []).reduce(
            (b, t) => (t.userId === me.userId ? Math.max(b, t.score) : b),
            0
          );
        }
      }
      // A run nobody aimed still gets something to pass: every rival bar in reach, lowest first,
      // with the player's own best among them. The lowest rival is what the run is for until it
      // passes somebody higher; it is shown during the run and offered afterwards, never raised
      // on by itself.
      let chase: Target | null = aim;
      let rungs: Target[] = aim ? [aim] : [];
      if (!chase) {
        const home = region ? { x: region.centerX, z: region.centerZ } : null;
        const rules = rulesFor(region ? { rx: region.rx, rz: region.rz } : null, holdings);
        rungs = chaseLadder(
          holdings,
          rules,
          { userId: me.userId, faction: me.faction },
          home,
          opts.skip
        ).map(
          (h): Target => ({
            kind: 'take',
            username: h.username,
            faction: h.faction ?? undefined,
            score: h.score,
            cell: { x: h.x, z: h.z },
            auto: true,
          })
        );
        if (best > 0) rungs.push({ kind: 'beat', score: best, own: true, auto: true });
        rungs.sort((a, b) => a.score - b.score);
        chase = rungs.find((r) => !r.own) ?? rungs[0] ?? null;
      }
      setLadder(rungs);
      setPasses([]);
      passedRungs.current = new Set();
      social.setTarget(chase);
      setRunOrigin(
        region
          ? { x: cellToWorld(region.centerX), z: cellToWorld(region.centerZ) }
          : { x: cellToWorld(0), z: cellToWorld(0) }
      );
      setPlayedOnce(true);
      Telemetry.runStarted();
      // Only what the player chose is an interaction; the game's own pick is not.
      if (aim) Telemetry.did(`aim_${aim.kind}`, aim.own ? 'own' : aim.username ? 'rival' : 'open');
      travel('playing', () => game.startGame('rotating_block'));
    },
    [game, travel, me, social, rulesFor, board, mapLive]
  );

  /**
   * A tower is standing. Sound it, say what it did, and re-read the board so what is on screen
   * is what was actually stored.
   *
   * `quiet` is for Again, which raises and goes straight into the next run: nothing is
   * announced over a board that is about to be replaced by a run, and the board is re-read
   * behind the run instead of before it.
   */
  const settle = React.useCallback(
    async (
      tower: TowerMapEntry,
      res: {
        kind?: 'keep' | 'claim' | 'take';
        took?: { userId?: string; username: string; score: number };
      },
      cell: GridTarget,
      quiet = false
    ) => {
      const aim = social.target;
      // Past somebody's score, whether it was chased from a card or put in front of the run by
      // the game, and wherever the tower went in the end.
      const passed =
        aim && aim.username && !aim.own && tower.score > aim.score
          ? { username: aim.username, score: aim.score, faction: aim.faction }
          : null;
      const onLand = cellKind(cell.x, cell.z) === 'land';
      // Whose tower stood here before, read before the board is re-read and it is gone.
      const fromHold = board.holdings.land.find((h) => h.x === cell.x && h.z === cell.z);
      // Toppling your own tower to stand a taller one there is a replace, not a take: there is
      // nobody to tell.
      const took =
        res.took && res.took.userId !== me.userId
          ? { ...res.took, faction: fromHold?.faction ?? undefined }
          : null;
      const stacked = (keepStacks.get(cellKey(cell.x, cell.z)) ?? 0) > 0;
      const run: PlacedRun = {
        sessionId: tower.sessionId,
        score: tower.score,
        blocks: tower.blockCount,
        perfectStreak: tower.perfectStreak,
        isBest: tower.score > myBestRef.current,
        isFirst: myCountRef.current === 0,
        faction: tower.faction ?? null,
        ...(passed ? { passed } : {}),
        ...(took ? { took } : {}),
        ...(onLand ? { cell } : {}),
      };
      // Only a run with something to say gets the offer to say it. A plain raise used to put the
      // ask in front of Build every time, which made every run end with a question.
      const notable = Boolean(run.took || run.passed || run.isFirst || run.isBest);
      setPlacedRun(!quiet && notable ? run : null);
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
        won: Boolean(passed) || Boolean(res.took) || tower.score > myBestRef.current,
        score: tower.score,
      });
      setPendingTower(null);
      setTarget(null);
      setAimedByTap(false);
      justRaised.current = `${cell.x},${cell.z}`;

      if (quiet) {
        void board.refresh();
        return;
      }

      gridView.setScope(onLand ? 'all' : 'mine');
      const before = standingOf(board.holdings, me.faction);
      const [fresh] = await Promise.all([board.refresh(), me.refresh()]);

      // What the tower did is written on it, floating off its top once the board agrees it
      // happened, at the height the board draws it: squashed on the map, true on the plot. A
      // take waits for the loser to come down first.
      const own = towerBox(tower.towerBlocks)?.maxY ?? 0;
      const top = fresh
        ? stackTopAt(fresh.towers, cell.x, cell.z) || own
        : onLand
          ? own
          : stackTopAt(board.towers, cell.x, cell.z) + own;
      const markAt = performance.now();
      const mark = (m: Pick<RaiseMark, 'text' | 'color' | 'delay' | 'sub'>) =>
        setMarks((prev) => [
          ...prev.filter((p) => markAt - p.key < RAISE_MARK_MS).slice(-3),
          {
            key: markAt,
            x: cellToWorld(cell.x),
            y: compressHeight(top, onLand ? 1 : 0) + 3,
            z: cellToWorld(cell.z),
            ...m,
          },
        ]);

      // Ground changes hands on a claim, or a take from somebody else; replacing your own does not.
      const gained = res.kind === 'claim' || Boolean(took);
      if (!onLand) {
        mark({
          text: 'Safe',
          color: INK_HEX,
          delay: 250,
          sub: { lead: stacked ? 'Stacked on your keep' : 'On your keep' },
        });
        return;
      }
      if (!gained) {
        mark({ text: 'Replaced', color: INK_HEX, delay: 250 });
        return;
      }
      const after = fresh ? standingOf(fresh.holdings, me.faction) : null;
      const climbed =
        after !== null && after.place > 0 && (before.place === 0 || after.place < before.place);
      // The side line carries the standings: its place pops, and says where it climbed from.
      if (climbed && before.place > 0) setClimb({ from: before.place, key: markAt });
      setStandingsPulse((n) => n + 1);
      mark({
        text: '+1',
        color: factionHex(me.faction),
        delay: took ? 1000 : 250,
        sub: took
          ? {
              lead: 'from',
              name: `u/${took.username}`,
              rgb: took.faction ? factionRgb(took.faction) : null,
            }
          : { lead: `Claimed ${cellName(cell.x, cell.z)}` },
      });
    },
    [social.target, gridView, board, me, keepStacks]
  );

  /**
   * The day turned over while a tower was in hand: the cell was picked on yesterday's map. The
   * tower is kept, the player's plot on the new map is asked for, and the board is re-read, so
   * placement opens again on today's map.
   */
  const turnOver = React.useCallback(async () => {
    await me.enter();
    await Promise.all([board.refresh(), me.refresh()]);
    // Cleared only now that the new map is in: an aim taken before it arrived was taken on
    // yesterday's layout, and would otherwise be raised on the new map as if it were today's.
    setTarget(null);
    setAimedByTap(false);
  }, [me, board]);

  /**
   * A run has ended: save the tower, then raise it where it was aimed, or hand it to the board.
   *
   * Only a run the player aimed at a cell is raised without asking. Everything else opens the
   * placement screen, aimed at the spot that counts most for the colour. The end of the run
   * holds first -- the run deserves a moment before the next question is asked.
   */
  /**
   * Save a run. The request says what was played, never what it was worth: a seed and the taps.
   * The server replays them through the same deterministic simulation and works out the score,
   * the block count and the geometry itself. That is the whole anti-cheat.
   */
  const saveRun = React.useCallback(
    async (run: Pick<KeptRun, 'seed' | 'gameMode' | 'inputs'>): Promise<SaveRunResponse | null> => {
      try {
        const res = await fetch('/api/game/save-run', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ sessionId: newSessionId(), ...run }),
        });
        const data = (await res.json()) as SaveRunResponse;
        return res.ok && data.success && data.sessionId ? data : null;
      } catch {
        return null;
      }
    },
    []
  );

  /** A saved run as a tower in hand, from what the server computed. */
  const towerOf = React.useCallback(
    (data: SaveRunResponse): TowerMapEntry => ({
      sessionId: data.sessionId ?? '',
      userId: me.userId ?? '',
      username: me.username ?? '',
      score: data.score ?? 0,
      blockCount: data.blockCount ?? 0,
      perfectStreak: data.perfectCount ?? 0,
      gameMode: 'rotating_block',
      timestamp: Date.now(),
      towerBlocks: data.towerBlocks ?? [],
      faction: data.faction ?? me.faction,
    }),
    [me.userId, me.username, me.faction]
  );

  /**
   * A run kept from before signing in. Signed in now (Reddit reloaded the page), it is saved and
   * put in the player's hand on the placement screen, as if the run had just ended. Still
   * signed out, the offer to sign in stands.
   */
  const restoring = React.useRef(false);
  React.useEffect(() => {
    if (me.isLoading || restoring.current || pendingTower) return;
    const kept = readKeptRun();
    if (!kept) return;
    if (!me.userId) {
      setKeptScore(kept.score);
      return;
    }
    restoring.current = true;
    setKeptScore(null);
    // It is raised on today's map, which an older post moves over to first. Re-read whatever the
    // post opened on, because the first read may not have answered yet.
    board.followLive();
    void (async () => {
      const [data] = await Promise.all([saveRun(kept), board.refresh()]);
      dropKeptRun();
      if (!data) {
        showHint('That run could not be saved.', 'alert', 2600);
        return;
      }
      setPendingTower(towerOf(data));
      showHint(
        `Signed in. Raise your ${(data.score ?? kept.score).toLocaleString()}`,
        'good',
        2600
      );
    })();
  }, [me.isLoading, me.userId, pendingTower, saveRun, towerOf, showHint, board]);

  const finishRun = React.useCallback(async () => {
    const state = game.gameState;
    if (!state) return;

    // A tap after the fall ends the hold early. Captured on the window so it runs before the
    // canvas listener, which ignores drops once the run is over anyway.
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

    // Re-read the board behind the result, so the placement screen aims at the map as it is now
    // rather than as it was when the run began. It runs alongside the hold, so it costs no time.
    const fresh = board.refresh();

    // Signed out, a run cannot be saved: the server keeps runs by player. It is kept in this
    // browser instead, and the board offers to sign in and raise it. Reddit reloads the page
    // once the player has signed in, and the run is saved then (see the effect below).
    if (!me.userId) {
      const kept = keepRun({
        seed: state.seed,
        gameMode: game.gameMode,
        inputs: game.takeRecordedInputs(),
        score: state.score,
      });
      await Promise.all([hold, fresh]);
      Telemetry.runEnded({ placed: false, won: false, score: state.score });
      setKeptScore(kept ? kept.score : null);
      travel('grid', () => {
        if (!kept) showHint('Sign in to raise a tower', 'info', 2600);
      });
      return;
    }

    const data = await saveRun({
      seed: state.seed,
      gameMode: game.gameMode,
      inputs: game.takeRecordedInputs(),
    });

    await Promise.all([hold, fresh]);

    if (!data) {
      // Nothing to raise, so the run is over here; left open, the next run would inherit it.
      Telemetry.runEnded({ placed: false, won: false, score: state.score });
      travel('grid', () => showHint('Run not saved. Try again.', 'alert', 2600));
      return;
    }

    const tower = towerOf(data);

    setSelected(null);
    setSelectedCell(null);

    // Aimed at a cell by the player: raise it there without asking, if it can be. A target the
    // game picked is only offered.
    const aim = social.target;
    const chosen = aim && !aim.auto ? aim : null;
    if (chosen && chosen.cell && (chosen.kind === 'claim' || tower.score > chosen.score)) {
      setIsPlacing(true);
      const res = await me.raise(tower.sessionId, chosen.cell.x, chosen.cell.z, board.map?.day);
      setIsPlacing(false);
      if (res.success) {
        travel('grid');
        await settle(tower, res, chosen.cell);
        return;
      }
      // Somebody moved first, the bar rose, or the day turned over. Say so and let the tower be
      // raised elsewhere.
      travel('grid', () => showHint(res.message ?? 'Could not take it.', 'alert', 2800));
      if (res.stale) void turnOver();
    } else if (chosen && chosen.cell) {
      travel('grid', () =>
        showHint(
          `Short of ${chosen.score.toLocaleString()}. Raise it somewhere else.`,
          'alert',
          2800
        )
      );
    } else {
      travel('grid');
    }
    setTarget(null);
    setAimedByTap(false);
    setPendingTower(tower);
  }, [game, me, board, social.target, travel, showHint, settle, turnOver, saveRun, towerOf]);

  // A run ends exactly once, on the transition into game-over.
  const wasGameOver = React.useRef(false);
  React.useEffect(() => {
    const isOver = game.gameState?.isGameOver === true;
    if (isOver && !wasGameOver.current) {
      void finishRun();
    }
    wasGameOver.current = isOver;
  }, [game.gameState?.isGameOver, finishRun]);

  // A bar passed: pinned to the block that passed it, for the ring and the word. A rival passed
  // becomes what the run is for, so the end of it offers their cell and names them.
  const runScore = game.gameState?.score ?? 0;
  const runBlocks = game.gameState?.blocks.length ?? 0;
  const setChase = social.setTarget;
  React.useEffect(() => {
    if (!isPlaying || ladder.length === 0) return;
    const fresh: RunPass[] = [];
    let highest: Target | null = null;
    for (const [i, r] of ladder.entries()) {
      if (r.score <= 0 || passedRungs.current.has(i) || runScore <= r.score) continue;
      passedRungs.current.add(i);
      // The player's own best is said as a new best; their own tower, aimed at to replace it, is
      // passed like anybody's, in their own colour.
      const best = r.own === true && r.kind === 'beat';
      const faction = r.own ? me.faction : r.faction;
      fresh.push({
        key: performance.now() + i,
        blockIndex: Math.max(0, runBlocks - 1),
        label: best ? 'Best' : r.own ? 'Your tower' : `u/${r.username ?? ''}`,
        color: best ? BEST_HEX : factionHex(faction),
        rgb: !best && faction ? factionRgb(faction) : null,
        own: best,
      });
      if (!r.own) highest = r;
    }
    if (fresh.length === 0) return;
    setPasses((prev) => [...prev, ...fresh]);
    if (highest) setChase(highest);
  }, [isPlaying, runScore, runBlocks, ladder, setChase, me.faction]);

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
        const res = await me.raise(pendingTower.sessionId, gridX, gridZ, board.map?.day);
        if (res.success) {
          await settle(pendingTower, res, { x: gridX, z: gridZ });
        } else {
          showHint(res.message ?? 'Could not raise it there.', 'alert', 2400);
          // Refused because the board moved on (a bar rose, a cell was taken first): re-read it,
          // so what the cell says next is the truth.
          if (res.stale) await turnOver();
          else await board.refresh();
        }
      } finally {
        setIsPlacing(false);
      }
    },
    [pendingTower, me, board, settle, showHint, turnOver]
  );

  /**
   * Where the placement screen opens: the spot that counts most for the colour, worked out from
   * the board as it is now. The chased cell leads when this tower beats it. Re-aimed whenever the
   * target is cleared, e.g. after a refusal or a new day's map.
   */
  React.useEffect(() => {
    if (!pendingTower || target || isPlacing) return;
    const chasedTarget = social.target;
    const chased =
      chasedTarget?.cell &&
      (chasedTarget.kind === 'claim' || pendingTower.score > chasedTarget.score)
        ? chasedTarget.cell
        : null;
    const aim = aimFor({
      holdings: board.holdings,
      judge,
      me: { userId: me.userId, faction: me.faction },
      score: pendingTower.score,
      home: me.region ? { x: me.region.centerX, z: me.region.centerZ } : null,
      keep: keepCell,
      chased,
    });
    if (aim) {
      setTarget({ x: aim.x, z: aim.z });
      setAimedByTap(false);
    }
  }, [
    pendingTower,
    target,
    isPlacing,
    social.target,
    board.holdings,
    judge,
    me.userId,
    me.faction,
    me.region,
    keepCell,
  ]);

  /**
   * The comment the player last wrote for this run, kept if posting it failed so the next Edit
   * opens on their words rather than the game's.
   */
  const draftRef = React.useRef<{ sessionId: string; text: string } | null>(null);

  /**
   * Post the comment the player just confirmed: the game's words, exactly as the confirmation
   * showed them (`commentFor`), or the player's own from Edit. Reddit is asked first whether the
   * player lets the app comment as them; a no posts nothing. A failure leaves the offer up.
   */
  const postBrag = React.useCallback(
    async (event: Event, text?: string) => {
      if (!placedRun) return;
      const comment = commentFor(placedRun);
      if (!(await mayPostAsUser(event))) {
        showHint('Not posted', 'info', 2000);
        return;
      }
      const result = await social.brag({
        sessionId: placedRun.sessionId,
        kind: comment.kind,
        passedUsername: comment.passedUsername,
        passedScore: comment.passedScore,
        cell: comment.cell,
        ...(text ? { text } : {}),
      });
      if (!result.ok) {
        if (text) draftRef.current = { sessionId: placedRun.sessionId, text };
        showHint(result.message ?? 'Could not post that', 'alert', 2400);
        return;
      }
      draftRef.current = null;
      setPlacedRun(null);
      Telemetry.did('brag_posted', comment.kind);
      showHint(result.topLevel ? 'Posted in the thread' : 'Posted under Scores', 'good', 2400);
      social.setTarget(null);
    },
    [placedRun, social, showHint]
  );

  const onBrag = React.useCallback((event: Event) => void postBrag(event), [postBrag]);

  /** Edit first: Reddit's form, opened on the game's words (or the last draft), then post. */
  const onEditBrag = React.useCallback(
    async (event: Event) => {
      if (!placedRun) return;
      const kept =
        draftRef.current?.sessionId === placedRun.sessionId ? draftRef.current.text : null;
      const text = await editComment(kept ?? commentDraft(commentFor(placedRun)), me.username);
      if (text !== null) await postBrag(event, text);
    },
    [placedRun, me.username, postBrag]
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
    () => new Set(crumbles.flatMap((c) => c.entries.map((e) => e.sessionId))),
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

  // An older post's day is shown whole: the map as it ended is the point of it.
  React.useEffect(() => {
    if (!mapLive && gridView.scope !== 'all') gridView.setScope('all');
  }, [mapLive, gridView]);

  /**
   * The viewer on the board on screen. On today's map, their plot and colour; on an older post's
   * day, the keep they had that day, in the colour they flew then, or none if they did not play.
   */
  const viewer = React.useMemo(() => {
    if (mapLive) return { userId: me.userId, faction: me.faction, region: me.region };
    const keep = board.keeps.find((k) => k.userId === me.userId);
    const region: PlayerRegion | null = keep
      ? {
          rx: keep.rx,
          rz: keep.rz,
          centerX: keep.centerX,
          centerZ: keep.centerZ,
          radius: REGION_RADIUS,
        }
      : null;
    return { userId: me.userId, faction: keep?.faction ?? me.faction, region };
  }, [mapLive, me.userId, me.faction, me.region, board.keeps]);

  /** How an older post's day ended: its best tower is tagged in the scene. */
  const day = React.useMemo(
    () => (mapLive ? null : dayResult(board.towers, me.userId)),
    [mapLive, board.towers, me.userId]
  );
  const dayBest = React.useMemo((): Target | null => {
    const best = day?.best;
    if (!best || best.gridX === undefined || best.gridZ === undefined) return null;
    return {
      kind: 'beat',
      username: best.username,
      faction: best.faction ?? undefined,
      score: best.score,
      cell: { x: best.gridX, z: best.gridZ },
      auto: true,
    };
  }, [day]);
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

  /**
   * Keep this tower and go again, in one tap.
   *
   * It is raised where it is aimed (or on the keep, when that spot cannot be had) and the next
   * run starts behind it. Again used to drop the tower, which made "one more" cost the run just
   * played. When the raise is refused the tower stays in hand and the placement screen says why;
   * only a tower with nowhere at all to stand, at the cap, is left behind.
   */
  const onAgain = React.useCallback(async () => {
    const tower = pendingTower;
    // The same aimed cell again, when the player chose one and fell short of it.
    const again = social.target && !social.target.auto && social.target.cell ? social.target : null;
    if (!tower) {
      void startRun(again);
      return;
    }
    const at =
      target && verdict?.ok
        ? target
        : keepCell && judge(keepCell.x, keepCell.z, tower.score).ok
          ? keepCell
          : null;
    if (!at) {
      Telemetry.runEnded({ placed: false, won: false, score: tower.score });
      void startRun(again);
      return;
    }
    setIsPlacing(true);
    const res = await me.raise(tower.sessionId, at.x, at.z, board.map?.day);
    setIsPlacing(false);
    if (!res.success) {
      // The tower stays in hand. The board is re-read before the aim is cleared, so placement
      // re-aims on the map as it now is rather than at the same refused cell.
      showHint(res.message ?? 'Could not raise it there.', 'alert', 2600);
      if (res.stale) {
        await turnOver();
      } else {
        await board.refresh();
        setTarget(null);
        setAimedByTap(false);
      }
      return;
    }
    await settle(tower, res, at, true);
    void startRun(again, { skip: at });
  }, [
    pendingTower,
    social.target,
    target,
    verdict,
    keepCell,
    judge,
    me,
    board,
    showHint,
    turnOver,
    settle,
    startRun,
  ]);

  /**
   * The tower in hand can go down nowhere at all: the best spot there is for it, which falls back
   * to the keep, will not take it either. Only then is Discard offered.
   */
  const stuck = React.useMemo(() => {
    if (!pendingTower || verdict?.ok) return false;
    const best = aimFor({
      holdings: board.holdings,
      judge,
      me: { userId: me.userId, faction: me.faction },
      score: pendingTower.score,
      home: me.region ? { x: me.region.centerX, z: me.region.centerZ } : null,
      keep: keepCell,
    });
    return !best || !judge(best.x, best.z, pendingTower.score).ok;
  }, [pendingTower, verdict, board.holdings, judge, me.userId, me.faction, me.region, keepCell]);

  /** What a tapped tower or cell is and the run it offers. Its tag is drawn in the scene. */
  const brief = React.useMemo(() => {
    const opts = {
      viewer: {
        userId: viewer.userId,
        faction: viewer.faction,
        region: viewer.region ? { rx: viewer.region.rx, rz: viewer.region.rz } : null,
      },
      judge,
      live: mapLive,
    };
    if (selected) return towerBrief(selected, opts);
    if (selectedCell) return cellBrief(selectedCell, board.holdings, opts);
    return null;
  }, [selected, selectedCell, viewer, judge, mapLive, board.holdings]);

  /**
   * What the next run will chase, worked out the way Build will work it out: the lowest rival bar
   * in reach, or the player's own best. Said under Build and tagged over the tower in the scene.
   */
  const nextChase = React.useMemo((): Target | null => {
    if (pendingTower || !mapLive || !me.region) return null;
    const rival = chaseLadder(
      board.holdings,
      judge,
      { userId: me.userId, faction: me.faction },
      { x: me.region.centerX, z: me.region.centerZ },
      null,
      1
    )[0];
    if (rival) {
      return {
        kind: 'take',
        username: rival.username,
        faction: rival.faction ?? undefined,
        score: rival.score,
        cell: { x: rival.x, z: rival.z },
        auto: true,
      };
    }
    return myBest > 0 ? { kind: 'beat', score: myBest, own: true, auto: true } : null;
  }, [pendingTower, mapLive, me.region, me.userId, me.faction, board.holdings, judge, myBest]);

  // An older post whose day is no longer stored opens on today's map instead, and says so once,
  // so the date in its title is not a puzzle. Only the board it opened on can need that.
  const toldPostDay = React.useRef(false);
  React.useEffect(() => {
    const m = board.map;
    if (toldPostDay.current || !m) return;
    toldPostDay.current = true;
    if (!m.live || !m.postDay || m.postDay === m.day) return;
    showHint(
      `This post went up on ${shortDay(m.postDay)}. You're on today's map.`,
      'info',
      POST_DAY_HINT_MS
    );
  }, [board.map, showHint]);

  return (
    <div
      // No click handler here. useGameState already attaches a `pointerdown` listener to the
      // element marked data-game-canvas, and that is the better path: it fires on press rather
      // than release. It takes nothing from the feed: a swipe over the post still scrolls it.
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
            passes={passes}
          />
        ) : (
          <BoardScene
            towers={visibleTowers}
            holdings={board.holdings}
            viewer={viewer}
            pendingTower={pendingTower}
            isPlacing={isPlacing}
            target={target}
            onTarget={aimByTap}
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
            marks={marks}
            brief={brief}
            nextChase={mapLive ? nextChase : dayBest}
          />
        )}
      </Canvas>

      {isPlaying && game.gameState && (
        <RunHud
          score={game.gameState.score}
          perfectCount={game.gameState.perfectBlockCount}
          blockCount={game.gameState.blocks.length}
          over={game.gameState.isGameOver}
          target={social.target}
          ladder={ladder}
          passes={passes}
          myBest={myBest}
          myTowers={myCount}
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
          aimedByTap={aimedByTap}
          verdict={verdict}
          hint={hint}
          view={scopedView}
          brief={brief}
          brags={social.feed}
          placedRun={placedRun}
          isPosting={social.isPosting}
          me={{
            userId: me.userId,
            username: me.username,
            faction: me.faction,
            chosen: me.chosen,
            region: me.region,
          }}
          myBest={myBest}
          muted={muted}
          colourAsked={colourAsked}
          onColourAsked={() => setColourAsked(true)}
          onToggleMute={toggleMute}
          onSetFaction={onSetFaction}
          onAim={(aim) => void startRun(aim)}
          onBrag={onBrag}
          onEditBrag={(event) => void onEditBrag(event)}
          onBack={() => (selected ? selectTower(null) : selectCell(null))}
          onConfirmPlacement={() => {
            if (target && verdict?.ok) void placeTower(target.x, target.z);
          }}
          onDiscard={() => {
            // A run abandoned before it is raised is the drop-off the dashboard needs to see.
            Telemetry.runEnded({ placed: false, won: false, score: pendingTower?.score ?? 0 });
            setPendingTower(null);
            setTarget(null);
            setAimedByTap(false);
            social.setTarget(null);
          }}
          onAgain={() => void onAgain()}
          stuck={stuck}
          standingsPulse={standingsPulse}
          climb={climb}
          nextChase={nextChase}
          onPlay={() => void startRun(null)}
          onRelay={goToRelay}
          map={board.map}
          day={day}
          entering={entering}
          keptRun={keptScore}
          onSignIn={askToSignIn}
        />
      )}
    </div>
  );
};
