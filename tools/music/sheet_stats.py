"""Per-cue stats for a recorded sheet: level, loudness, and the pitches each cue sounds.
python3 sheet_stats.py sheet.wav sheet.json"""
import json, subprocess, sys, re
import numpy as np
SR = 48000
NAMES = ['C','C#','D','D#','E','F','F#','G','G#','A','A#','B']
E_MINOR = {4, 6, 7, 9, 11, 0, 2}
def load(path):
    raw = subprocess.run(['ffmpeg','-v','error','-i',path,'-ac','2','-ar',str(SR),'-f','f32le','-'],capture_output=True).stdout
    return np.frombuffer(raw, dtype=np.float32).reshape(-1, 2)
def loudness(seg):
    """Max momentary loudness (LUFS, 400 ms), via ffmpeg's ebur128."""
    p = subprocess.run(['ffmpeg','-v','info','-f','f32le','-ar',str(SR),'-ac','2','-i','-','-af','ebur128=peak=true','-f','null','-'],
                       input=seg.astype(np.float32).tobytes(), capture_output=True)
    ms = [float(m) for m in re.findall(r'M:\s*(-?[\d.]+)', p.stderr.decode())]
    return max(ms) if ms else float('nan')
def peaks(mono, lo=70, hi=4500, n=6):
    """The strongest spectral peaks over the cue, as notes with their cents off equal temperament."""
    N = 1 << 15
    seg = mono[:N] if len(mono) >= N else np.pad(mono, (0, N - len(mono)))
    spec = np.abs(np.fft.rfft(seg * np.hanning(N)))
    f = np.fft.rfftfreq(N, 1 / SR)
    m = (f > lo) & (f < hi)
    s = spec.copy(); s[~m] = 0
    out = []
    for _ in range(n):
        i = int(np.argmax(s))
        if s[i] <= 0: break
        # parabolic interpolation for the true peak
        a, b, c = np.log(spec[i-1]+1e-12), np.log(spec[i]+1e-12), np.log(spec[i+1]+1e-12)
        d = 0.5 * (a - c) / (a - 2*b + c)
        fr = (i + d) * SR / N
        midi = 69 + 12 * np.log2(fr / 440)
        note = int(round(midi)); cents = (midi - note) * 100
        out.append((fr, f"{NAMES[note % 12]}{note // 12 - 1}", cents, note % 12 in E_MINOR, 20*np.log10(spec[i]/spec.max()+1e-12)))
        s[max(0, i-12):i+13] = 0
    return out
x = load(sys.argv[1])
cues = json.load(open(sys.argv[2]))
for k, c in enumerate(cues[:-1]):
    a = int(c['t'] * SR); b = int(cues[k+1]['t'] * SR)
    seg = x[a:b]
    mono = seg.mean(axis=1)
    pk = 20*np.log10(np.abs(seg).max() + 1e-12)
    lu = loudness(seg)
    ps = peaks(mono)
    notes = ' '.join(f"{n}{'' if ink else '!'}{cents:+.0f}" for fr, n, cents, ink, rel in ps)
    print(f"{c['label']:22s} peak {pk:6.1f} dBFS  loudest {lu:6.1f} LUFS   {notes}")
