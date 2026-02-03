import React from 'react';

interface TronHudProps {
    children: React.ReactNode;
    className?: string;
    style?: React.CSSProperties;
}

export const TronHud: React.FC<TronHudProps> = ({ children, className = '', style = {} }) => {
    return (
        <div
            className={`tron-game-hud ${className}`}
            style={{
                width: 'unset',
                minWidth: 'unset',
                padding: '10px 20px',
                gap: '8px',
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                ...style
            }}
        >
            <div className="tron-hud-scan" style={{ display: 'flex', flexDirection: 'column' }} />
            {children}
        </div>
    );
};
