# Orbitron Font Integration

This directory contains the Orbitron font files for the Tron-inspired UI elements.

## Font Files

- `Orbitron-Regular.ttf` - Regular weight
- `Orbitron-Bold.ttf` - Bold weight
- `Orbitron-Medium.ttf` - Medium weight
- `Orbitron-SemiBold.ttf` - Semi-bold weight
- `Orbitron-ExtraBold.ttf` - Extra bold weight
- `Orbitron-Black.ttf` - Black weight
- `Orbitron-VariableFont_wght.ttf` - Variable font with all weights

## Usage

The font is automatically loaded and used in the tower info popup and other UI elements through:

1. **CSS @font-face declarations** in `src/client/index.css`
2. **JavaScript FontFace API** in `src/client/utils/fontLoader.ts`
3. **Canvas text rendering** for Three.js textures

## Font Loading Strategy

1. **Primary**: Local TTF files via FontFace API
2. **Fallback**: Google Fonts CDN version
3. **Final fallback**: System fonts (Arial, monospace)

This ensures the Orbitron font loads reliably across different environments while maintaining the futuristic Tron aesthetic.

## Three.js Integration

The font is used for canvas-based text rendering in Three.js materials, providing:

- Sharp, crisp text at any scale
- Proper glow effects for the Tron aesthetic
- Reliable cross-browser compatibility
- Better performance than geometry-based text

## Converting to Three.js JSON Format (Optional)

If you need native Three.js font support, you can:

1. Use the online converter: https://gero3.github.io/facetype.js/
2. Run the conversion script: `node tools/convertFont.js`
3. Place the resulting JSON files in `src/client/public/fonts/`

However, the current canvas-based approach is recommended for better reliability and visual quality.
