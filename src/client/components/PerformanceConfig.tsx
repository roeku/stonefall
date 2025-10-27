import React, { useEffect, useState } from 'react';

interface PerformanceSettings {
    pixelRatio: number;
    shadowsEnabled: boolean;
    antialiasing: boolean;
    precision: 'lowp' | 'mediump' | 'highp';
    maxTowers: number;
    animationQuality: 'low' | 'medium' | 'high';
}

const DEFAULT_SETTINGS: PerformanceSettings = {
    pixelRatio: 0.5,
    shadowsEnabled: false,
    antialiasing: false,
    precision: 'lowp',
    maxTowers: 50,
    animationQuality: 'low'
};

// Removed unused HIGH_PERFORMANCE_SETTINGS

export class PerformanceConfig {
    private static instance: PerformanceConfig;
    private settings: PerformanceSettings = DEFAULT_SETTINGS;
    private listeners: ((settings: PerformanceSettings) => void)[] = [];

    static getInstance(): PerformanceConfig {
        if (!PerformanceConfig.instance) {
            PerformanceConfig.instance = new PerformanceConfig();
        }
        return PerformanceConfig.instance;
    }

    getSettings(): PerformanceSettings {
        return { ...this.settings };
    }

    updateSettings(newSettings: Partial<PerformanceSettings>): void {
        this.settings = { ...this.settings, ...newSettings };
        this.notifyListeners();
    }

    autoAdjustForPerformance(fps: number): void {
        if (fps < 30) {
            // Very low performance - use minimal settings
            this.updateSettings({
                pixelRatio: 0.25,
                shadowsEnabled: false,
                antialiasing: false,
                precision: 'lowp',
                maxTowers: 25,
                animationQuality: 'low'
            });
            console.log('🔧 Auto-adjusted to minimal performance settings');
        } else if (fps < 45) {
            // Low performance - use default settings
            this.updateSettings(DEFAULT_SETTINGS);
            console.log('🔧 Auto-adjusted to default performance settings');
        } else if (fps > 55) {
            // Good performance - can use higher settings
            this.updateSettings({
                pixelRatio: 1.0,
                shadowsEnabled: false, // Keep shadows off for stability
                antialiasing: false,   // Keep antialiasing off for performance
                precision: 'mediump',
                maxTowers: 75,
                animationQuality: 'medium'
            });
            console.log('🔧 Auto-adjusted to medium performance settings');
        }
    }

    subscribe(listener: (settings: PerformanceSettings) => void): () => void {
        this.listeners.push(listener);
        return () => {
            const index = this.listeners.indexOf(listener);
            if (index > -1) {
                this.listeners.splice(index, 1);
            }
        };
    }

    private notifyListeners(): void {
        this.listeners.forEach(listener => listener(this.settings));
    }

    // Detect device capabilities and set initial settings
    detectAndSetOptimalSettings(): void {
        const canvas = document.createElement('canvas');
        const gl = canvas.getContext('webgl') as WebGLRenderingContext | null;

        if (!gl) {
            // No WebGL support - use minimal settings
            this.updateSettings({
                pixelRatio: 0.25,
                shadowsEnabled: false,
                antialiasing: false,
                precision: 'lowp',
                maxTowers: 10,
                animationQuality: 'low'
            });
            return;
        }

        // Check device capabilities
        const renderer = gl.getParameter(gl.RENDERER) || '';
        const isMobile = /Android|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
        const isLowEnd = renderer.toString().includes('Intel') || renderer.toString().includes('Mali') || isMobile;

        if (isLowEnd) {
            this.updateSettings(DEFAULT_SETTINGS);
            console.log('🔧 Detected low-end device, using default settings');
        } else {
            this.updateSettings({
                pixelRatio: 0.75,
                shadowsEnabled: false,
                antialiasing: false,
                precision: 'mediump',
                maxTowers: 75,
                animationQuality: 'medium'
            });
            console.log('🔧 Detected capable device, using medium settings');
        }

        canvas.remove();
    }
}

// React hook for using performance settings
export const usePerformanceSettings = () => {
    const [settings, setSettings] = useState<PerformanceSettings>(
        PerformanceConfig.getInstance().getSettings()
    );

    useEffect(() => {
        const config = PerformanceConfig.getInstance();
        const unsubscribe = config.subscribe(setSettings);

        // Detect optimal settings on first load
        config.detectAndSetOptimalSettings();

        return unsubscribe;
    }, []);

    return {
        settings,
        updateSettings: (newSettings: Partial<PerformanceSettings>) =>
            PerformanceConfig.getInstance().updateSettings(newSettings),
        autoAdjust: (fps: number) =>
            PerformanceConfig.getInstance().autoAdjustForPerformance(fps)
    };
};

// Performance settings UI component
export const PerformanceSettingsUI: React.FC<{ visible: boolean }> = ({ visible }) => {
    const { settings, updateSettings } = usePerformanceSettings();

    if (!visible) {
        return null;
    }

    return (
        <div style={{
            position: 'absolute',
            top: '10px',
            left: '10px',
            background: 'rgba(0, 0, 0, 0.8)',
            color: '#00ffff',
            padding: '12px',
            borderRadius: '8px',
            fontSize: '12px',
            fontFamily: 'monospace',
            minWidth: '200px',
            border: '1px solid #00ffff',
            zIndex: 1000
        }}>
            <div style={{ fontSize: '14px', marginBottom: '8px', fontWeight: 'bold' }}>
                ⚙️ PERFORMANCE SETTINGS
            </div>

            <div style={{ marginBottom: '8px' }}>
                <label>Pixel Ratio: {settings.pixelRatio}</label>
                <input
                    type="range"
                    min="0.25"
                    max="2"
                    step="0.25"
                    value={settings.pixelRatio}
                    onChange={(e) => updateSettings({ pixelRatio: parseFloat(e.target.value) })}
                    style={{ width: '100%', marginTop: '4px' }}
                />
            </div>

            <div style={{ marginBottom: '8px' }}>
                <label>Max Towers: {settings.maxTowers}</label>
                <input
                    type="range"
                    min="10"
                    max="100"
                    step="5"
                    value={settings.maxTowers}
                    onChange={(e) => updateSettings({ maxTowers: parseInt(e.target.value) })}
                    style={{ width: '100%', marginTop: '4px' }}
                />
            </div>

            <div style={{ marginBottom: '8px' }}>
                <label>
                    <input
                        type="checkbox"
                        checked={settings.shadowsEnabled}
                        onChange={(e) => updateSettings({ shadowsEnabled: e.target.checked })}
                    />
                    {' '}Shadows
                </label>
            </div>

            <div style={{ marginBottom: '8px' }}>
                <label>
                    <input
                        type="checkbox"
                        checked={settings.antialiasing}
                        onChange={(e) => updateSettings({ antialiasing: e.target.checked })}
                    />
                    {' '}Antialiasing
                </label>
            </div>

            <div style={{ marginBottom: '8px' }}>
                <label>Animation Quality:</label>
                <select
                    value={settings.animationQuality}
                    onChange={(e) => updateSettings({ animationQuality: e.target.value as any })}
                    style={{ width: '100%', marginTop: '4px', background: '#333', color: '#fff' }}
                >
                    <option value="low">Low</option>
                    <option value="medium">Medium</option>
                    <option value="high">High</option>
                </select>
            </div>

            <div style={{ fontSize: '10px', color: '#888', marginTop: '8px' }}>
                Press 'P' to toggle this panel
            </div>
        </div>
    );
};
