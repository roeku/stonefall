"""Greyscale contrast of the wordmark against what is right behind it.

Renders are compared with and without the logo (same preset, same size, so pixel-aligned): glyph
pixels are the ones the logo changed that are close to its ink colour, and the background is the
ring of pixels around the glyphs as shown (halo and scrim included). Reports WCAG contrast ratios
for the median and the brightest 5% of that ring; Reddit asks for roughly 3:1.
Usage: python3 -I contrast.py with_logo.png without_logo.png"""
import sys
import numpy as np
from PIL import Image, ImageFilter

def lum(a):
    c = a / 255.0
    c = np.where(c <= 0.04045, c / 12.92, ((c + 0.055) / 1.055) ** 2.4)
    return 0.2126 * c[..., 0] + 0.7152 * c[..., 1] + 0.0722 * c[..., 2]

a = np.asarray(Image.open(sys.argv[1]).convert('RGB')).astype(float)
b = np.asarray(Image.open(sys.argv[2]).convert('RGB')).astype(float)
ink = np.array([243, 247, 250])
glyph = (np.abs(a - ink).max(axis=2) < 18) & (np.abs(a - b).max(axis=2) > 40)
m = Image.fromarray((glyph * 255).astype(np.uint8))
r = max(4, int(round(a.shape[0] / 100)))
near = np.asarray(m.filter(ImageFilter.MaxFilter(2 * r + 1))) > 0
# Two pixels out from the glyphs: the anti-aliased edge of the letters is ink, not background.
edge = np.asarray(m.filter(ImageFilter.MaxFilter(5))) > 0
ring = near & ~edge
La = lum(a)
text = La[glyph].mean()
bg = La[ring]
ratio = lambda l1, l2: (max(l1, l2) + 0.05) / (min(l1, l2) + 0.05)
print(f'glyph px {glyph.sum()}, ring px {ring.sum()}, text L {text:.2f}: '
      f'median {ratio(text, np.median(bg)):.1f}:1, brightest 5% {ratio(text, np.percentile(bg, 95)):.1f}:1, '
      f'brightest 1% {ratio(text, np.percentile(bg, 99)):.1f}:1')
