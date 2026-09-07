import React, { useEffect } from 'react';
import { useThree } from '@react-three/fiber';

interface PerformanceConnectorProps {
    onRendererReady: (gl: any) => void;
}

/**
 * Component that lives inside Canvas and passes renderer to parent
 */
export const PerformanceConnector: React.FC<PerformanceConnectorProps> = ({ onRendererReady }) => {
    const { gl } = useThree();

    useEffect(() => {
        onRendererReady(gl);
    }, [gl, onRendererReady]);

    return null;
};
