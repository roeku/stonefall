import type { PlayerRegion, TowerMapEntry } from '../../../shared/types/api';
import { REGION_PITCH, REGION_SPAN, cellToWorld } from '../../../shared/types/worldGrid';
import { DEFAULT_TOWER_GRID_SIZE } from '../../../shared/types/towerPlacement';

/**
 * Where the board camera looks and from how far, per mode. Pure, so it can be tested.
 *
 * The board has four ways of looking at the same world, and they differ only in what the subject
 * is: your plot, the whole city, the cell you are aiming at, or one tower somebody built. Each
 * gets its own pitch and its own idea of a good standoff. Zoom is a multiplier on top.
 */
export type BoardMode = 'mine' | 'all' | 'placing' | 'tower' | 'cell';

/** Camera tilt below the horizontal, radians. */
export const PITCH: Record<BoardMode, number> = {
  /** Steep enough to read the plot as a floor, shallow enough that towers climb out of frame. */
  mine: 0.42,
  /**
   * A map seen at an angle. Heights are squashed in this view (see BoardTowers `compress`), so
   * the camera can sit lower than a survey and still read plots as ground with short spires on
   * it. Towers here are needles hundreds of units tall at true scale; from anywhere near the
   * ground, unsquashed, the city is a wall of them and nothing can be found.
   */
  all: 0.78,
  /**
   * Cells have to be readable to aim at, and the towers already standing on the plot are
   * hundreds of units tall: anything short of near-overhead hides the floor behind them.
   */
  placing: 1.15,
  /** Looking up at one tower. */
  tower: 0.16,
  /** Looking down at one cell and its neighbours, close enough to read the tile. */
  cell: 0.62,
};

/** A plot edge to edge, in world units. */
export const PLOT_WORLD = REGION_SPAN * DEFAULT_TOWER_GRID_SIZE;
export const PLOT_HALF = PLOT_WORLD / 2;

/** World centre of a player's plot. */
export const plotCenter = (region: PlayerRegion): { x: number; z: number } => ({
  x: cellToWorld(region.centerX),
  z: cellToWorld(region.centerZ),
});

/**
 * Centre and half-width of everything built.
 *
 * Framed from the towers rather than at a fixed size: a fixed frame loses the first few towers
 * in an empty floor, and crops the rest once the map fills in.
 */
export const mapFrame = (
  towers: readonly TowerMapEntry[]
): { x: number; z: number; extent: number } => {
  let minX = Infinity;
  let maxX = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;
  for (const t of towers) {
    if (!Number.isFinite(t.worldX) || !Number.isFinite(t.worldZ)) continue;
    minX = Math.min(minX, t.worldX as number);
    maxX = Math.max(maxX, t.worldX as number);
    minZ = Math.min(minZ, t.worldZ as number);
    maxZ = Math.max(maxZ, t.worldZ as number);
  }
  if (minX === Infinity) return { x: 0, z: 0, extent: PLOT_WORLD };
  return {
    x: (minX + maxX) / 2,
    z: (minZ + maxZ) / 2,
    extent: Math.max(PLOT_WORLD, Math.max(maxX - minX, maxZ - minZ) / 2 + PLOT_HALF),
  };
};

/**
 * Half-width of the most the map shows around a plot at zoom 1: four plots out on every side.
 * Past that a plot is a speck on a phone and the neighbours that matter are unreadable; the
 * zoom button is there for anyone who wants the far edge.
 */
export const MAP_NEIGHBOURHOOD = REGION_PITCH * DEFAULT_TOWER_GRID_SIZE * 4.5;

/**
 * The map framed on the viewer's own plot.
 *
 * Framing the map on the middle of everything built put the camera over the first plot ever
 * handed out, which on any map of real size is somebody else's. The question the map view
 * answers is "where am I and who is round me", so it is centred on the viewer's plot and wide
 * enough to take in what is built round it, up to a neighbourhood.
 */
