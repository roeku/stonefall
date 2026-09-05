import React from 'react';
import { useThree } from '@react-three/fiber';
import * as THREE from 'three';
import type { PlayerRegion, TowerMapEntry } from '../../../shared/types/api';
import { cellToWorld, isGlobalCellInRegion, worldToCell } from '../../../shared/types/worldGrid';
import { MAX_STACK_PER_CELL } from '../../../shared/types/towerPlacement';
import type { GridViewState } from '../../hooks/useGridView';
import { mixGridTintHex } from '../../utils/gridColors';
import { EffectsRenderer } from '../effects/EffectsRenderer';
import { PlotPlatform } from '../game/PlotPlatform';
import { TowerGhost } from '../game/TowerGhost';
import { BoardCamera } from './BoardCamera';
import { BoardFloor } from './BoardFloor';
import { BoardTowers } from './BoardTowers';
import { CellMarker } from './CellMarker';
import { PlotBeacon } from './PlotBeacon';
import { SelectionHalo } from './SelectionHalo';
import { countByCell, stackTopAt } from './boardCells';
import {
  PLOT_HALF,
  baseDistance,
  communityFrame,
  plotCenter,
  type BoardMode,
} from './boardFraming';
import { towerBox } from './boardInstancing';

export interface GridTarget {
  x: number;
  z: number;
}

export interface BoardSceneProps {
  /** Towers in the current scope, already positioned by the server. */
  towers: TowerMapEntry[];
  /** Set when a finished tower is waiting to be placed; enables placement mode. */
  pendingTower: TowerMapEntry | null;
  /** The player's buildable area. Null until they have one. */
  region: PlayerRegion | null;
  isPlacing: boolean;
  target: GridTarget | null;
  onTarget: (cell: GridTarget) => void;
  onPlace: (gridX: number, gridZ: number) => void;
  /** Transient feedback for a tap that could not do what it was aimed at. */
  onHint: (message: string) => void;
  selected: TowerMapEntry | null;
  onSelect: (tower: TowerMapEntry | null) => void;
  view: GridViewState;
}

/** Used until any tower has declared a colour; the blue end of the community tint mix. */
const DEFAULT_GRID_TINT = '#24c8ff';
/** Amber, so the player's own plot is never mistaken for the blue floor it sits on. */
const PLOT_COLOR = '#fbbf24';
/** Green while a tower is in hand, matching the ghost, so the two read as one action. */
const PLACING_COLOR = '#4ade80';
const BLOCKED_COLOR = '#f87171';
const SELECT_COLOR = '#e2f6ff';

/**
 * Scene contents for the board, rendered inside the application's single shared Canvas.
 *
 * Browsing, looking at one tower and placing are the same scene; they differ by what the camera
 * treats as its subject and whether a tower is in hand. All input is tap: Reddit inline posts
 * permit tap and click only.
 */
