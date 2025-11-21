import React, { useRef, useState } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { Html } from '@react-three/drei';

interface SimplePerfProps {
  position?: 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right';
}

/**
 * Simple performance monitor without Web Workers
 * Compatible with Reddit's CSP restrictions
 */
export const SimplePerf: React.FC<SimplePerfProps> = ({ position = 'top-right' }) => {
  const { gl } = useThree();
  const [stats, setStats] = useState({
    fps: 0,
    ms: 0,
    calls: 0,
    triangles: 0,
    points: 0,
    lines: 0,
    geometries: 0,
    textures: 0,
    programs: 0,
  });

  const frameCount = useRef(0);
  const lastTime = useRef(performance.now());
  const frames = useRef<number[]>([]);

  useFrame(() => {
    frameCount.current++;
    const now = performance.now();

    // Update every 30 frames (~0.5 seconds at 60fps)
    if (frameCount.current % 30 === 0) {
      const delta = now - lastTime.current;
      const fps = Math.round((30 * 1000) / delta);
      const ms = Math.round(delta / 30);

      // Track frame history for averaging
      frames.current.push(fps);
      if (frames.current.length > 60) frames.current.shift();

      const info = gl.info;

      setStats({
        fps: isFinite(fps) ? fps : 0,
        ms: isFinite(ms) ? ms : 0,
        calls: info.render.calls || 0,
        triangles: info.render.triangles || 0,
        points: info.render.points || 0,
        lines: info.render.lines || 0,
        geometries: info.memory.geometries || 0,
        textures: info.memory.textures || 0,
        programs: (info.programs?.length || 0),
      });

      lastTime.current = now;
    }
  });

  const getPositionStyle = () => {
    const base = {
      position: 'fixed' as const,
      zIndex: 10000,
      pointerEvents: 'none' as const,
      userSelect: 'none' as const,
    };

    switch (position) {
      case 'top-left':
        return { ...base, top: '10px', left: '10px' };
      case 'top-right':
        return { ...base, top: '10px', right: '10px' };
      case 'bottom-left':
        return { ...base, bottom: '10px', left: '10px' };
      case 'bottom-right':
        return { ...base, bottom: '10px', right: '10px' };
      default:
        return { ...base, top: '10px', right: '10px' };
    }
  };

  const getFPSColor = () => {
    if (stats.fps >= 55) return '#00ff00';
    if (stats.fps >= 30) return '#ffff00';
    return '#ff0000';
  };

  const getCallsColor = () => {
    if (stats.calls <= 50) return '#00ff00';
    if (stats.calls <= 100) return '#ffff00';
    return '#ff8800';
  };

  return (
    <Html
      occlude={false}
      transform={false}
      style={getPositionStyle()}
    >
      <div
        style={{
          background: 'rgba(0, 0, 0, 0.85)',
          border: '1px solid rgba(0, 242, 254, 0.5)',
          borderRadius: '6px',
          padding: '8px 12px',
          fontFamily: 'monospace',
          fontSize: '11px',
          color: '#00f2fe',
          minWidth: '200px',
          boxShadow: '0 0 15px rgba(0, 242, 254, 0.3)',
        }}
      >
        {/* Header */}
        <div
          style={{
            fontSize: '12px',
            fontWeight: 'bold',
            color: '#ffffff',
            marginBottom: '8px',
            borderBottom: '1px solid rgba(0, 242, 254, 0.3)',
            paddingBottom: '4px',
          }}
        >
          ⚡ Performance
        </div>

        {/* Stats Grid */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
          {/* FPS & MS */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ color: '#aaaaaa' }}>FPS</span>
            <span style={{ color: getFPSColor(), fontWeight: 'bold', fontSize: '13px' }}>
              {stats.fps}
            </span>
          </div>

          <div style={{ display: 'flex', justifyContent: 'space-between' }}>
            <span style={{ color: '#aaaaaa' }}>ms</span>
            <span style={{ color: stats.ms > 20 ? '#ff8800' : '#00ff00' }}>
              {stats.ms}
            </span>
          </div>

          {/* Separator */}
          <div
            style={{
              borderTop: '1px solid rgba(0, 242, 254, 0.2)',
              margin: '4px 0',
            }}
          />

          {/* Render Stats */}
          <div style={{ display: 'flex', justifyContent: 'space-between' }}>
            <span style={{ color: '#aaaaaa' }}>Calls</span>
            <span style={{ color: getCallsColor() }}>{stats.calls}</span>
          </div>

          <div style={{ display: 'flex', justifyContent: 'space-between' }}>
            <span style={{ color: '#aaaaaa' }}>Triangles</span>
            <span>{stats.triangles.toLocaleString()}</span>
          </div>

          {stats.lines > 0 && (
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span style={{ color: '#aaaaaa' }}>Lines</span>
              <span>{stats.lines.toLocaleString()}</span>
            </div>
          )}

          {/* Separator */}
          <div
            style={{
              borderTop: '1px solid rgba(0, 242, 254, 0.2)',
              margin: '4px 0',
            }}
          />

          {/* Memory Stats */}
          <div style={{ display: 'flex', justifyContent: 'space-between' }}>
            <span style={{ color: '#aaaaaa' }}>Geometries</span>
            <span>{stats.geometries}</span>
          </div>

          <div style={{ display: 'flex', justifyContent: 'space-between' }}>
            <span style={{ color: '#aaaaaa' }}>Textures</span>
            <span>{stats.textures}</span>
          </div>

          <div style={{ display: 'flex', justifyContent: 'space-between' }}>
            <span style={{ color: '#aaaaaa' }}>Programs</span>
            <span>{stats.programs}</span>
          </div>
        </div>

        {/* Footer */}
        <div
          style={{
            fontSize: '9px',
            color: 'rgba(255, 255, 255, 0.4)',
            marginTop: '6px',
            paddingTop: '6px',
            borderTop: '1px solid rgba(0, 242, 254, 0.2)',
            textAlign: 'center',
          }}
        >
          GPU: {gl.capabilities.isWebGL2 ? 'WebGL2' : 'WebGL1'}
        </div>
      </div>
    </Html>
  );
};
