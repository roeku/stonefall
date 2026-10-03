/**
 * The game's instruments: a small subtractive synth for every note (oscillators through a
 * resonant low-pass with its own envelope, and a little drive), a soft sub, a knock of noise for
 * stone on stone, and the room. The music and the effects play on the same ones, with the
 * settings of one kit (kit.ts), so the two sound like one thing. Each call plays one sound on the
 * audio clock and cleans up after itself.
 */

export const hz = (midi: number): number => 440 * Math.pow(2, (midi - 69) / 12);

/** Where a voice goes: straight out, and into the shared room and echo (AudioPlayer.space). */
export interface Out {
  readonly dry: AudioNode;
  readonly room?: AudioNode | undefined;
  readonly echo?: AudioNode | undefined;
}

/** A waveform: the oscillator's own, or a quarter-width pulse, thinner and more nasal. */
export type Wave = OscillatorType | 'pulse25';

export interface Osc {
  readonly wave: Wave;
  /** Semitones off the note (an octave down is -12), and cents of detune for width. */
  readonly semis?: number;
  readonly cents?: number;
  readonly level: number;
}

export interface Voice {
  readonly oscs: ReadonlyArray<Osc>;
  /** A low-pass that opens at `from` and closes toward `to`, `time` its time constant (s). */
  readonly filter?: {
    readonly from: number;
    readonly to: number;
    readonly time: number;
    readonly q: number;
  };
  /** The pitch starts this many semitones off and slides onto the note over `time` seconds. */
  readonly bend?: { readonly semis: number; readonly time: number };
  /** Seconds: up to full, then down to silence. */
  readonly attack: number;
  readonly decay: number;
  /** Soft clipping: 0 is clean, 5 is gritty. */
  readonly drive?: number;
  readonly pan?: number;
  /** How much goes into the room and into the echo, 0 to 1. */
  readonly room?: number;
  readonly echo?: number;
}

/** Changes to a voice for one note: its decay stretched, its filter opened (tone over 1) or shut. */
export interface Touch {
  readonly stretch?: number;
  readonly tone?: number;
  readonly pan?: number;
}

/** Sends `node` into `to` at `level`, if there is somewhere to send it. */
function send(ctx: BaseAudioContext, node: AudioNode, to: AudioNode | undefined, level: number) {
  if (!to || level <= 0) return;
  const g = ctx.createGain();
  g.gain.value = level;
  node.connect(g).connect(to);
}

/** A pulse wave of the given duty, per context: the narrower, the thinner it sounds. */
const pulses = new WeakMap<BaseAudioContext, Map<number, PeriodicWave>>();

function pulse(ctx: BaseAudioContext, duty: number): PeriodicWave {
  let byDuty = pulses.get(ctx);
  if (!byDuty) pulses.set(ctx, (byDuty = new Map()));
  let wave = byDuty.get(duty);
  if (!wave) {
    const n = 48;
    const real = new Float32Array(n);
    const imag = new Float32Array(n);
    for (let k = 1; k < n; k++) {
      real[k] = Math.sin(2 * Math.PI * k * duty) / (k * Math.PI);
      imag[k] = (1 - Math.cos(2 * Math.PI * k * duty)) / (k * Math.PI);
    }
    wave = ctx.createPeriodicWave(real, imag);
    byDuty.set(duty, wave);
  }
  return wave;
}

/** The soft clipping curve for a drive, shared by every voice that uses it. */
const curves = new Map<number, Float32Array<ArrayBuffer>>();

function curve(drive: number): Float32Array<ArrayBuffer> {
  let c = curves.get(drive);
  if (!c) {
    c = new Float32Array(1024);
    for (let i = 0; i < c.length; i++) {
      const x = (i / (c.length - 1)) * 2 - 1;
      c[i] = Math.tanh(drive * x) / Math.tanh(drive);
    }
    curves.set(drive, c);
  }
  return c;
}

