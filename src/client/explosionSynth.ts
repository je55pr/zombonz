/**
 * Explosion and metal sounds built from noise and sine sweeps, so they need no downloads or licences.
 * Each clip is a stack of layers, the way a big bang is: a sub-bass thump, the crack of the blast front,
 * a roaring body, a low tail and the patter of debris falling, run through a small reverb. The result is
 * deterministic (seeded from the clip's name), so the same clip is the same sound on every machine.
 *
 * Rendered mono at `SYNTH_RATE`; the Web Audio buffer resamples it. The low sounds carry no energy worth
 * the extra samples above 16 kHz.
 */
export const SYNTH_RATE = 32000;

export const SYNTH_CLIPS = [
  'blast-frag', 'blast-barrel', 'blast-vehicle', 'blast-mine', 'mine-pop', 'flame-ignite',
  'grenade-ping', 'grenade-bounce', 'barrel-ping', 'metal-clang', 'fire-crackle-1', 'fire-crackle-2',
] as const;
export type SynthClip = typeof SYNTH_CLIPS[number];

const TAU = Math.PI * 2;

/** xorshift32, seeded from the clip's name. */
class Noise {
  private state: number;
  constructor(seed: number) { this.state = seed >>> 0 || 0x9e3779b9; }
  /** -1 to 1. */
  next(): number {
    let x = this.state;
    x ^= x << 13; x >>>= 0; x ^= x >>> 17; x ^= x << 5; x >>>= 0;
    this.state = x;
    return x / 2147483648 - 1;
  }
  /** 0 to 1, never 0. */
  unit(): number { return (this.next() + 1) / 2 || 1e-9; }
}

function nameHash(name: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < name.length; i++) hash = Math.imul(hash ^ name.charCodeAt(i), 0x01000193);
  return hash >>> 0;
}

/** One-pole low-pass coefficient for a cutoff in Hz. */
const pole = (cutoff: number, rate: number) => 1 - Math.exp(-TAU * Math.min(cutoff, rate * 0.45) / rate);
/** A rise then a fall: fast attack, exponential decay. */
const envelope = (t: number, attack: number, decay: number) => (1 - Math.exp(-t / attack)) * Math.exp(-t / decay);
const samples = (seconds: number, rate: number) => Math.max(1, Math.round(seconds * rate));

/** A sine that starts at `from` Hz and glides down to `to`: the body of a thump. */
function sweep(rate: number, seconds: number, from: number, to: number, glide: number, attack: number, decay: number): Float32Array {
  const out = new Float32Array(samples(seconds, rate));
  let phase = 0;
  for (let i = 0; i < out.length; i++) {
    const t = i / rate;
    phase += TAU * (to + (from - to) * Math.exp(-t / glide)) / rate;
    out[i] = Math.sin(phase) * envelope(t, attack, decay);
  }
  return out;
}

/** Noise between two cutoffs (each a pair of poles), shaped by an attack and a decay. */
function band(rate: number, seconds: number, noise: Noise, low: number, high: number, attack: number, decay: number): Float32Array {
  const out = new Float32Array(samples(seconds, rate));
  const hi = pole(low, rate), lo = pole(high, rate);
  let a = 0, b = 0, c = 0, d = 0;
  for (let i = 0; i < out.length; i++) {
    const x = noise.next();
    a += lo * (x - a); b += lo * (a - b);
    c += hi * (b - c); d += hi * (c - d);
    out[i] = (b - d) * envelope(i / rate, attack, decay) * 2;
  }
  return out;
}

/** Noise whose low-pass cutoff falls from `from` to `to`: the roar of a blast, bright at first then dull. */
function roar(rate: number, seconds: number, noise: Noise, from: number, to: number, glide: number, attack: number, decay: number): Float32Array {
  const out = new Float32Array(samples(seconds, rate));
  let a = 0, b = 0;
  for (let i = 0; i < out.length; i++) {
    const t = i / rate, k = pole(to + (from - to) * Math.exp(-t / glide), rate);
    a += k * (noise.next() - a); b += k * (a - b);
    out[i] = b * envelope(t, attack, decay) * 2.4;
  }
  return out;
}

