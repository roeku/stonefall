import React, { useEffect, useState } from 'react';

/**
 * AppStateMonitor - Detects when the Reddit app comes back from background
 * and forces a complete remount to reset all state.
 * 
 * This fixes the "first load works, subsequent loads don't" issue by ensuring
 * clean initialization every time the app becomes visible.
 */
export const AppStateMonitor: React.FC<{ children: React.ReactNode }> = ({ children }) => {
    const [mountKey, setMountKey] = useState(0);
    const [lastVisibleTime, setLastVisibleTime] = useState(Date.now());

    useEffect(() => {
        const handleVisibilityChange = () => {
            if (document.visibilityState === 'visible') {
                const now = Date.now();
                const timeSinceLastVisible = now - lastVisibleTime;

                // If app was hidden for more than 2 seconds, force remount
                if (timeSinceLastVisible > 2000) {
                    console.log('📱 App returned from background - FORCING REMOUNT');
                    setMountKey(prev => prev + 1);
                }

                setLastVisibleTime(now);
            }
        };

        const handleFocus = () => {
            // Also check on window focus events
            const now = Date.now();
            const timeSinceLastVisible = now - lastVisibleTime;

            if (timeSinceLastVisible > 2000) {
                console.log('📱 Window focused after pause - FORCING REMOUNT');
                setMountKey(prev => prev + 1);
            }

            setLastVisibleTime(now);
        };

        document.addEventListener('visibilitychange', handleVisibilityChange);
        window.addEventListener('focus', handleFocus);

        return () => {
            document.removeEventListener('visibilitychange', handleVisibilityChange);
            window.removeEventListener('focus', handleFocus);
        };
    }, [lastVisibleTime]);

    // Use key to force complete unmount/remount of entire app tree
    return <div key={mountKey}>{children}</div>;
};
