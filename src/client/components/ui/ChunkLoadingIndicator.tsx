// Loading indicators for chunk streaming
import React from 'react';

interface ChunkLoadingIndicatorProps {
    loadingChunks: number;
    totalChunks: number;
    cameraPosition: { x: number; z: number };
}

export const ChunkLoadingIndicator: React.FC<ChunkLoadingIndicatorProps> = ({
    loadingChunks,
    totalChunks,
    cameraPosition
}) => {
    if (loadingChunks === 0) return null;

    return (
        <div
            className="absolute top-4 left-4 z-40 pointer-events-none"
            style={{
                background: 'rgba(0, 242, 254, 0.1)',
                border: '1px solid #00f2fe',
                borderRadius: '4px',
                padding: '8px 12px',
                backdropFilter: 'blur(4px)',
                fontFamily: 'monospace',
                fontSize: '11px',
                color: '#00f2fe',
                boxShadow: '0 0 10px rgba(0, 242, 254, 0.3)',
            }}
        >
            <div style={{ marginBottom: '4px', fontWeight: 'bold' }}>
                WORLD STREAMING
            </div>
            <div style={{ opacity: 0.8 }}>
                Loading {loadingChunks} chunk{loadingChunks !== 1 ? 's' : ''}...
            </div>
            <div style={{ opacity: 0.6, fontSize: '10px', marginTop: '2px' }}>
                Position: ({Math.round(cameraPosition.x)}, {Math.round(cameraPosition.z)})
            </div>

            {/* Loading animation */}
            <div
                style={{
                    width: '100%',
                    height: '2px',
                    background: 'rgba(0, 242, 254, 0.2)',
                    marginTop: '4px',
                    borderRadius: '1px',
                    overflow: 'hidden',
                }}
            >
                <div
                    style={{
                        width: '30%',
                        height: '100%',
                        background: '#00f2fe',
                        borderRadius: '1px',
                        animation: 'loadingSlide 1.5s ease-in-out infinite',
                    }}
                />
            </div>

            <style jsx>{`
        @keyframes loadingSlide {
          0% { transform: translateX(-100%); }
          50% { transform: translateX(233%); }
          100% { transform: translateX(-100%); }
        }
      `}</style>
        </div>
    );
};