/** Ringing metal: a few inharmonic partials, each dying at its own rate. */
function partials(rate: number, seconds: number, noise: Noise, base: number, ratios: readonly number[],
  decays: readonly number[], attack = 0.0004): Float32Array {
  const out = new Float32Array(samples(seconds, rate));
  ratios.forEach((ratio, index) => {
    const step = TAU * base * ratio / rate, start = noise.unit() * TAU, weight = 1 / (1 + index * 0.55);
    for (let i = 0; i < out.length; i++) {
      out[i] += Math.sin(start + step * i) * envelope(i / rate, attack, decays[index] ?? decays[decays.length - 1]) * weight;
    }
  });
  return out;
}

interface Scatter {
  /** Blips per second at the start and end of the layer (falling or rising in between). */
  from: number; to: number;
  /** How the blips sound: `hiss` is a burst of bright noise, `metal` a damped tone between `low` and `high` Hz. */
  kind: 'hiss' | 'metal'; low: number; high: number;
  /** Blip length in seconds, and loudest level. */
  length: number; level: number;
}

/** Debris landing, or a fire crackling: many tiny events at random times, thinning out as the layer goes on. */
function scatter(rate: number, seconds: number, noise: Noise, spec: Scatter): Float32Array {
  const out = new Float32Array(samples(seconds, rate));
  let time = 0;
  for (;;) {
    const along = time / seconds, blipsPerSecond = spec.from + (spec.to - spec.from) * along;
    time += -Math.log(noise.unit()) / Math.max(1, blipsPerSecond);
    if (time >= seconds) break;
    const start = Math.floor(time * rate), length = Math.min(out.length - start, Math.ceil(spec.length * rate));
    const amplitude = spec.level * (0.25 + 0.75 * noise.unit()) * (1 - along * 0.5);
    const pitch = TAU * (spec.low + (spec.high - spec.low) * noise.unit()) / rate;
    for (let i = 0; i < length; i++) {
      const fall = Math.exp(-i / (length * 0.28));
      out[start + i] += (spec.kind === 'metal' ? Math.sin(pitch * i) : noise.next() * (i === 0 ? 1 : 0.8)) * fall * amplitude;
    }
  }
  return out;
}

function mix(out: Float32Array, layer: Float32Array, at: number, gain: number, rate: number): void {
  const offset = Math.round(at * rate);
  for (let i = 0; i < layer.length && offset + i < out.length; i++) out[offset + i] += layer[i] * gain;
}

/** A small Schroeder reverb: four combs in parallel, then two all-passes. `wet` is how much comes back. */
function reverb(signal: Float32Array, rate: number, wet: number, feedback = 0.74): void {
  if (wet <= 0) return;
  const dry = Float32Array.from(signal);
  const combs = [0.0297, 0.0371, 0.0411, 0.0437].map(seconds => ({ line: new Float32Array(Math.round(seconds * rate)), at: 0 }));
  const allpasses = [0.0050, 0.0017].map(seconds => ({ line: new Float32Array(Math.round(seconds * rate)), at: 0 }));
  for (let i = 0; i < signal.length; i++) {
    let sum = 0;
    for (const comb of combs) {
      const echoed = comb.line[comb.at];
      comb.line[comb.at] = dry[i] + echoed * feedback;
      comb.at = (comb.at + 1) % comb.line.length; sum += echoed;
    }
    let value = sum / combs.length;
    for (const allpass of allpasses) {
      const stored = allpass.line[allpass.at];
      allpass.line[allpass.at] = value + stored * 0.7;
      value = stored - value * 0.7;
      allpass.at = (allpass.at + 1) % allpass.line.length;
    }
    signal[i] = dry[i] + value * wet;
  }
}

/** Rounds off the loudest peaks, fades the last moments out and scales the peak to `level`. */
function finish(signal: Float32Array, rate: number, level = 0.92, drive = 1.5): Float32Array {
  const fade = Math.min(signal.length, Math.round(rate * 0.06));
  let peak = 0;
  for (let i = 0; i < signal.length; i++) {
    signal[i] = Math.tanh(signal[i] * drive);
    if (i >= signal.length - fade) signal[i] *= (signal.length - i) / fade;
    peak = Math.max(peak, Math.abs(signal[i]));
  }
  const scale = peak > 0 ? level / peak : 1;
  for (let i = 0; i < signal.length; i++) signal[i] *= scale;
  return signal;
}

