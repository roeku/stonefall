"""Flash and motion check for a folder of video frames, against Reddit's guidance: no more than
three whole-screen flashes a second, and slow pans and zooms.

  flash  -- per pair of frames, the step in mean relative luminance, and the share of the frame
            whose luminance changes by 10% or more (WCAG's threshold, darker side below 0.8).
            Thin bright lines moving at all raise the share, so it is reported, not judged.
  motion -- the dominant shift between frames by phase correlation, as a share of the frame
            width per second: the speed a pan reads at.

Usage: python3 -I flashcheck.py frames_dir [fps]"""
import sys, glob
import numpy as np
from PIL import Image

fs = sorted(glob.glob(sys.argv[1] + '/*.png'))
fps = float(sys.argv[2]) if len(sys.argv) > 2 else 30
W, H = 300, 200

def load(path):
    im = Image.open(path).convert('RGB').resize((W, H), Image.BOX)
    a = np.asarray(im).astype(float) / 255
    c = np.where(a <= 0.04045, a / 12.92, ((a + 0.055) / 1.055) ** 2.4)
    return 0.2126 * c[..., 0] + 0.7152 * c[..., 1] + 0.0722 * c[..., 2]

def shift(a, b):
    A, B = np.fft.fft2(a - a.mean()), np.fft.fft2(b - b.mean())
    R = A * np.conj(B)
    r = np.abs(np.fft.ifft2(R / (np.abs(R) + 1e-9)))
    y, x = np.unravel_index(r.argmax(), r.shape)
    y = y - H if y > H // 2 else y
    x = x - W if x > W // 2 else x
    return abs(x) + abs(y)

L = [load(f) for f in fs]
pairs = list(zip(L, L[1:]))
step = np.array([abs(b.mean() - a.mean()) for a, b in pairs])
share = np.array([((np.abs(b - a) >= 0.1) & (np.minimum(a, b) < 0.8)).mean() for a, b in pairs])
speed = np.array([shift(a, b) for a, b in pairs]) / W * fps  # frame widths per second
# Smooth over a fifth of a second: one frame's correlation peak can jump.
k = max(1, int(fps / 5))
smooth = np.convolve(speed, np.ones(k) / k, mode='same')
i = int(smooth.argmax())
print(f'{len(fs)} frames')
print(f'flash : largest step in mean luminance {step.max():.3f}; '
      f'largest share of the frame changing 10%+ at once {share.max():.0%}')
print(f'motion: median {np.median(smooth):.0%} of the width per second, '
      f'95th percentile {np.percentile(smooth, 95):.0%}, peak {smooth.max():.0%} at {(i + 1) / fps:.1f}s')
