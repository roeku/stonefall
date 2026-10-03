"""Cut a finished track into the game's loops.

    python3 loops.py track.flac --bpm 118 [--bars 16] [--out out/loops]

The game's music is one track played as a few loops of the same length (a calm section, the main
groove, the peak) that run in sync and crossfade on phrase lines as the run builds. This finds
them: it checks the tempo, finds the beat and the bar, scores every bar for energy and brightness,
picks the three sections, and ends each loop where the music repeats its first bar, so the seam
falls between two near-identical moments and only a few milliseconds of crossfade are needed. It
also cuts the downbeat of the biggest drop as a one-shot hit. Needs numpy and ffmpeg.
"""

import argparse
import json
import os
import subprocess
import sys

import numpy as np

SR = 48000


def load(path):
    raw = subprocess.run(
        ['ffmpeg', '-v', 'error', '-i', path, '-ac', '2', '-ar', str(SR), '-f', 'f32le', '-'],
        capture_output=True, check=True,
    ).stdout
    return np.frombuffer(raw, dtype=np.float32).reshape(-1, 2).copy()


def save(path, audio):
    subprocess.run(
        ['ffmpeg', '-v', 'error', '-y', '-f', 'f32le', '-ar', str(SR), '-ac', '2', '-i', '-', '-c:a', 'pcm_f32le', path],
        input=audio.astype(np.float32).tobytes(), check=True,
    )


def onset_envelope(mono, hop=256, n=2048):
    """Spectral flux, low end weighted: where the kicks and the chords hit."""
    frames = 1 + (len(mono) - n) // hop
    idx = np.arange(n)[None, :] + hop * np.arange(frames)[:, None]
    spec = np.abs(np.fft.rfft(mono[idx] * np.hanning(n), axis=1))
    freqs = np.fft.rfftfreq(n, 1 / SR)
    weight = np.where(freqs < 200, 2.0, 1.0)
    logspec = np.log1p(spec * 100) * weight
    flux = np.maximum(0, np.diff(logspec, axis=0)).sum(axis=1)
    flux = np.concatenate([[0], flux])
    return flux - np.convolve(flux, np.ones(16) / 16, mode='same'), SR / hop


def measured_tempo(env, fps, near):
    """The tempo the onsets actually keep, searched near the one asked for."""
    best = None
    for bpm in np.arange(near - 4, near + 4.001, 0.02):
        period = 60 / bpm * fps
        score = 0.0
        for k in (1, 2, 4, 8):
            lag = period * k
            i = int(lag)
            if i + 1 >= len(env):
                break
            frac = lag - i
            a = np.dot(env[:-i], env[i:]) if i > 0 else 0
            b = np.dot(env[:-(i + 1)], env[i + 1:])
            score += ((1 - frac) * a + frac * b) / k
        if best is None or score > best[0]:
            best = (score, bpm)
    return best[1]


def beat_grid(env, fps, near):
    """Tempo and the first beat (seconds), fitted together: the grid whose beats land on the most
    onset energy across the whole track. Fitting them apart lets a small tempo error smear the
    phase; over a sixteen-bar loop a 0.3% error is 90 ms of drift."""
    t = np.arange(len(env))
    best = (-np.inf, near, 0.0)
    for bpm in np.arange(near - 0.6, near + 0.6, 0.002):
        period = 60 / bpm * fps
        beats = np.arange(int(len(env) / period) - 1) * period
        phases = np.arange(0, period, 0.5)
        pos = phases[:, None] + beats[None, :]
        score = np.interp(pos, t, env).mean(axis=1)
        i = int(np.argmax(score))
        if score[i] > best[0]:
            best = (score[i], bpm, phases[i] / fps)
    return best[1], best[2]