interface BlastRecipe {
  seconds: number;
  /** The sub-bass thump: start and end frequency, how fast it glides, how long it lasts, its level. */
  sub: { from: number; to: number; glide: number; decay: number; gain: number };
  /** The crack of the blast front: a burst of noise between two frequencies. */
  crack: { low: number; high: number; decay: number; gain: number };
  /** The roaring body of the blast. */
  body: { from: number; to: number; glide: number; decay: number; gain: number };
  /** The low rumble that follows, starting after `delay`. */
  tail: { cutoff: number; decay: number; gain: number; delay: number };
  /** Debris landing after the blast. */
  debris: Scatter & { after: number; span: number };
  /** Clanging metal, for a barrel or a car: a bell-like ring with these partials. */
  ring?: { base: number; decays: readonly number[]; gain: number };
  /** A second, fuel-fed thump some time after the first. */
  whump?: { at: number; gain: number };
  wet: number;
}

const RATIOS = [1, 2.756, 5.404, 8.933];

const BLASTS: Readonly<Record<'blast-frag' | 'blast-barrel' | 'blast-vehicle' | 'blast-mine', BlastRecipe>> = {
  'blast-frag': {
    seconds: 2.6,
    sub: { from: 95, to: 38, glide: 0.09, decay: 0.28, gain: 0.95 },
    crack: { low: 600, high: 6500, decay: 0.035, gain: 0.95 },
    body: { from: 2800, to: 300, glide: 0.16, decay: 0.34, gain: 0.8 },
    tail: { cutoff: 220, decay: 1.05, gain: 0.5, delay: 0.04 },
    debris: { kind: 'hiss', low: 900, high: 3000, length: 0.008, level: 0.16, from: 55, to: 4, after: 0.14, span: 1.6 },
    wet: 0.22,
  },
  'blast-barrel': {
    seconds: 3.6,
    sub: { from: 72, to: 28, glide: 0.16, decay: 0.55, gain: 1 },
    crack: { low: 400, high: 4200, decay: 0.05, gain: 0.7 },
    body: { from: 2000, to: 200, glide: 0.3, decay: 0.7, gain: 1 },
    tail: { cutoff: 190, decay: 1.7, gain: 0.55, delay: 0.06 },
    debris: { kind: 'metal', low: 500, high: 3200, length: 0.03, level: 0.14, from: 28, to: 3, after: 0.2, span: 2 },
    ring: { base: 190, decays: [0.5, 0.34, 0.24, 0.14], gain: 0.16 },
    wet: 0.3,
  },
  'blast-vehicle': {
    seconds: 4.8,
    sub: { from: 62, to: 24, glide: 0.24, decay: 0.75, gain: 1 },
    crack: { low: 350, high: 3600, decay: 0.06, gain: 0.7 },
    body: { from: 1800, to: 160, glide: 0.42, decay: 1, gain: 1 },
    tail: { cutoff: 170, decay: 2.3, gain: 0.6, delay: 0.08 },
    debris: { kind: 'metal', low: 300, high: 2800, length: 0.04, level: 0.16, from: 40, to: 4, after: 0.25, span: 2.9 },
    ring: { base: 130, decays: [0.75, 0.5, 0.34, 0.2], gain: 0.2 },
    whump: { at: 0.24, gain: 0.7 },
    wet: 0.34,
  },
  'blast-mine': {
    seconds: 2.4,
    sub: { from: 110, to: 45, glide: 0.06, decay: 0.18, gain: 0.8 },
    crack: { low: 800, high: 7500, decay: 0.045, gain: 1 },
    body: { from: 3200, to: 380, glide: 0.1, decay: 0.24, gain: 0.85 },
    tail: { cutoff: 240, decay: 0.95, gain: 0.42, delay: 0.03 },
    debris: { kind: 'hiss', low: 500, high: 2200, length: 0.012, level: 0.14, from: 50, to: 5, after: 0.12, span: 1.4 },
    wet: 0.2,
  },
};

