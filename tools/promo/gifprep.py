"""Temporal threshold for GIF frames, by tile: an 8x8 tile keeps its previous pixels unless any
pixel in it moved by more than T (max over RGB), in which case the whole tile updates. Slowly
varying glow then stops changing every frame, so GIF differencing leaves it transparent, and a
tile is never half old and half new, which is what made per-pixel freezing smear.
Usage: python3 -I gifprep.py in_dir out_dir T [tile]"""
import sys, glob, os
import numpy as np
from PIL import Image
src, dst, T = sys.argv[1], sys.argv[2], int(sys.argv[3])
tile = int(sys.argv[4]) if len(sys.argv) > 4 else 8
os.makedirs(dst, exist_ok=True)
fs = sorted(glob.glob(os.path.join(src, '*.png')))
prev = None
for i, f in enumerate(fs):
    cur = np.asarray(Image.open(f).convert('RGB')).astype(np.int16)
    if prev is None:
        out = cur.copy()
    else:
        h, w, _ = cur.shape
        d = np.abs(cur - prev).max(axis=2)
        H, W = (h + tile - 1) // tile, (w + tile - 1) // tile
        pad = np.zeros((H * tile, W * tile), np.int16)
        pad[:h, :w] = d
        moved = pad.reshape(H, tile, W, tile).max(axis=(1, 3)) > T
        mask = np.repeat(np.repeat(moved, tile, 0), tile, 1)[:h, :w]
        out = np.where(mask[..., None], cur, prev)
    Image.fromarray(out.astype(np.uint8)).save(os.path.join(dst, '%05d.png' % i))
    prev = out
print(len(fs), 'frames')