export const mapFrameAround = (
  towers: readonly TowerMapEntry[],
  center: { x: number; z: number }
): { x: number; z: number; extent: number } => {
  let reach = 0;
  for (const t of towers) {
    if (!Number.isFinite(t.worldX) || !Number.isFinite(t.worldZ)) continue;
    reach = Math.max(
      reach,
      Math.abs((t.worldX as number) - center.x),
      Math.abs((t.worldZ as number) - center.z)
    );
  }
  return {
    x: center.x,
    z: center.z,
    extent: clamp(reach + PLOT_HALF, PLOT_WORLD, MAP_NEIGHBOURHOOD),
  };
};

export interface DistanceParams {
  /** Viewport width / height. */
  aspect: number;
  /** Vertical field of view, degrees. */
  fovDeg: number;
  /** Half-width of the subject on the floor, for plot and city modes. */
  extent: number;
  /** Height of the selected tower, for tower mode. */
  towerHeight?: number;
  /**
   * Height of the tallest thing already standing in the subject area, for placing mode.
   *
   * Placement fitted the plot's *footprint* and ignored what was on it, so the camera was
   * positioned as though the plot were empty. A plot with towers on it is a canyon, and the
   * camera was being put inside it: the player was asked to pick a cell while looking at the
   * side of somebody's tower. The rig now has to clear the skyline as well as frame the ground.
   */
  skyline?: number;
  /** Canvas height in CSS pixels, for tower mode, which keeps the chrome's pixels clear. */
  viewportHeight?: number;
}

const halfAngles = (fovDeg: number, aspect: number): { halfV: number; halfH: number } => {
  const halfV = (fovDeg * Math.PI) / 360;
  const safeAspect = Number.isFinite(aspect) && aspect > 0 ? aspect : 1;
  return { halfV, halfH: Math.atan(Math.tan(halfV) * safeAspect) };
};

/**
 * Standoff that frames the subject at zoom 1.
 *
 * Your plot is fitted to the viewport's width: the camera looks down its diagonal, so the
 * corners are the widest points and a portrait phone -- most of Reddit -- is bound by them.
 * The city is not fitted at all; a skyline is meant to run past the edges, so it gets a standoff
 * that grows gently with the built area. A tower is fitted to its height.
 */
export const baseDistance = (mode: BoardMode, p: DistanceParams): number => {
  const { halfV, halfH } = halfAngles(p.fovDeg, p.aspect);
  switch (mode) {
    case 'mine': {
      const diagonal = p.extent * Math.SQRT2 * 1.15;
      return clamp(diagonal / Math.tan(halfH), 90, 400);
    }
    case 'placing': {
      const fit = (p.extent / Math.tan(Math.min(halfV, halfH))) * Math.SQRT1_2;
      // Clearing the skyline was not enough: the rig used to look at the ground from a camera
      // that sat just above the tallest tower, so a stack beside the aim rose from the bottom
      // of the frame to the camera's own height and filled it. The aim point is now halfway up
      // the skyline (see `placingLookHeight`), and the standoff is what fits the whole stack in
      // the vertical field of view from there: with the pitch at 66 degrees and a 30 degree
      // lens, the top stays in frame when the distance is at least 1.22 times the skyline.
      const fitStack = (p.skyline ?? 0) * 1.3;
      return clamp(Math.max(fit * 1.1, fitStack), 40, 400);
    }
    case 'cell': {
      // A few cells either side of the one tapped, so the tile and its neighbours are in frame.
      return clamp((p.extent * 3.2) / Math.tan(halfH), 60, 220);
    }
    case 'all': {
      // Fitted to the viewport's width, like the plot: on a portrait phone the horizontal
      // field of view is a few degrees and anything less leaves most of the city off-screen.
      // Wider windows get more margin: a landscape monitor fits the city's width from close
      // enough that the near spires loom and the far ones vanish, and only distance flattens
      // that. A portrait phone is already far away just to fit the width.
      const margin = 1.1 + 0.5 * Math.min(1, Math.max(0, (p.aspect - 0.7) / 1.1));
      const fitWidth = (p.extent * margin) / Math.tan(halfH);
      return clamp(Math.max(fitWidth, p.extent * 2.1 + 140), 300, 1800);
    }
    case 'tower':
      return towerShot({
        fovDeg: p.fovDeg,
        viewportHeight: p.viewportHeight ?? 512,
        baseY: 0,
        height: p.towerHeight ?? 4,
      }).distance;
  }
};

