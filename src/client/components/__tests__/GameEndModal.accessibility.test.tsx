import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { GameEndModal } from '../GameEndModal';
import { GameState } from '../../../shared/simulation';

// Mock game state for testing
const mockGameState: GameState = {
    score: 5555,
    blocks: [
        { x: 0, y: 0, z: 0, width: 1, height: 1, depth: 1, rotation: 0 },
        { x: 1, y: 1, z: 0, width: 1, height: 1, depth: 1, rotation: 0 },
    ],
    combo: 2,
    isGameOver: true,
    currentBlock: null,
    nextBlock: null,
    gameSpeed: 1,
    dropSpeed: 1,
    perfectPlacements: 2,
    totalPlacements: 2,
    gameStartTime: Date.now() - 60000,
    lastPlacementTime: Date.now(),
    isPaused: false,
    gameMode: 'classic',
};

const mockPlayerTower = {
    sessionId: 'test-session',
    username: 'TestPlayer',
    rank: 2,
    score: 5555,
    blockCount: 2,
    perfectStreak: 2,
};

describe('GameEndModal Accessibility', () => {
    const mockOnPlayAgain = jest.fn();
    const mockOnShare = jest.fn();
    const mockOnMinimize = jest.fn();

    beforeEach(() => {
        jest.clearAllMocks();
    });

    test('should have proper ARIA attributes', async () => {
        render(
            <GameEndModal
                isVisible={true}
                gameState={mockGameState}
                playerTower={mockPlayerTower}
                onPlayAgain={mockOnPlayAgain}
                onShare={mockOnShare}
                onMinimize={mockOnMinimize}
            />
        );

        // Check for modal dialog attributes
        const modal = screen.getByRole('dialog');
        expect(modal).toHaveAttribute('aria-modal', 'true');
        expect(modal).toHaveAttribute('aria-labelledby', 'modal-title');
        expect(modal).toHaveAttribute('aria-describedby', 'modal-description');

        // Check for hidden title and description
        expect(screen.getByText('Game Results')).toBeInTheDocument();
        expect(screen.getByText(/Your tower defense game statistics/)).toBeInTheDocument();
    });

    test('should have proper focus management', async () => {
        render(
            <GameEndModal
                isVisible={true}
                gameState={mockGameState}
                playerTower={mockPlayerTower}
                onPlayAgain={mockOnPlayAgain}
                onShare={mockOnShare}
                onMinimize={mockOnMinimize}
            />
        );

        // The close button should be the first focusable element
        const closeButton = screen.getByRole('button', { name: /close game results modal/i });
        expect(closeButton).toBeInTheDocument();
        expect(closeButton).toHaveAttribute('tabIndex', '0');
    });

    test('should handle keyboard navigation', async () => {
        render(
            <GameEndModal
                isVisible={true}
                gameState={mockGameState}
                playerTower={mockPlayerTower}
                onPlayAgain={mockOnPlayAgain}
                onShare={mockOnShare}
                onMinimize={mockOnMinimize}
            />
        );

        const modal = screen.getByRole('dialog');

        // Test Escape key closes modal
        fireEvent.keyDown(modal, { key: 'Escape' });
        await waitFor(() => {
            expect(mockOnMinimize).toHaveBeenCalled();
        });
    });

    test('should have proper button accessibility', async () => {
        render(
            <GameEndModal
                isVisible={true}
                gameState={mockGameState}
                playerTower={mockPlayerTower}
                onPlayAgain={mockOnPlayAgain}
                onShare={mockOnShare}
                onMinimize={mockOnMinimize}
            />
        );

        // Wait for buttons to load
        await waitFor(() => {
            const tryAgainButton = screen.getByRole('button', { name: /start a new game/i });
            const boastButton = screen.getByRole('button', { name: /share your game results/i });

            expect(tryAgainButton).toHaveAttribute('aria-label', 'Start a new game');
            expect(boastButton).toHaveAttribute('aria-label', 'Share your game results and score');
            expect(tryAgainButton).toHaveAttribute('type', 'button');
            expect(boastButton).toHaveAttribute('type', 'button');
        });
    });

    test('should have proper region labels', async () => {
        render(
            <GameEndModal
                isVisible={true}
                gameState={mockGameState}
                playerTower={mockPlayerTower}
                onPlayAgain={mockOnPlayAgain}
                onShare={mockOnShare}
                onMinimize={mockOnMinimize}
            />
        );

        // Check for region landmarks
        expect(screen.getByRole('region', { name: /player information/i })).toBeInTheDocument();
        expect(screen.getByRole('region', { name: /game statistics/i })).toBeInTheDocument();
        expect(screen.getByRole('region', { name: /achievement message/i })).toBeInTheDocument();
        expect(screen.getByRole('region', { name: /action buttons/i })).toBeInTheDocument();
    });

    test('should have live region for announcements', () => {
        render(
            <GameEndModal
                isVisible={true}
                gameState={mockGameState}
                playerTower={mockPlayerTower}
                onPlayAgain={mockOnPlayAgain}
                onShare={mockOnShare}
                onMinimize={mockOnMinimize}
            />
        );

        // Check for live region
        const liveRegion = screen.getByRole('status');
        expect(liveRegion).toHaveAttribute('aria-live', 'polite');
        expect(liveRegion).toHaveAttribute('aria-atomic', 'true');
    });

    test('should handle minimized state accessibility', () => {
        render(
            <GameEndModal
                isVisible={false}
                gameState={mockGameState}
                playerTower={mockPlayerTower}
                onPlayAgain={mockOnPlayAgain}
                onShare={mockOnShare}
                onMinimize={mockOnMinimize}
            />
        );

        // When hidden, modal should not be in DOM
        expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });

    test('should support Enter and Space key activation on buttons', async () => {
        render(
            <GameEndModal
                isVisible={true}
                gameState={mockGameState}
                playerTower={mockPlayerTower}
                onPlayAgain={mockOnPlayAgain}
                onShare={mockOnShare}
                onMinimize={mockOnMinimize}
            />
        );

        await waitFor(() => {
            const tryAgainButton = screen.getByRole('button', { name: /start a new game/i });

            // Test Enter key
            fireEvent.keyDown(tryAgainButton, { key: 'Enter' });
            expect(mockOnPlayAgain).toHaveBeenCalled();

            // Reset mock
            mockOnPlayAgain.mockClear();

            // Test Space key
            fireEvent.keyDown(tryAgainButton, { key: ' ' });
            expect(mockOnPlayAgain).toHaveBeenCalled();
        });
    });
});
