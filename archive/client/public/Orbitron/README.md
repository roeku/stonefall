# Orbitron Font Integration

This directory contains the Orbitron font files for the Tron-inspired UI elements.

## Font Files

Only the weights with a matching `@font-face` rule are kept here:

- `static/Orbitron-Regular.ttf` - Regular weight (400)
- `static/Orbitron-Medium.ttf` - Medium weight (500)
- `static/Orbitron-Bold.ttf` - Bold weight (700)

The SemiBold, ExtraBold, Black and variable-font files were never declared in CSS or loaded at
runtime; they now live in `archive/client/public/Orbitron/`.

## Usage

The font is used in the tower info popup and other UI elements through:

1. **CSS @font-face declarations** in `src/client/index.css`
2. **Canvas text rendering** for Three.js textures

## Font Loading Strategy

1. **Primary**: Local TTF files via the `@font-face` rules in `src/client/index.css`
2. **Fallback**: Google Fonts CDN version (`@import` at the top of `index.css`, weights 400/700/900)
3. **Final fallback**: System fonts (Arial, monospace)

This ensures the Orbitron font loads reliably across different environments while maintaining the futuristic Tron aesthetic.

Weight 900 (`font-weight: 900` in CSS) resolves via the Google Fonts CDN, not from a local file.

## Three.js Integration

The font is used for canvas-based text rendering in Three.js materials, providing:

- Sharp, crisp text at any scale
- Proper glow effects for the Tron aesthetic
- Reliable cross-browser compatibility
- Better performance than geometry-based text

## Converting to Three.js JSON Format (Optional)

If you ever need native Three.js font support, use the online converter:
https://gero3.github.io/facetype.js/

There used to be a `tools/convertFont.js` script for this. It never worked — it emitted JSON with
an empty `glyphs` object — and has been moved to `archive/tools/`. The canvas-based approach
currently in use is both more reliable and better looking.
