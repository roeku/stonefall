import React, { useState, useEffect } from 'react';
import { useGameData } from '../hooks/useGameData';
import { TowerMapEntry } from '../../shared/types/api';
import TowerVisualization from './TowerVisualization';

interface TowerMapProps {
    maxTowers?: number;
    showUserFilter?: boolean;
    showGameModeFilter?: boolean;
}

export const TowerMap: React.FC<TowerMapProps> = ({
    maxTowers = 50,
    showUserFilter = true,
    showGameModeFilter = true,
}) => {
    const { getTowerMap, isLoading, error } = useGameData();
    const [towers, setTowers] = useState<TowerMapEntry[]>([]);
    const [totalCount, setTotalCount] = useState(0);
    const [selectedTower, setSelectedTower] = useState<TowerMapEntry | null>(null);
    const [userFilter, setUserFilter] = useState('');
    const [gameModeFilter, setGameModeFilter] = useState('');
    const [sortBy, setSortBy] = useState<'score' | 'blocks' | 'streak' | 'recent'>('score');

    useEffect(() => {
        loadTowers();
    }, []);

    const loadTowers = async () => {
        try {
            const result = await getTowerMap(maxTowers, 0);
            if (result) {
                setTowers(result.towers);
                setTotalCount(result.totalCount);
            }
        } catch (error) {
            console.error('Failed to load towers:', error);
        }
    };

    const filteredAndSortedTowers = towers
        .filter(tower => {
            if (userFilter && !tower.username.toLowerCase().includes(userFilter.toLowerCase())) {
                return false;
            }
            if (gameModeFilter && tower.gameMode !== gameModeFilter) {
                return false;
            }
            return true;
        })
        .sort((a, b) => {
            switch (sortBy) {
                case 'score':
                    return b.score - a.score;
                case 'blocks':
                    return b.blockCount - a.blockCount;
                case 'streak':
                    return b.perfectStreak - a.perfectStreak;
                case 'recent':
                    return b.timestamp - a.timestamp;
                default:
                    return 0;
            }
        });

    const uniqueGameModes = Array.from(new Set(towers.map(t => t.gameMode)));

    if (error) {
        return (
            <div style={{
                padding: '20px',
                textAlign: 'center',
                color: '#ff6b6b',
                background: 'rgba(255, 107, 107, 0.1)',
                borderRadius: '8px',
                border: '1px solid rgba(255, 107, 107, 0.3)'
            }}>
                Error loading tower map: {error}
            </div>
        );
    }

    return (
        <div style={{
            padding: '20px',
            background: 'linear-gradient(135deg, #1a1a2e, #16213e)',
            borderRadius: '12px',
            color: 'white'
        }}>
            <h2 style={{
                margin: '0 0 20px 0',
                textAlign: 'center',
                background: 'linear-gradient(45deg, #4facfe, #00f2fe)',
                WebkitBackgroundClip: 'text',
                WebkitTextFillColor: 'transparent',
                fontSize: '24px'
            }}>
                Tower Map ({totalCount} towers)
            </h2>

            {/* Filters and Controls */}
            <div style={{
                display: 'flex',
                gap: '12px',
                marginBottom: '20px',
                flexWrap: 'wrap',
                alignItems: 'center'
            }}>
                {showUserFilter && (
                    <input
                        type="text"
                        placeholder="Filter by username..."
                        value={userFilter}
                        onChange={(e) => setUserFilter(e.target.value)}
                        style={{
                            padding: '8px 12px',
                            borderRadius: '6px',
                            border: '1px solid #444',
                            background: 'rgba(255, 255, 255, 0.1)',
                            color: 'white',
                            fontSize: '14px'
                        }}
                    />
                )}

                {showGameModeFilter && uniqueGameModes.length > 1 && (
                    <select
                        value={gameModeFilter}
                        onChange={(e) => setGameModeFilter(e.target.value)}
                        style={{
                            padding: '8px 12px',
                            borderRadius: '6px',
                            border: '1px solid #444',
                            background: 'rgba(255, 255, 255, 0.1)',
                            color: 'white',
                            fontSize: '14px'
                        }}
                    >
                        <option value="">All Game Modes</option>
                        {uniqueGameModes.map(mode => (
                            <option key={mode} value={mode}>{mode}</option>
                        ))}
                    </select>
                )}

                <select
                    value={sortBy}
                    onChange={(e) => setSortBy(e.target.value as any)}
                    style={{
                        padding: '8px 12px',
                        borderRadius: '6px',
                        border: '1px solid #444',
                        background: 'rgba(255, 255, 255, 0.1)',
                        color: 'white',
                        fontSize: '14px'
                    }}
                >
                    <option value="score">Sort by Score</option>
                    <option value="blocks">Sort by Height</option>
                    <option value="streak">Sort by Perfect Blocks</option>
                    <option value="recent">Sort by Recent</option>
                </select>

                <button
                    onClick={loadTowers}
                    disabled={isLoading}
                    style={{
                        padding: '8px 16px',
                        borderRadius: '6px',
                        border: 'none',
                        background: 'linear-gradient(45deg, #4facfe, #00f2fe)',
                        color: 'white',
                        fontSize: '14px',
                        cursor: isLoading ? 'not-allowed' : 'pointer',
                        opacity: isLoading ? 0.6 : 1
                    }}
                >
                    {isLoading ? 'Loading...' : 'Refresh'}
                </button>
            </div>

            {/* Tower Grid */}
            <div style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))',
                gap: '16px',
                marginBottom: '20px'
            }}>
                {filteredAndSortedTowers.map((tower) => (
                    <div
                        key={tower.sessionId}
                        onClick={() => setSelectedTower(tower)}
                        style={{
                            background: 'rgba(255, 255, 255, 0.05)',
                            borderRadius: '8px',
                            padding: '12px',
                            cursor: 'pointer',
                            border: selectedTower?.sessionId === tower.sessionId
                                ? '2px solid #4facfe'
                                : '1px solid rgba(255, 255, 255, 0.1)',
                            transition: 'all 0.2s ease',
                            ':hover': {
                                background: 'rgba(255, 255, 255, 0.1)'
                            }
                        }}
                    >
                        <div style={{ marginBottom: '8px' }}>
                            <TowerVisualization
                                towerBlocks={tower.towerBlocks}
                                width={256}
                                height={160}
                                showStats={false}
                                interactive={false}
                            />
                        </div>

                        <div style={{ fontSize: '14px', lineHeight: '1.4' }}>
                            <div style={{
                                fontWeight: 'bold',
                                marginBottom: '4px',
                                color: '#4facfe'
                            }}>
                                {tower.username}
                            </div>
                            <div>Score: {(tower.score || 0).toLocaleString()}</div>
                            <div>Height: {tower.blockCount} blocks</div>
                            {tower.perfectStreak > 0 && (
                                <div>Perfect Blocks: {tower.perfectStreak}</div>
                            )}
                            <div style={{
                                fontSize: '12px',
                                color: '#888',
                                marginTop: '4px'
                            }}>
                                {tower.gameMode} • {new Date(tower.timestamp).toLocaleDateString()}
                            </div>
                        </div>
                    </div>
                ))}
            </div>

            {filteredAndSortedTowers.length === 0 && !isLoading && (
                <div style={{
                    textAlign: 'center',
                    padding: '40px',
                    color: '#888',
                    fontSize: '16px'
                }}>
                    {towers.length === 0 ? 'No towers found' : 'No towers match your filters'}
                </div>
            )}

            {/* Selected Tower Detail Modal */}
            {selectedTower && (
                <div style={{
                    position: 'fixed',
                    top: 0,
                    left: 0,
                    right: 0,
                    bottom: 0,
                    background: 'rgba(0, 0, 0, 0.8)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    zIndex: 1000
                }}>
                    <div style={{
                        background: 'linear-gradient(135deg, #1a1a2e, #16213e)',
                        borderRadius: '12px',
                        padding: '24px',
                        maxWidth: '600px',
                        maxHeight: '80vh',
                        overflow: 'auto',
                        position: 'relative'
                    }}>
                        <button
                            onClick={() => setSelectedTower(null)}
                            style={{
                                position: 'absolute',
                                top: '12px',
                                right: '12px',
                                background: 'none',
                                border: 'none',
                                color: 'white',
                                fontSize: '24px',
                                cursor: 'pointer'
                            }}
                        >
                            ×
                        </button>

                        <h3 style={{
                            margin: '0 0 16px 0',
                            color: '#4facfe'
                        }}>
                            {selectedTower.username}'s Tower
                        </h3>

                        <div style={{ marginBottom: '16px' }}>
                            <TowerVisualization
                                towerBlocks={selectedTower.towerBlocks}
                                width={400}
                                height={300}
                                showStats={true}
                                interactive={true}
                            />
                        </div>

                        <div style={{
                            display: 'grid',
                            gridTemplateColumns: '1fr 1fr',
                            gap: '12px',
                            fontSize: '14px'
                        }}>
                            <div>
                                <strong>Score:</strong> {(selectedTower.score || 0).toLocaleString()}
                            </div>
                            <div>
                                <strong>Height:</strong> {selectedTower.blockCount} blocks
                            </div>
                            <div>
                                <strong>Perfect Blocks:</strong> {selectedTower.perfectStreak}
                            </div>
                            <div>
                                <strong>Game Mode:</strong> {selectedTower.gameMode}
                            </div>
                            <div style={{ gridColumn: '1 / -1' }}>
                                <strong>Date:</strong> {new Date(selectedTower.timestamp || Date.now()).toLocaleString()}
                            </div>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

export default TowerMap;