function blast(recipe: BlastRecipe, noise: Noise, rate: number): Float32Array {
  const out = new Float32Array(samples(recipe.seconds, rate));
  const { sub, crack, body, tail, debris } = recipe;
  mix(out, sweep(rate, recipe.seconds, sub.from, sub.to, sub.glide, 0.004, sub.decay), 0, sub.gain, rate);
  mix(out, sweep(rate, 0.6, sub.from * 1.9, sub.to * 1.9, sub.glide * 0.6, 0.003, sub.decay * 0.4), 0, sub.gain * 0.5, rate);
  mix(out, band(rate, 0.5, noise, crack.low, crack.high, 0.0005, crack.decay), 0, crack.gain, rate);
  mix(out, band(rate, 0.6, noise, crack.low * 2.5, Math.min(crack.high * 1.4, 12000), 0.001, crack.decay * 2.6), 0, crack.gain * 0.5, rate);
  mix(out, roar(rate, recipe.seconds, noise, body.from, body.to, body.glide, 0.008, body.decay), 0, body.gain, rate);
  mix(out, roar(rate, recipe.seconds, noise, tail.cutoff * 1.2, tail.cutoff * 0.7, 1, 0.05, tail.decay), tail.delay, tail.gain * 2.2, rate);
  mix(out, scatter(rate, debris.span, noise, debris), debris.after, 1, rate);
  if (recipe.ring) mix(out, partials(rate, 1.2, noise, recipe.ring.base, RATIOS, recipe.ring.decays), 0.012, recipe.ring.gain, rate);
  if (recipe.whump) {
    mix(out, sweep(rate, 1, sub.from * 0.8, sub.to, sub.glide, 0.01, sub.decay * 0.8), recipe.whump.at, recipe.whump.gain, rate);
    mix(out, roar(rate, 1.2, noise, 1500, 180, 0.3, 0.02, 0.5), recipe.whump.at, recipe.whump.gain * 0.8, rate);
  }
  reverb(out, rate, recipe.wet);
  return finish(out, rate);
}

/** The Betty's launching charge: a dull thump, a puff, the click of the spring and a short rising rush. */
function minePop(noise: Noise, rate: number): Float32Array {
  const out = new Float32Array(samples(0.55, rate));
  mix(out, sweep(rate, 0.3, 150, 68, 0.05, 0.002, 0.09), 0, 0.9, rate);
  mix(out, band(rate, 0.2, noise, 500, 3200, 0.001, 0.05), 0, 0.7, rate);
  mix(out, partials(rate, 0.12, noise, 1200, [1, 2.4, 4.1], [0.02, 0.014, 0.01]), 0.008, 0.35, rate);
  const rush = band(rate, 0.3, noise, 400, 2400, 0.09, 0.09);
  mix(out, rush, 0.05, 0.3, rate);
  reverb(out, rate, 0.12);
  return finish(out, rate, 0.85, 1.2);
}

/** A fuel-fed whoomph as something catches: a swelling rush of flame over a soft low thump. */
function flameIgnite(noise: Noise, rate: number): Float32Array {
  const out = new Float32Array(samples(1.3, rate));
  mix(out, roar(rate, 1.3, noise, 500, 1900, 0.2, 0.05, 0.5), 0, 1, rate);
  mix(out, roar(rate, 1.3, noise, 1900, 500, 0.45, 0.03, 0.3), 0.04, 0.5, rate);
  mix(out, sweep(rate, 0.8, 60, 46, 0.4, 0.03, 0.3), 0, 0.5, rate);
  mix(out, scatter(rate, 0.9, noise, { from: 40, to: 12, kind: 'hiss', low: 800, high: 2500, length: 0.006, level: 0.1 }), 0.15, 1, rate);
  reverb(out, rate, 0.12);
  return finish(out, rate, 0.8, 1.1);
}

/** The pin and spoon flying off a grenade: a bright metallic tick and ring. */
function grenadePing(noise: Noise, rate: number): Float32Array {
  const out = new Float32Array(samples(0.35, rate));
  mix(out, partials(rate, 0.3, noise, 3100, [1, 1.57, 2.07, 2.9], [0.12, 0.08, 0.05, 0.03]), 0, 0.7, rate);
  mix(out, band(rate, 0.05, noise, 2500, 9000, 0.0002, 0.003), 0, 0.6, rate);
  return finish(out, rate, 0.7, 1.1);
}