/** One note on a voice. */
export function play(
  ctx: BaseAudioContext,
  out: Out,
  midi: number,
  at: number,
  level: number,
  voice: Voice,
  touch: Touch = {}
): void {
  const stretch = touch.stretch ?? 1;
  const decay = voice.decay * stretch;
  const end = at + voice.attack + decay;
  const sum = ctx.createGain();
  const oscs = voice.oscs.map((o) => {
    const osc = ctx.createOscillator();
    if (o.wave === 'pulse25') osc.setPeriodicWave(pulse(ctx, 0.25));
    else osc.type = o.wave;
    const f = hz(midi + (o.semis ?? 0));
    if (voice.bend) {
      osc.frequency.setValueAtTime(f * Math.pow(2, voice.bend.semis / 12), at);
      osc.frequency.exponentialRampToValueAtTime(f, at + voice.bend.time);
    } else {
      osc.frequency.value = f;
    }
    osc.detune.value = o.cents ?? 0;
    const g = ctx.createGain();
    g.gain.value = o.level;
    osc.connect(g).connect(sum);
    osc.start(at);
    osc.stop(end + 0.05);
    return osc;
  });
  let head: AudioNode = sum;
  const extra: AudioNode[] = [];
  if (voice.filter) {
    const tone = touch.tone ?? 1;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.Q.value = voice.filter.q;
    lp.frequency.setValueAtTime(Math.min(18000, voice.filter.from * tone), at);
    lp.frequency.setTargetAtTime(voice.filter.to, at + voice.attack, voice.filter.time * stretch);
    head = head.connect(lp);
    extra.push(lp);
  }
  if (voice.drive) {
    const shaper = ctx.createWaveShaper();
    shaper.curve = curve(voice.drive);
    head = head.connect(shaper);
    extra.push(shaper);
  }
  const env = ctx.createGain();
  env.gain.setValueAtTime(0.0001, at);
  env.gain.exponentialRampToValueAtTime(level, at + voice.attack);
  env.gain.exponentialRampToValueAtTime(0.0001, end);
  const panner = ctx.createStereoPanner();
  panner.pan.value = touch.pan ?? voice.pan ?? 0;
  head.connect(env).connect(panner);
  panner.connect(out.dry);
  send(ctx, panner, out.room, voice.room ?? 0);
  send(ctx, panner, out.echo, voice.echo ?? 0);
  oscs[0]!.onended = () => {
    for (const node of [sum, ...extra, env, panner]) node.disconnect();
  };
}

/** A soft low thump: a sine falling an octave onto `f`. Dry: low end in a room is mud. */
export function sub(
  ctx: BaseAudioContext,
  out: AudioNode,
  f: number,
  at: number,
  level: number,
  decay: number
): void {
  const o = ctx.createOscillator();
  o.frequency.setValueAtTime(f * 2, at);
  o.frequency.exponentialRampToValueAtTime(f, at + 0.09);
  const env = ctx.createGain();
  env.gain.setValueAtTime(0.0001, at);
  env.gain.exponentialRampToValueAtTime(level, at + 0.006);
  env.gain.exponentialRampToValueAtTime(0.0001, at + decay);
  o.connect(env).connect(out);
  o.start(at);
  o.stop(at + decay + 0.05);
  o.onended = () => env.disconnect();
}

/** Half a second of white noise per context, read from a random point for each knock. */
const noises = new WeakMap<BaseAudioContext, AudioBuffer>();

function noise(ctx: BaseAudioContext): AudioBuffer {
  let buf = noises.get(ctx);
  if (!buf) {
    buf = ctx.createBuffer(1, Math.floor(ctx.sampleRate * 0.5), ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
    noises.set(ctx, buf);
  }
  return buf;
}

export interface KnockShape {
  /** The lowpass on the noise, Hz: low is stone on stone, high is a chip off it. */
  readonly cutoff: number;
  /** Seconds to silence. */
  readonly decay: number;
  readonly room: number;
}

/** Stone on stone: a few milliseconds of low-passed noise, the contact on the front of a hit. */
export function knock(
  ctx: BaseAudioContext,
  out: Out,
  at: number,
  level: number,
  { cutoff, decay, room }: KnockShape
): void {
  const buf = noise(ctx);
  const src = ctx.createBufferSource();
  src.buffer = buf;
  const lp = ctx.createBiquadFilter();
  lp.type = 'lowpass';
  lp.frequency.value = cutoff;
  lp.Q.value = 0.7;
  const env = ctx.createGain();
  env.gain.setValueAtTime(level, at);
  env.gain.exponentialRampToValueAtTime(0.0001, at + decay);
  src.connect(lp).connect(env);
  env.connect(out.dry);
  send(ctx, env, out.room, room);
  src.start(at, Math.random() * Math.max(0, buf.duration - decay - 0.02));
  src.stop(at + decay + 0.02);
  src.onended = () => env.disconnect();
}

/** A stereo room: seconds of decaying noise, darkened, for everything to sit in. */
export function makeRoom(ctx: BaseAudioContext, seconds: number): AudioBuffer {
  const frames = Math.floor(ctx.sampleRate * seconds);
  const buf = ctx.createBuffer(2, frames, ctx.sampleRate);
  for (let ch = 0; ch < 2; ch++) {
    const data = buf.getChannelData(ch);
    let lp = 0;
    for (let i = 0; i < frames; i++) {
      // a one-pole lowpass on the noise, so the tail is warm rather than hissy
      lp += 0.35 * (Math.random() * 2 - 1 - lp);
      data[i] = lp * Math.pow(1 - i / frames, 3.2);
    }
  }
  return buf;
}
