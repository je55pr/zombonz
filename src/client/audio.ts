import type { EntityId } from '../core/types.ts';
import type { SimulationEvent } from '../core/simulation.ts';

/** Small, original Web Audio cues. Audio is presentation only and starts on user input. */
export class GameAudio {
  private context: AudioContext | null = null;
  private output: GainNode | null = null;
  private noise: AudioBuffer | null = null;
  private muted = false;
  private readonly unlock = () => this.start();
  private readonly onKeyDown = (event: KeyboardEvent) => {
    if (event.code === 'KeyM' && !event.repeat) {
      this.muted = !this.muted;
      if (this.output && this.context) this.output.gain.setTargetAtTime(this.muted ? 0 : 0.2,
        this.context.currentTime, 0.015);
    }
  };

  constructor(private readonly surface: HTMLElement) {
    surface.addEventListener('pointerdown', this.unlock);
    window.addEventListener('keydown', this.unlock);
    window.addEventListener('keydown', this.onKeyDown);
  }

  private start(): void {
    if (!this.context) {
      try {
        this.context = new AudioContext({ latencyHint: 'interactive' });
        this.output = this.context.createGain();
        this.output.gain.value = this.muted ? 0 : 0.2;
        this.output.connect(this.context.destination);
        // One seeded noise buffer reused by all short transients.
        const size = Math.ceil(this.context.sampleRate * 0.22);
        this.noise = this.context.createBuffer(1, size, this.context.sampleRate);
        const samples = this.noise.getChannelData(0);
        let seed = 0x19371125;
        for (let i = 0; i < samples.length; i++) {
          seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
          samples[i] = seed / 2147483648 - 1;
        }
      } catch { return; }
    }
    if (this.context.state === 'suspended') void this.context.resume().catch(() => {});
  }

  private tone(from: number, to: number, seconds: number, volume: number, shape: OscillatorType = 'sine'): void {
    const context = this.context, output = this.output;
    if (!context || !output || this.muted || context.state !== 'running') return;
    const oscillator = context.createOscillator(), gain = context.createGain();
    const now = context.currentTime;
    oscillator.type = shape;
    oscillator.frequency.setValueAtTime(from, now);
    oscillator.frequency.exponentialRampToValueAtTime(Math.max(1, to), now + seconds);
    gain.gain.setValueAtTime(volume, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + seconds);
    oscillator.connect(gain); gain.connect(output);
    oscillator.start(now); oscillator.stop(now + seconds);
    oscillator.onended = () => { oscillator.disconnect(); gain.disconnect(); };
  }

  private burst(seconds: number, volume: number, lowpass: number): void {
    const context = this.context, output = this.output;
    if (!context || !output || !this.noise || this.muted || context.state !== 'running') return;
    const source = context.createBufferSource(), filter = context.createBiquadFilter(), gain = context.createGain();
    const now = context.currentTime;
    source.buffer = this.noise;
    filter.type = 'lowpass'; filter.frequency.value = lowpass;
    gain.gain.setValueAtTime(volume, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + seconds);
    source.connect(filter); filter.connect(gain); gain.connect(output);
    source.start(now); source.stop(now + seconds);
    source.onended = () => { source.disconnect(); filter.disconnect(); gain.disconnect(); };
  }

  consume(events: readonly SimulationEvent[], playerId: EntityId): void {
    if (!this.context || this.muted) return;
    for (const event of events) {
      if ('playerId' in event && event.playerId !== playerId && event.type !== 'powerupCollected') continue;
      switch (event.type) {
        case 'weaponFired': this.burst(event.weaponId === 'starter-pistol' ? 0.09 : 0.15, 0.9, 1800);
          this.tone(115, 43, 0.12, 0.3, 'sawtooth'); break;
        case 'weaponHit': this.tone(event.hitZone === 'head' ? 940 : 650, 380, 0.045, 0.12); break;
        case 'zombieDied': this.tone(180, 64, 0.18, 0.21, 'triangle'); break;
        case 'meleeSwung': this.burst(0.08, 0.22, 3800); break;
        case 'playerDamaged': this.burst(0.18, 0.6, 580); this.tone(220, 80, 0.25, 0.18); break;
        case 'weaponReloadStarted': this.tone(300, 180, 0.075, 0.13, 'square'); break;
        case 'weaponReloadCompleted': this.tone(480, 700, 0.07, 0.13, 'square'); break;
        case 'pointsSpendRejected': this.tone(290, 170, 0.14, 0.12); break;
        case 'mysteryBoxUsed': this.tone(300, 650, 0.33, 0.17, 'triangle'); break;
        case 'mysteryBoxClaimed': this.tone(500, 940, 0.36, 0.19, 'triangle'); break;
        case 'doorOpened': this.burst(0.2, 0.45, 520); break;
        case 'powerupCollected':
          this.tone(330, 660, 0.24, 0.25, 'triangle');
          this.tone(495, 990, 0.3, 0.16, 'triangle'); break;
        case 'nukeDetonated': this.burst(0.22, 0.5, 900); this.tone(150, 32, 0.7, 0.3, 'sawtooth'); break;
        case 'barrierBoardRemoved': this.burst(0.12, 0.32, 680); break;
        case 'roundPhaseChanged': if (event.to === 'spawning') this.tone(240, 80, 0.8, 0.28, 'triangle'); break;
      }
    }
  }

  dispose(): void {
    this.surface.removeEventListener('pointerdown', this.unlock);
    window.removeEventListener('keydown', this.unlock);
    window.removeEventListener('keydown', this.onKeyDown);
    void this.context?.close();
  }
}
