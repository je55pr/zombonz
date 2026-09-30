import type { Vec3 } from '../core/types.ts';

export type AudioBus = 'sfx' | 'ui' | 'music';

export interface AudioListenerPose {
  position: Vec3;
  yaw: number;
}

export interface SpatialMix {
  distance: number;
  gain: number;
  pan: number;
}

export interface OneShotOptions {
  bus?: AudioBus;
  volume?: number;
  pan?: number;
  rate?: number;
  maxInstances?: number;
}

export interface SpatialOptions extends Omit<OneShotOptions, 'pan'> {
  rolloff?: number;
  maxDistance?: number;
}

interface Voice {
  gain: GainNode;
  pan: StereoPannerNode;
  bus: AudioBus | null;
  busy: boolean;
  source: AudioBufferSourceNode | null;
  key: string | null;
}

interface LoopHandle {
  source: AudioBufferSourceNode;
  gain: GainNode;
}

const BUSES: readonly AudioBus[] = ['sfx', 'ui', 'music'];
const DEFAULT_MAX_DISTANCE = 36;
const DEFAULT_ROLLOFF = 0.24;
const DEFAULT_MAX_VOICES = 32;

/**
 * A soft ceiling for the output: unchanged up to 70% of full scale, then rounded off so overlapping
 * shots and explosions cannot clip hard at full scale.
 */
export function softCeilingCurve(points = 4097): Float32Array {
  const curve = new Float32Array(points);
  for (let i = 0; i < points; i++) {
    const x = i / (points - 1) * 2 - 1, size = Math.abs(x);
    curve[i] = size <= 0.7 ? x : Math.sign(x) * (0.7 + 0.3 * Math.tanh((size - 0.7) / 0.3));
  }
  return curve;
}

/** Listener-relative stereo pan and inverse-distance-style attenuation used by positional SFX. */
export function spatialMix(point: Vec3, listener: AudioListenerPose, rolloff = DEFAULT_ROLLOFF,
  maxDistance = DEFAULT_MAX_DISTANCE): SpatialMix | null {
  const dx = point.x - listener.position.x, dz = point.z - listener.position.z;
  const distance = Math.hypot(dx, dz);
  if (distance > maxDistance) return null;
  const pan = distance > 0.01
    ? (dx * Math.cos(listener.yaw) - dz * Math.sin(listener.yaw)) / distance
    : 0;
  return {
    distance,
    gain: 1 / (1 + distance * Math.max(0, rolloff)),
    pan: Math.max(-1, Math.min(1, pan)),
  };
}

/**
 * Presentation-only Web Audio plumbing shared by game SFX, UI cues and ambience/music.
 *
 * AudioBufferSourceNode is intentionally recreated for each one-shot because the Web Audio API makes
 * buffer sources single-use. The gain + stereo-panner voice chains are pooled and reused after onended,
 * which avoids churning the heavier routing nodes during automatic fire and dense zombie audio.
 */
export class SpatialAudioManager {
  private audioContext: AudioContext | null = null;
  private master: GainNode | null = null;
  private readonly buses = new Map<AudioBus, GainNode>();
  private readonly busLevels: Record<AudioBus, number> = { sfx: 1, ui: 1, music: 1 };
  private readonly voices: Voice[] = [];
  private readonly activeByKey = new Map<string, number>();
  private readonly loops = new Map<string, LoopHandle>();
  private masterVolume = 1;
  private muted = false;
  private paused = false;
  private unlockNotifiedFor: AudioContext | null = null;

  private readonly unlock = () => { this.unlockFromGesture(); };

  constructor(
    private readonly surface: HTMLElement,
    private readonly onUnlocked?: (context: AudioContext) => void,
    private readonly masterLevel = 0.7,
    private readonly maxVoices = DEFAULT_MAX_VOICES,
  ) {
    surface.addEventListener('pointerdown', this.unlock);
    window.addEventListener('keydown', this.unlock);
  }

  get context(): AudioContext | null { return this.audioContext; }
  get isSuppressed(): boolean {
    return this.muted || this.paused || !this.audioContext || this.audioContext.state !== 'running';
  }

  /** Must be called from a real user gesture on browsers that gate Web Audio autoplay. */
  unlockFromGesture(): AudioContext | null {
    if (!this.audioContext) {
      try {
        const context = new AudioContext({ latencyHint: 'interactive' });
        this.audioContext = context;
        this.master = context.createGain();
        this.master.gain.value = this.outputLevel();

        const ceiling = context.createWaveShaper?.();
        if (ceiling) {
          ceiling.curve = softCeilingCurve() as Float32Array<ArrayBuffer>;
          this.master.connect(ceiling);
          ceiling.connect(context.destination);
        } else this.master.connect(context.destination);

        for (const bus of BUSES) {
          const node = context.createGain();
          node.gain.value = this.busLevels[bus];
          node.connect(this.master);
          this.buses.set(bus, node);
        }
      } catch {
        this.audioContext = null;
        this.master = null;
        this.buses.clear();
        return null;
      }
    }

    const context = this.audioContext;
    if (context.state === 'suspended') void context.resume().catch(() => {});
    if (this.unlockNotifiedFor !== context) {
      this.unlockNotifiedFor = context;
      this.onUnlocked?.(context);
    }
    return context;
  }

  private outputLevel(): number {
    return this.muted || this.paused ? 0 : this.masterLevel * this.masterVolume;
  }

