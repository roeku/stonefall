import * as THREE from 'three';

// Font loading state
let fontLoaded = false;
let fontLoadPromise: Promise<void> | null = null;

// Load Orbitron font for canvas rendering
export const loadOrbitronFont = (): Promise<void> => {
  if (fontLoaded) {
    return Promise.resolve();
  }

  if (fontLoadPromise) {
    return fontLoadPromise;
  }

  fontLoadPromise = new Promise((resolve) => {
    // Create font face for Orbitron
    const fontFace = new FontFace('Orbitron', 'url(/Orbitron/static/Orbitron-Regular.ttf)');

    fontFace
      .load()
      .then((loadedFace) => {
        (document.fonts as any).add(loadedFace);
        fontLoaded = true;
        console.log('✓ Orbitron font loaded successfully');
        resolve();
      })
      .catch((error) => {
        console.log('⚠️ Orbitron font failed to load, using fallback:', error);
        fontLoaded = true; // Mark as loaded to prevent retries
        resolve();
      });
  });

  return fontLoadPromise;
};

// Enhanced text texture creation with Orbitron font
export const createOrbitronTextTexture = (
  text: string,
  size: number,
  color: string,
  backgroundColor = 'rgba(0,0,0,0)'
): THREE.CanvasTexture => {
  const canvas = document.createElement('canvas');
  const canvasSize = 512;
  canvas.width = canvas.height = canvasSize;
  const ctx = canvas.getContext('2d')!;

  // Clear background
  ctx.fillStyle = backgroundColor;
  ctx.fillRect(0, 0, canvasSize, canvasSize);

  // Use Orbitron font with proper fallbacks
  ctx.font = `bold ${size}px "Orbitron", "Exo 2", "Roboto", "Arial", monospace`;
  ctx.fillStyle = color;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

  // Enhanced glow effect for Tron aesthetic
  ctx.shadowColor = color;
  ctx.shadowBlur = 8;
  ctx.fillText(text, canvasSize / 2, canvasSize / 2);

  // Second glow layer for depth
  ctx.shadowBlur = 4;
  ctx.fillText(text, canvasSize / 2, canvasSize / 2);

  // Clean text on top for sharpness
  ctx.shadowBlur = 0;
  ctx.fillText(text, canvasSize / 2, canvasSize / 2);

  const texture = new THREE.CanvasTexture(canvas);
  texture.needsUpdate = true;
  return texture;
};

// Async version that ensures font is loaded first
export const createOrbitronTextTextureAsync = async (
  text: string,
  size: number,
  color: string,
  backgroundColor = 'rgba(0,0,0,0)'
): Promise<THREE.CanvasTexture> => {
  // Ensure font is loaded first
  await loadOrbitronFont();

  // Small delay to ensure font is fully available
  await new Promise((resolve) => setTimeout(resolve, 10));

  return createOrbitronTextTexture(text, size, color, backgroundColor);
};
