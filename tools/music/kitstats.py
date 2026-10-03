"""Loudness of a filmed run, its landings and its end: python3 kitstats.py out/kit-grid.mp4"""
import json, re, subprocess, sys
import numpy as np
SR = 48000
mp4 = sys.argv[1]
d = json.load(open(mp4.replace('.mp4', '.json')))
raw = subprocess.run(['ffmpeg','-v','error','-i',mp4,'-vn','-ac','2','-ar',str(SR),'-f','f32le','-'],capture_output=True).stdout
x = np.frombuffer(raw, dtype=np.float32).reshape(-1, 2)
def lufs(seg):
    p = subprocess.run(['ffmpeg','-v','info','-f','f32le','-ar',str(SR),'-ac','2','-i','-','-af','ebur128=peak=true','-f','null','-'], input=seg.astype(np.float32).tobytes(), capture_output=True)
    e = p.stderr.decode()
    ms = [float(m) for m in re.findall(r'M:\s*(-?[\d.]+)', e)]
    summ = e.split('Summary:')[-1]
    I = re.findall(r'I:\s*(-?[\d.]+) LUFS', summ)
    return (max(ms) if ms else float('nan')), (float(I[0]) if I else float('nan'))
# film time of a logged epoch: film starts at recEpoch + offset... use the drop times printed: first frame t0 is unknown here,
# so find the run's landings by onsets instead: loudest moments.
mono = x.mean(axis=1)
pk = 20*np.log10(np.abs(x).max()+1e-9)
M, I = lufs(x)
print(f'{mp4}: peak {pk:.1f} dBFS, integrated {I:.1f} LUFS, loudest moment {M:.1f} LUFS')
# Between landings: the background alone, 0.5 s windows before each onset.
hop = int(0.01*SR)
env = np.array([np.sqrt(np.mean(mono[i:i+hop]**2)) for i in range(0, len(mono)-hop, hop)])
db = 20*np.log10(env+1e-9)
print(f'quietest 10% of the run: {np.percentile(db[:int(len(db)*0.8)],10):.1f} dB rms, median {np.median(db[:int(len(db)*0.8)]):.1f} dB, loudest 1% {np.percentile(db,99):.1f} dB')