  private refreshMaster(timeConstant = 0.03): void {
    if (!this.master || !this.audioContext) return;
    this.master.gain.setTargetAtTime(this.outputLevel(), this.audioContext.currentTime, timeConstant);
  }

  setMasterVolume(volume: number): void {
    this.masterVolume = Math.max(0, Math.min(1, volume));
    this.refreshMaster();
  }

  setBusVolume(bus: AudioBus, volume: number): void {
    this.busLevels[bus] = Math.max(0, Math.min(1, volume));
    const node = this.buses.get(bus);
    if (node && this.audioContext) node.gain.setTargetAtTime(this.busLevels[bus], this.audioContext.currentTime, 0.02);
  }

  busVolume(bus: AudioBus): number { return this.busLevels[bus]; }

  setMuted(muted: boolean): void {
    this.muted = muted;
    this.refreshMaster(0.015);
  }

  setPaused(paused: boolean): void {
    this.paused = paused;
    this.refreshMaster(0.03);
  }

  private voice(bus: AudioBus): Voice | null {
    const free = this.voices.find(voice => !voice.busy);
    if (free) {
      if (free.bus !== bus) {
        try { free.pan.disconnect(); } catch { /* fake/test nodes may not implement disconnect */ }
        free.pan.connect(this.buses.get(bus)!);
        free.bus = bus;
      }
      return free;
    }
    if (this.voices.length >= this.maxVoices || !this.audioContext) return null;
    const gain = this.audioContext.createGain();
    const pan = this.audioContext.createStereoPanner();
    gain.connect(pan);
    pan.connect(this.buses.get(bus)!);
    const created: Voice = { gain, pan, bus, busy: false, source: null, key: null };
    this.voices.push(created);
    return created;
  }

  play(key: string, buffer: AudioBuffer, options: OneShotOptions = {}): boolean {
    const context = this.audioContext;
    if (!context || this.muted || this.paused || context.state !== 'running') return false;

    const maxInstances = Math.max(1, Math.floor(options.maxInstances ?? 8));
    const active = this.activeByKey.get(key) ?? 0;
    if (active >= maxInstances) return true;

    const bus = options.bus ?? 'sfx';
    const voice = this.voice(bus);
    if (!voice) return false;

    const source = context.createBufferSource();
    source.buffer = buffer;
    source.playbackRate.value = options.rate ?? 1;
    voice.gain.gain.value = Math.max(0, options.volume ?? 1);
    voice.pan.pan.value = Math.max(-1, Math.min(1, options.pan ?? 0));
    voice.busy = true;
    voice.source = source;
    voice.key = key;
    this.activeByKey.set(key, active + 1);
    source.connect(voice.gain);

    const release = () => {
      if (voice.source !== source) return;
      this.activeByKey.set(key, Math.max(0, (this.activeByKey.get(key) ?? 1) - 1));
      voice.busy = false;
      voice.source = null;
      voice.key = null;
      try { source.disconnect(); } catch { /* no-op */ }
    };
    source.onended = release;
    try { source.start(); } catch {
      release();
      return false;
    }
    return true;
  }

  playSpatial(key: string, buffer: AudioBuffer, point: Vec3, listener: AudioListenerPose,
    options: SpatialOptions = {}): boolean {
    const mix = spatialMix(point, listener, options.rolloff, options.maxDistance);
    if (!mix) return false;
    return this.play(key, buffer, {
      bus: options.bus ?? 'sfx',
      volume: (options.volume ?? 1) * mix.gain,
      pan: mix.pan,
      rate: options.rate,
      maxInstances: options.maxInstances,
    });
  }

  /** Long-running non-positional ambience/music. One key may only own one loop. */
  playLoop(key: string, buffer: AudioBuffer, bus: AudioBus, volume: number, rate = 1): boolean {
    const context = this.audioContext, busNode = this.buses.get(bus);
    if (!context || !busNode || this.loops.has(key)) return false;
    const source = context.createBufferSource(), gain = context.createGain();
    source.buffer = buffer;
    source.loop = true;
    source.playbackRate.value = rate;
    gain.gain.value = Math.max(0, volume);
    source.connect(gain);
    gain.connect(busNode);
    source.start();
    this.loops.set(key, { source, gain });
    return true;
  }

  stopLoop(key: string): void {
    const loop = this.loops.get(key);
    if (!loop) return;
    this.loops.delete(key);
    try { loop.source.stop(); } catch { /* already stopped */ }
    try { loop.source.disconnect(); } catch { /* no-op */ }
    try { loop.gain.disconnect(); } catch { /* no-op */ }
  }

  dispose(): void {
    this.surface.removeEventListener('pointerdown', this.unlock);
    window.removeEventListener('keydown', this.unlock);
    for (const key of [...this.loops.keys()]) this.stopLoop(key);
    for (const voice of this.voices) {
      try { voice.source?.stop(); } catch { /* no-op */ }
      try { voice.gain.disconnect(); } catch { /* no-op */ }
      try { voice.pan.disconnect(); } catch { /* no-op */ }
    }
    this.voices.length = 0;
    this.activeByKey.clear();
    for (const node of this.buses.values()) try { node.disconnect(); } catch { /* no-op */ }
    this.buses.clear();
    try { this.master?.disconnect(); } catch { /* no-op */ }
    void this.audioContext?.close();
    this.audioContext = null;
    this.master = null;
    this.unlockNotifiedFor = null;
  }
}