def loop_length(mono, s, n0, fps_hop=128):
    """The length (samples) near n0 after which the music best repeats what it did at s: the
    onsets of the two bars from s against those from s + n, then the waveform, finer."""
    env, fps = onset_envelope(mono[max(0, s - SR):s + n0 + 4 * SR], hop=fps_hop)
    off = (s - max(0, s - SR)) / SR * fps
    w = int(4 * fps)
    a = env[int(off):int(off) + w]
    best = (-np.inf, n0)
    for n in range(int(n0 * 0.98), int(n0 * 1.02), 16):
        j = off + n / SR * fps
        b = np.interp(np.arange(w) + j, np.arange(len(env)), env)
        score = np.dot(a, b) / (np.linalg.norm(a) * np.linalg.norm(b) + 1e-12)
        if score > best[0]:
            best = (score, n)
    # finer, on the waveform itself
    n1 = best[1]
    seg = mono[s:s + SR // 4]
    best2 = (-np.inf, n1)
    for n in range(n1 - 24, n1 + 25):
        other = mono[s + n:s + n + len(seg)]
        score = np.dot(seg, other) / (np.linalg.norm(seg) * np.linalg.norm(other) + 1e-12)
        if score > best2[0]:
            best2 = (score, n)
    return best2[1], best[0], best2[0]


def bar_features(audio, start, bar, count):
    mono = audio.mean(axis=1)
    feats = []
    for b in range(count):
        s = int((start + b * bar) * SR)
        e = int((start + (b + 1) * bar) * SR)
        seg = mono[s:e]
        if len(seg) < (e - s):
            break
        spec = np.abs(np.fft.rfft(seg * np.hanning(len(seg))))
        freqs = np.fft.rfftfreq(len(seg), 1 / SR)
        rms = np.sqrt(np.mean(seg ** 2))
        low = np.sqrt(np.sum(spec[(freqs > 30) & (freqs < 150)] ** 2))
        high = np.sqrt(np.sum(spec[freqs > 4000] ** 2))
        total = np.sqrt(np.sum(spec ** 2)) + 1e-9
        # a coarse spectrum per bar, to tell when one bar sounds like another
        bands = np.geomspace(40, 16000, 33)
        profile = np.array([np.sum(spec[(freqs >= bands[i]) & (freqs < bands[i + 1])] ** 2) for i in range(32)])
        profile = np.log1p(profile / (profile.sum() + 1e-12) * 1000)
        feats.append({
            'db': 20 * np.log10(rms + 1e-9),
            'low': low / total,
            'high': high / total,
            'profile': profile,
        })
    return feats


def similarity(a, b):
    return float(np.dot(a, b) / (np.linalg.norm(a) * np.linalg.norm(b) + 1e-12))


def phrase_starts(feats, bars, phrase=4):
    """Bar indices on phrase lines (every `phrase` bars) where a loop of `bars` bars fits."""
    return [b for b in range(0, len(feats) - bars, phrase)]


def loop_score(feats, s, bars):
    """How well bars s..s+bars-1 loop: the bar after the loop should sound like its first bar."""
    if s + bars >= len(feats):
        return -1
    return similarity(feats[s]['profile'], feats[s + bars]['profile'])


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('track')
    ap.add_argument('--bpm', type=float, required=True)
    ap.add_argument('--bars', type=int, default=16)
    ap.add_argument('--out', default='out/loops')
    ap.add_argument('--fade', type=float, default=0.012, help='seconds of crossfade at the seam')
    args = ap.parse_args()

    audio = load(args.track)
    mono = audio.mean(axis=1)
    env, fps = onset_envelope(mono)
    bpm, phase = beat_grid(env, fps, measured_tempo(env, fps, args.bpm))
    beat = 60 / bpm
    bar = 4 * beat
    # Which of the four beats is the one: the bar line where the sound changes most.
    count = int((len(mono) / SR - phase) / bar) - 1
    best = None
    for k in range(4):
        start = phase + k * beat
        feats = bar_features(audio, start, bar, count)
        change = sum(1 - similarity(feats[i]['profile'], feats[i - 1]['profile']) for i in range(4, len(feats), 4))
        if best is None or change > best[0]:
            best = (change, start, feats)
    _, start, feats = best

    print(f'{os.path.basename(args.track)}: {len(mono) / SR:.1f}s, tempo {bpm:.2f} (asked {args.bpm}), '
          f'first bar line at {start:.3f}s, {len(feats)} bars')
    print('bar   dB   low  high')
    for i, f in enumerate(feats):
        print(f"{i:3d} {f['db']:5.1f} {f['low']:.2f} {f['high']:.2f} {'#' * max(0, int((f['db'] + 40) / 2))}")

    # Energy of every candidate loop, and how cleanly it loops.
    L = args.bars
    cands = []
    for s in phrase_starts(feats, L):
        window = feats[s:s + L]
        db = float(np.mean([f['db'] for f in window]))
        spread = float(np.std([f['db'] for f in window]))
        cands.append({'start': s, 'db': db, 'spread': spread, 'seam': loop_score(feats, s, L),
                      'high': float(np.mean([f['high'] for f in window]))})
    usable = [c for c in cands if c['seam'] > 0.9 and c['spread'] < 3]
    if len(usable) < 3:
        usable = sorted(cands, key=lambda c: -c['seam'])[:max(3, len(cands) // 2)]
    by_energy = sorted(usable, key=lambda c: c['db'])
    calm = by_energy[0]
    peak = max(usable, key=lambda c: c['db'] + 10 * c['high'])
    main_ = [c for c in sorted(usable, key=lambda c: -c['db']) if c is not peak and c is not calm]
    main_ = main_[0] if main_ else peak
    chosen = {'calm': calm, 'main': main_, 'peak': peak}

    os.makedirs(args.out, exist_ok=True)
    meta = {'bpm': round(bpm, 3), 'bars': L, 'loops': {}}
    fade = int(args.fade * SR)
    ramp = np.sin(np.linspace(0, np.pi / 2, fade)) ** 2
    lengths = []
    for name, c in chosen.items():
        s = int((start + c['start'] * bar) * SR)
        n, env_fit, wave_fit = loop_length(mono, s, int(round(L * bar * SR)))
        lengths.append(n)
        c['fit'] = round(float(wave_fit), 3)
        loop = audio[s:s + n].copy()
        # The seam: the first few milliseconds blend from what followed the loop into its start.
        after = audio[s + n:s + n + fade]
        loop[:fade] = loop[:fade] * ramp[:, None] + after * (1 - ramp[:, None])
        save(os.path.join(args.out, f'{name}.wav'), loop)
        meta['loops'][name] = {k: (round(v, 3) if isinstance(v, float) else v) for k, v in c.items()}
        print(f"{name:5s} bars {c['start']}-{c['start'] + L - 1}: {c['db']:.1f} dB, seam similarity {c['seam']:.3f}, "
              f"length {n / SR:.4f}s (grid {L * bar:.4f}s), waveform match at the seam {wave_fit:.3f}")

    # The hit: the downbeat where the energy jumps most, with two bars of what follows.
    jumps = [(feats[i]['db'] - feats[i - 1]['db'], i) for i in range(1, len(feats))]
    _, drop = max(jumps)
    s = int((start + drop * bar - beat / 4) * SR)
    hit = audio[s:s + int(2 * bar * SR)].copy()
    tail = int(0.4 * SR)
    hit[-tail:] *= np.linspace(1, 0, tail)[:, None]
    save(os.path.join(args.out, 'hit.wav'), hit)
    meta['hit_bar'] = drop
    print(f'hit   the downbeat of bar {drop}')
    # The loops play in sync, so they must be one length: the median of what each fitted.
    meta['seconds'] = round(float(np.median(lengths)) / SR, 5)
    if max(lengths) - min(lengths) > SR // 100:
        print(f'note: the loops fitted lengths {[round(n / SR, 4) for n in lengths]}; the tempo wanders')
    json.dump(meta, open(os.path.join(args.out, 'loops.json'), 'w'), indent=1)


if __name__ == '__main__':
    sys.exit(main())