/** A grenade knocking off a floor or wall: a dull thud and a short clink. */
function grenadeBounce(noise: Noise, rate: number): Float32Array {
  const out = new Float32Array(samples(0.25, rate));
  mix(out, sweep(rate, 0.12, 230, 110, 0.02, 0.001, 0.03), 0, 0.7, rate);
  mix(out, partials(rate, 0.2, noise, 1100, [1, 2.06, 3.22], [0.05, 0.035, 0.02]), 0, 0.5, rate);
  mix(out, band(rate, 0.05, noise, 1500, 7000, 0.0002, 0.004), 0, 0.5, rate);
  return finish(out, rate, 0.7, 1.1);
}

/** A bullet striking a steel drum: a hollow bong over a sharp tick. */
function barrelPing(noise: Noise, rate: number): Float32Array {
  const out = new Float32Array(samples(0.6, rate));
  mix(out, partials(rate, 0.55, noise, 260, [1, 2.32, 3.9, 5.7], [0.26, 0.16, 0.1, 0.06]), 0, 0.8, rate);
  mix(out, sweep(rate, 0.3, 120, 88, 0.08, 0.001, 0.12), 0, 0.6, rate);
  mix(out, band(rate, 0.05, noise, 1200, 8000, 0.0002, 0.005), 0, 0.7, rate);
  reverb(out, rate, 0.1);
  return finish(out, rate, 0.75, 1.2);
}

/** A bullet striking a car body: a flat thunk and a clank. */
function metalClang(noise: Noise, rate: number): Float32Array {
  const out = new Float32Array(samples(0.7, rate));
  mix(out, partials(rate, 0.6, noise, 150, [1, 2.05, 3.4, 4.9], [0.24, 0.17, 0.11, 0.07]), 0, 0.8, rate);
  mix(out, band(rate, 0.08, noise, 700, 2600, 0.0004, 0.012), 0, 0.8, rate);
  mix(out, sweep(rate, 0.2, 95, 60, 0.05, 0.001, 0.07), 0, 0.5, rate);
  reverb(out, rate, 0.1);
  return finish(out, rate, 0.75, 1.2);
}

/** A burning thing: a soft low roar with crackles, short enough to loop by playing it again. */
function fireCrackle(noise: Noise, rate: number): Float32Array {
  const seconds = 1.5, out = new Float32Array(samples(seconds, rate));
  // The roar breathes: low-passed noise under a slow wobble.
  let a = 0, b = 0, phase = noise.unit() * TAU;
  const k = pole(320, rate);
  for (let i = 0; i < out.length; i++) {
    a += k * (noise.next() - a); b += k * (a - b);
    out[i] = b * 2.2 * (0.6 + 0.4 * Math.sin(phase + i * TAU * 2.3 / rate)) * Math.min(1, i / (rate * 0.05), (out.length - i) / (rate * 0.05));
  }
  mix(out, scatter(rate, seconds, noise, { from: 26, to: 26, kind: 'hiss', low: 900, high: 3200, length: 0.004, level: 0.35 }), 0, 1, rate);
  mix(out, scatter(rate, seconds, noise, { from: 7, to: 7, kind: 'metal', low: 1500, high: 4200, length: 0.012, level: 0.18 }), 0, 1, rate);
  return finish(out, rate, 0.6, 1.1);
}

/** Renders one clip: mono samples between -1 and 1. */
export function synthesizeClip(name: SynthClip, rate = SYNTH_RATE): Float32Array {
  const noise = new Noise(nameHash(name));
  switch (name) {
    case 'blast-frag': case 'blast-barrel': case 'blast-vehicle': case 'blast-mine': return blast(BLASTS[name], noise, rate);
    case 'mine-pop': return minePop(noise, rate);
    case 'flame-ignite': return flameIgnite(noise, rate);
    case 'grenade-ping': return grenadePing(noise, rate);
    case 'grenade-bounce': return grenadeBounce(noise, rate);
    case 'barrel-ping': return barrelPing(noise, rate);
    case 'metal-clang': return metalClang(noise, rate);
    case 'fire-crackle-1': case 'fire-crackle-2': return fireCrackle(noise, rate);
  }
}
