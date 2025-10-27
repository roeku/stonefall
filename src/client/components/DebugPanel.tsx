import React, { useEffect, useRef, useState } from 'react';
import { subscribeDebug, getDebugLogs, DebugLogEntry, clearDebugLogs } from '../../shared/simulation/debugLog';

interface FilterState {
    text: string;
    areas: Record<string, boolean>; // selected areas
}

const ALL_AREAS = ['SCORING', 'SPEED', 'DROP'];

export const DebugPanel: React.FC<{ visible: boolean; onClose: () => void }> = ({ visible, onClose }) => {
    const [logs, setLogs] = useState<DebugLogEntry[]>(() => getDebugLogs());
    const [filter, setFilter] = useState<FilterState>({ text: '', areas: {} });
    const containerRef = useRef<HTMLDivElement | null>(null);
    const [autoScroll, setAutoScroll] = useState(true);

    useEffect(() => {
        if (!visible) return;
        const unsub = subscribeDebug((e) => {
            setLogs((prev) => [...prev, e]);
        });
        return () => unsub();
    }, [visible]);

    useEffect(() => {
        if (visible && autoScroll && containerRef.current) {
            containerRef.current.scrollTop = containerRef.current.scrollHeight;
        }
    }, [logs, visible, autoScroll]);

    const toggleArea = (area: string) => {
        setFilter((f) => ({ ...f, areas: { ...f.areas, [area]: !f.areas[area] } }));
    };

    const clear = () => {
        clearDebugLogs();
        setLogs([]);
    };

    const filtered = logs.filter((l) => {
        if (filter.text && !JSON.stringify(l).toLowerCase().includes(filter.text.toLowerCase())) return false;
        const activeAreas = Object.keys(filter.areas).filter((k) => filter.areas[k]);
        if (activeAreas.length && !activeAreas.includes(l.area)) return false;
        return true;
    });

    if (!visible) return null;

    return (
        <div style={panelStyle}>
            <div style={headerStyle}>
                <strong>Debug Panel</strong>
                <div style={{ display: 'flex', gap: 8 }}>
                    <input
                        placeholder="filter text"
                        value={filter.text}
                        onChange={(e) => setFilter({ ...filter, text: e.target.value })}
                        style={{ fontSize: 12 }}
                    />
                    {ALL_AREAS.map((a) => (
                        <label key={a} style={{ fontSize: 11 }}>
                            <input type="checkbox" checked={!!filter.areas[a]} onChange={() => toggleArea(a)} /> {a}
                        </label>
                    ))}
                    <button onClick={() => setAutoScroll((v) => !v)} style={btnStyle}>
                        {autoScroll ? 'AutoScroll On' : 'AutoScroll Off'}
                    </button>
                    <button onClick={clear} style={btnStyle}>Clear</button>
                    <button onClick={onClose} style={btnStyle}>Close</button>
                </div>
            </div>
            <div ref={containerRef} style={logContainerStyle}>
                {filtered.map((l, i) => (
                    <div key={i} style={rowStyle}>
                        <span style={areaStyle(l.area)}>[{l.area}]</span>{' '}
                        <span style={msgStyle}>{l.msg}</span>{' '}
                        {l.data && (
                            <span style={dataStyle}>{JSON.stringify(l.data)}</span>
                        )}
                    </div>
                ))}
                {!filtered.length && <div style={{ fontSize: 12, opacity: 0.6 }}>No logs</div>}
            </div>
        </div>
    );
};

// Inline styles (simple & non-intrusive)
const panelStyle: React.CSSProperties = {
    position: 'absolute',
    top: 8,
    right: 8,
    width: 420,
    height: 300,
    background: 'rgba(10,10,15,0.92)',
    color: '#eee',
    border: '1px solid #444',
    borderRadius: 6,
    fontFamily: 'monospace',
    fontSize: 12,
    display: 'flex',
    flexDirection: 'column',
    zIndex: 9999,
    boxShadow: '0 2px 6px rgba(0,0,0,0.4)'
};

const headerStyle: React.CSSProperties = {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: '4px 8px',
    borderBottom: '1px solid #333',
    background: 'rgba(255,255,255,0.04)'
};

const logContainerStyle: React.CSSProperties = {
    flex: 1,
    overflow: 'auto',
    padding: 8,
    display: 'flex',
    flexDirection: 'column',
    gap: 2
};

const rowStyle: React.CSSProperties = {
    whiteSpace: 'nowrap',
    textOverflow: 'ellipsis',
    overflow: 'hidden'
};

const msgStyle: React.CSSProperties = { color: '#fff' };
const dataStyle: React.CSSProperties = { color: '#aaa' };

const areaStyle = (area: string): React.CSSProperties => ({
    color: area === 'SCORING' ? '#4fc3f7' : area === 'SPEED' ? '#ffb74d' : '#ce93d8'
});

const btnStyle: React.CSSProperties = {
    background: '#222',
    color: '#ccc',
    border: '1px solid #444',
    borderRadius: 4,
    padding: '2px 6px',
    fontSize: 11,
    cursor: 'pointer'
};
