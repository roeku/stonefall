import { useState, useCallback } from 'react';
import { TowerMapEntry } from '../../shared/types/api';

export interface PostGameState {
  isInPostGame: boolean;
  showTowerExploration: boolean;
  playerTower: TowerMapEntry | null;
  gameScore: number;
  gameBlocks: number;
}

export const usePostGameState = () => {
  const [postGameState, setPostGameState] = useState<PostGameState>({
    isInPostGame: false,
    showTowerExploration: false,
    playerTower: null,
    gameScore: 0,
    gameBlocks: 0,
  });

  const enterPostGame = useCallback((score: number, blocks: number, tower?: TowerMapEntry) => {
    setPostGameState({
      isInPostGame: true,
      showTowerExploration: false,
      playerTower: tower || null,
      gameScore: score,
      gameBlocks: blocks,
    });
  }, []);

  const showTowerExploration = useCallback(() => {
    setPostGameState((prev) => ({
      ...prev,
      showTowerExploration: true,
    }));
  }, []);

  const hideTowerExploration = useCallback(() => {
    setPostGameState((prev) => ({
      ...prev,
      showTowerExploration: false,
    }));
  }, []);

  const exitPostGame = useCallback(() => {
    setPostGameState({
      isInPostGame: false,
      showTowerExploration: false,
      playerTower: null,
      gameScore: 0,
      gameBlocks: 0,
    });
  }, []);

  return {
    postGameState,
    enterPostGame,
    showTowerExploration,
    hideTowerExploration,
    exitPostGame,
  };
};