/**
 * Screen space the tower shot keeps clear, in CSS pixels: the top bar, the tag drawn above the
 * tower's top (score, who, cell), and the action and back button along the bottom.
 */
export const TOWER_SHOT_CLEAR = { top: 58, tag: 66, bottom: 92 };

/** How far above a tower's top its tag is anchored, in world units. */
export const TAG_LIFT = 2.5;

/**
 * The tower shot: how far back the camera stands and how high it aims so the whole tower, foot
 * to tag, sits between the chrome.
 *
 * It used to aim at 45% of the tower's height from a standoff fitted to the tower alone. Looking
 * almost level, that put the top on the frame's edge, and the tag -- whose tower and what it
 * scored, the reason for tapping it -- above the edge, under the top bar. Now the foot is pinned
 * just above the bottom chrome and the top of the tag just below the top bar, at the rig's pitch,
 * which has a closed form: two elevation angles from the camera, one standoff that separates them
 * by the tower's height. A short tower is not approached closer than the minimum; it is centred
 * in the same band instead.
 */
export const towerShot = (p: {
  fovDeg: number;
  /** Canvas height in CSS pixels. */
  viewportHeight: number;
  baseY: number;
  height: number;
}): { distance: number; lookY: number } => {
  const pitch = PITCH.tower;
  const tanV = Math.tan((p.fovDeg * Math.PI) / 360);
  const vh = Number.isFinite(p.viewportHeight) && p.viewportHeight > 0 ? p.viewportHeight : 512;
  // Vertical positions on screen, -1 bottom to 1 top. On a very short canvas the bands would
  // cross, so the tower keeps at least a third of the height.
  const ndc = (px: number): number => (2 * px) / vh;
  let foot = -1 + ndc(TOWER_SHOT_CLEAR.bottom);
  let top = 1 - ndc(TOWER_SHOT_CLEAR.top + TOWER_SHOT_CLEAR.tag);
  if (top - foot < 0.66) {
    const mid = (top + foot) / 2;
    foot = mid - 0.33;
    top = mid + 0.33;
  }
  // Slope below the horizontal of the ray through a screen position, seen from the camera.
  const slope = (y: number): number => Math.tan(Math.atan(y * tanV) - pitch);
  const h = Math.max(1.5, p.height);
  const tip = p.baseY + h + TAG_LIFT;
  const fit = (tip - p.baseY) / (slope(top) - slope(foot));
  const reach = clamp(fit, 60, 5000);
  // Height of the camera: exact fit when it stands at the fitted distance, centred when further.
  const camY =
    reach === fit
      ? tip - reach * slope(top)
      : (p.baseY + tip) / 2 - reach * slope((top + foot) / 2);
  const distance = reach / Math.cos(pitch);
  return { distance, lookY: camY - Math.sin(pitch) * distance };
};

/**
 * Where placement looks: halfway up the drawn skyline, or just above the top of the stack the
 * tower will land on, whichever is higher. Never below the plain placing aim height.
 */
export const placingLookHeight = (skyline: number, stackTop: number): number =>
  Math.max(lookHeight('placing', 0), skyline * 0.5, stackTop > 0 ? stackTop + 2 : 0);

/** Height of the point the camera aims at. */
export const lookHeight = (mode: BoardMode, _distance: number): number => {
  switch (mode) {
    case 'mine':
      return 6;
    case 'placing':
      return 2;
    case 'all':
      return 0;
    case 'cell':
      return 1;
    case 'tower':
      // Only until the tower is known; with one, `towerShot` sets the aim.
      return 6;
  }
};

const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));