export const BoardScene: React.FC<BoardSceneProps> = ({
  towers,
  pendingTower,
  region,
  isPlacing,
  target,
  onTarget,
  onPlace,
  onHint,
  selected,
  onSelect,
  view,
}) => {
  const { size } = useThree();
  const isPlacementMode = pendingTower !== null && region !== null;
  const mode: BoardMode = isPlacementMode ? 'placing' : selected ? 'tower' : view.scope;

  const occupied = React.useMemo(() => countByCell(towers), [towers]);
  const targetStack = target ? (occupied.get(`${target.x},${target.z}`) ?? 0) : 0;
  const canPlace = targetStack < MAX_STACK_PER_CELL;
  const ghostBaseY = React.useMemo(
    () => (target ? stackTopAt(towers, target.x, target.z) : 0),
    [towers, target]
  );

  const city = React.useMemo(() => communityFrame(towers), [towers]);
  const plot = region ? plotCenter(region) : null;

  const selectedFrame = React.useMemo(() => {
    if (!selected) return null;
    const box = towerBox(selected.towerBlocks);
    const baseY = (selected.stackBaseY ?? 0) / 1000;
    return {
      x: (selected.worldX ?? 0) + (box ? (box.minX + box.maxX) / 2 : 0),
      z: (selected.worldZ ?? 0) + (box ? (box.minZ + box.maxZ) / 2 : 0),
      baseY,
      height: box ? box.maxY - box.minY : 1.5,
    };
  }, [selected]);

  // What the camera is centred on. Placement looks at the cell in hand, then the plot; a
  // selected tower is its own subject; the plot view sits on the plot; the city view frames
  // everything built.
  const focus = (() => {
    if (isPlacementMode && target) return { x: cellToWorld(target.x), z: cellToWorld(target.z) };
    if (isPlacementMode && plot) return plot;
    if (mode === 'tower' && selectedFrame) return { x: selectedFrame.x, z: selectedFrame.z };
    if (mode === 'mine' && plot) return plot;
    return { x: city.x, z: city.z };
  })();
  const extent = mode === 'community' ? city.extent : PLOT_HALF;

  /**
   * Floor tint, mixed from the blue/orange balance of what's actually built. The one way the
   * floor says anything about the state of the game.
   */
  const gridTint = React.useMemo(() => {
    let blue = 0;
    let counted = 0;
    for (const t of towers) {
      if (!t.playerColorChoice) continue;
      counted += 1;
      if (t.playerColorChoice === 'blue') blue += 1;
    }
    return counted === 0
      ? DEFAULT_GRID_TINT
      : (mixGridTintHex((blue / counted) * 100) ?? DEFAULT_GRID_TINT);
  }, [towers]);

  // The floor fades with the camera's standoff so it never haloes at the horizon, and so its
  // cell lines are gone before they are fine enough to shimmer. The rig computes the same
  // number; this only needs to be in the right ballpark.
  const fadeDistance =
    baseDistance(mode, {
      aspect: size.height > 0 ? size.width / size.height : 1,
      fovDeg: 30,
      extent,
      ...(selectedFrame ? { towerHeight: selectedFrame.height } : {}),
    }) *
    view.zoom *
    1.7;

  const aimAt = (x: number, z: number) => {
    if (!region) return;
    // Taps outside the player's own area can't place anything -- most of the grid belongs to
    // other people. Say so rather than swallowing the tap.
    if (!isGlobalCellInRegion(region.centerX, region.centerZ, x, z)) {
      onHint('That cell belongs to someone else');
      return;
    }
    // First tap targets, so the ghost shows the result; a second tap on the same cell commits.
    // Tapping elsewhere retargets, which keeps a mis-tap from being destructive.
    if (target && target.x === x && target.z === z) {
      if (canPlace) onPlace(x, z);
      else onHint(`That cell is full (${MAX_STACK_PER_CELL} max)`);
      return;
    }
    onTarget({ x, z });
  };

  const handleFloorTap = (event: { point: THREE.Vector3; stopPropagation: () => void }) => {
    event.stopPropagation();
    if (isPlacementMode) {
      if (isPlacing) return;
      aimAt(worldToCell(event.point.x), worldToCell(event.point.z));
      return;
    }
    if (selected) onSelect(null);
  };

  const handleTowerTap = (tower: TowerMapEntry) => {
    if (isPlacementMode) {
      // Tapping a tower while placing aims at its cell: the natural way to say "stack on that".
      if (isPlacing || tower.gridX === undefined || tower.gridZ === undefined) return;
      aimAt(tower.gridX, tower.gridZ);
      return;
    }
    onSelect(selected?.sessionId === tower.sessionId ? null : tower);
  };

  return (
    <>
      <BoardFloor color={gridTint} fadeDistance={fadeDistance} />

      {/* Bloom, the same chain the game scene uses. The rims are what it lights. */}
      <EffectsRenderer />

      {/* Only the player's own boundary is drawn. Everyone else's plot needs no marking: their
          towers are already standing on the one shared grid, and outlining every sector turned
          the community view into a field of trays. */}
      {region && plot && (
        <PlotPlatform
          centerX={region.centerX}
          centerZ={region.centerZ}
          radius={region.radius}
          color={isPlacementMode ? PLACING_COLOR : PLOT_COLOR}
          active={isPlacementMode}
        />
      )}

      {mode === 'community' && plot && <PlotBeacon x={plot.x} z={plot.z} color={PLOT_COLOR} />}

      {/* One invisible ground plane, raycast and converted to a cell, rather than a hitbox per
          cell. The hit point already carries the coordinates. */}
      <mesh
        rotation={[-Math.PI / 2, 0, 0]}
        position={[0, -0.5, 0]}
        onClick={handleFloorTap}
        visible={false}
      >
        <planeGeometry args={[12000, 12000]} />
      </mesh>

      <BoardTowers
        towers={towers}
        focusX={focus.x}
        focusZ={focus.z}
        selectedId={!isPlacementMode && selected ? selected.sessionId : null}
        dimAll={isPlacementMode}
        onTap={handleTowerTap}
      />

      {selected && !isPlacementMode && <SelectionHalo tower={selected} color={SELECT_COLOR} />}

      {isPlacementMode && target && pendingTower && (
        <>
          <CellMarker
            worldX={cellToWorld(target.x)}
            worldZ={cellToWorld(target.z)}
            color={canPlace ? PLACING_COLOR : BLOCKED_COLOR}
          />
          <TowerGhost
            blocks={pendingTower.towerBlocks ?? []}
            worldX={cellToWorld(target.x)}
            worldZ={cellToWorld(target.z)}
            baseY={ghostBaseY}
            canPlace={canPlace}
          />
        </>
      )}

      <BoardCamera
        mode={mode}
        focusX={focus.x}
        focusZ={focus.z}
        // Aiming at a cell with a stack in it lifts the camera to where the tower will land,
        // so stacking is watched rather than guessed at.
        focusY={isPlacementMode && target && ghostBaseY > 0 ? ghostBaseY + 2 : undefined}
        extent={extent}
        tower={mode === 'tower' ? selectedFrame : null}
        yaw={view.yaw}
        zoom={view.zoom}
      />
    </>
  );
};
