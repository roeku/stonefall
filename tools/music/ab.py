"""Old then new for each effect, in one file: python3 ab.py before.wav before.json after.wav after.json out.mp3"""
import json, subprocess, sys
import numpy as np
SR = 48000
def load(p):
    raw = subprocess.run(['ffmpeg','-v','error','-i',p,'-ac','2','-ar',str(SR),'-f','f32le','-'],capture_output=True).stdout
    return np.frombuffer(raw, dtype=np.float32).reshape(-1, 2)
A, B = load(sys.argv[1]), load(sys.argv[3])
ca, cb = json.load(open(sys.argv[2])), json.load(open(sys.argv[4]))
CAP = {'game over': 5.5, 'game over, new best': 5.5, 'out, yours': 5.5, 'crumble big': 3.0}
def clip(x, cues, label):
    i = next(k for k, c in enumerate(cues) if c['label'] == label)
    a = cues[i]['t'] - 0.08
    b = min(cues[i + 1]['t'], cues[i]['t'] + CAP.get(label, 9))
    seg = x[int(a * SR):int(b * SR)].copy()
    fade = int(0.25 * SR)
    seg[-fade:] *= np.linspace(1, 0, fade)[:, None]
    return seg
labels = [c['label'] for c in ca[:-1]]
out, t, lines = [], 0.0, []
gap = lambda s: np.zeros((int(s * SR), 2), np.float32)
for lab in labels:
    for name, x, cues in (('old', A, ca), ('new', B, cb)):
        seg = clip(x, cues, lab)
        lines.append(f"{int(t // 60)}:{t % 60:04.1f}  {lab}, {name}")
        out += [seg, gap(0.6 if name == 'old' else 1.4)]
        t += len(seg) / SR + (0.6 if name == 'old' else 1.4)
y = np.concatenate(out)
subprocess.run(['ffmpeg','-v','error','-y','-f','f32le','-ar',str(SR),'-ac','2','-i','-','-b:a','192k',sys.argv[5]], input=y.astype(np.float32).tobytes(), check=True)
print('\n'.join(lines))
print(f'total {t:.0f}s')
