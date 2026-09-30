import { afterEach, describe, expect, it, vi } from 'vitest';
import { SpatialAudioManager, spatialMix } from '../src/client/audioManager.ts';

class FakeParam {
  value = 0;
  readonly targets: Array<[number, number, number]> = [];
  setTargetAtTime(value: number, time: number, constant: number): void {
    this.value = value;
    this.targets.push([value, time, constant]);
  }
}

class FakeNode {
  readonly connections: unknown[] = [];
  disconnects = 0;
  connect(target: unknown): unknown { this.connections.push(target); return target; }
  disconnect(): void { this.disconnects++; this.connections.length = 0; }
}

class FakeGain extends FakeNode { gain = new FakeParam(); }
class FakePan extends FakeNode { pan = new FakeParam(); }
class FakeWave extends FakeNode { curve: Float32Array | null = null; }

class FakeSource extends FakeNode {
  buffer: unknown = null;
  playbackRate = new FakeParam();
  loop = false;
  onended: (() => void) | null = null;
  starts = 0;
  stops = 0;
  start(): void { this.starts++; }
  stop(): void { this.stops++; }
  finish(): void { this.onended?.(); }
}

class FakeContext {
  static instances: FakeContext[] = [];
  state: 'suspended' | 'running' | 'closed' = 'suspended';
  currentTime = 4;
  destination = new FakeNode();
  readonly gains: FakeGain[] = [];
  readonly pans: FakePan[] = [];
  readonly sources: FakeSource[] = [];
  readonly waves: FakeWave[] = [];
  readonly resume = vi.fn(async () => { this.state = 'running'; });
  readonly close = vi.fn(async () => { this.state = 'closed'; });

  constructor() { FakeContext.instances.push(this); }
  createGain(): FakeGain { const node = new FakeGain(); this.gains.push(node); return node; }
  createStereoPanner(): FakePan { const node = new FakePan(); this.pans.push(node); return node; }
  createBufferSource(): FakeSource { const node = new FakeSource(); this.sources.push(node); return node; }
  createWaveShaper(): FakeWave { const node = new FakeWave(); this.waves.push(node); return node; }
}

function setup(maxVoices = 32) {
  FakeContext.instances.length = 0;
  const target = new EventTarget(), surface = new EventTarget();
  vi.stubGlobal('window', target);
  vi.stubGlobal('AudioContext', FakeContext);
  const unlocked = vi.fn();
  const manager = new SpatialAudioManager(surface as HTMLElement, unlocked, 0.7, maxVoices);
  return { manager, surface, target, unlocked };
}

afterEach(() => vi.unstubAllGlobals());

describe('spatial audio manager', () => {
  it('uses listener-relative pan, distance falloff, and a hard hearing range', () => {
    const listener = { position: { x: 0, y: 0, z: 0 }, yaw: 0 };
    expect(spatialMix({ x: 0, y: 0, z: 0 }, listener)).toEqual({ distance: 0, gain: 1, pan: 0 });

    const right = spatialMix({ x: 10, y: 0, z: 0 }, listener)!;
    expect(right.pan).toBeCloseTo(1);
    expect(right.gain).toBeCloseTo(1 / 3.4);
    expect(right.distance).toBe(10);

    const left = spatialMix({ x: -10, y: 0, z: 0 }, listener)!;
    expect(left.pan).toBeCloseTo(-1);
    expect(left.gain).toBeCloseTo(right.gain);

    const turned = spatialMix({ x: 0, y: 0, z: 10 }, { ...listener, yaw: Math.PI / 2 })!;
    expect(turned.pan).toBeCloseTo(-1);
    expect(spatialMix({ x: 37, y: 0, z: 0 }, listener)).toBeNull();
  });

  it('creates audio only on a user gesture, resumes a suspended context, and unlocks once', async () => {
    const { manager, surface, target, unlocked } = setup();
    expect(FakeContext.instances).toHaveLength(0);

    surface.dispatchEvent(new Event('pointerdown'));
    expect(FakeContext.instances).toHaveLength(1);
    const context = FakeContext.instances[0];
    expect(context.resume).toHaveBeenCalledTimes(1);
    await Promise.resolve();
    expect(context.state).toBe('running');
    expect(unlocked).toHaveBeenCalledTimes(1);

    target.dispatchEvent(new Event('keydown'));
    expect(FakeContext.instances).toHaveLength(1);
    expect(unlocked).toHaveBeenCalledTimes(1);

    manager.dispose();
    surface.dispatchEvent(new Event('pointerdown'));
    expect(FakeContext.instances).toHaveLength(1);
  });

  it('has independent sfx, ui, and music buses under the master volume', () => {
    const { manager } = setup();
    manager.unlockFromGesture();
    const context = FakeContext.instances[0];
    expect(context.gains).toHaveLength(4); // master + sfx + ui + music
    const [master, sfx, ui, music] = context.gains;
    expect(sfx.connections).toContain(master);
    expect(ui.connections).toContain(master);
    expect(music.connections).toContain(master);

    manager.setBusVolume('sfx', 0.8);
    manager.setBusVolume('ui', 0.35);
    manager.setBusVolume('music', 0.2);
    expect(sfx.gain.targets.at(-1)?.[0]).toBe(0.8);
    expect(ui.gain.targets.at(-1)?.[0]).toBe(0.35);
    expect(music.gain.targets.at(-1)?.[0]).toBe(0.2);

    manager.setMasterVolume(0.5);
    expect(master.gain.targets.at(-1)?.[0]).toBeCloseTo(0.35);
    manager.setPaused(true);
    expect(master.gain.targets.at(-1)?.[0]).toBe(0);
    manager.setPaused(false);
    expect(master.gain.targets.at(-1)?.[0]).toBeCloseTo(0.35);
    manager.setMuted(true);
    expect(master.gain.targets.at(-1)?.[0]).toBe(0);
    manager.dispose();
  });

  it('reuses gain/panner voices while creating only the Web Audio source that must be single-use', () => {
    const { manager } = setup(2);
    manager.unlockFromGesture();
    const context = FakeContext.instances[0];
    context.state = 'running';
    const buffer = {} as AudioBuffer;

    expect(manager.play('shot', buffer, { bus: 'sfx', volume: 0.8 })).toBe(true);
    expect(context.gains).toHaveLength(5); // master + 3 buses + one pooled voice gain
    expect(context.pans).toHaveLength(1);
    expect(context.sources).toHaveLength(1);
    context.sources[0].finish();

    expect(manager.play('shot', buffer, { bus: 'ui', volume: 0.5 })).toBe(true);
    expect(context.gains).toHaveLength(5);
    expect(context.pans).toHaveLength(1);
    expect(context.sources).toHaveLength(2);
    expect(context.pans[0].disconnects).toBe(1); // reused voice rerouted to the UI bus
    context.sources[1].finish();

    manager.dispose();
  });

  it('caps simultaneous instances and the total pooled voice count', () => {
    const { manager } = setup(1);
    manager.unlockFromGesture();
    const context = FakeContext.instances[0];
    context.state = 'running';
    const buffer = {} as AudioBuffer;

    expect(manager.play('zombie', buffer, { maxInstances: 1 })).toBe(true);
    // Instance cap treats the duplicate as handled but starts no second source.
    expect(manager.play('zombie', buffer, { maxInstances: 1 })).toBe(true);
    expect(context.sources).toHaveLength(1);
    // Another key cannot allocate a second routing voice while the one-voice pool is busy.
    expect(manager.play('other', buffer)).toBe(false);
    expect(context.sources).toHaveLength(1);
    context.sources[0].finish();
    expect(manager.play('other', buffer)).toBe(true);
    expect(context.sources).toHaveLength(2);

    manager.dispose();
  });
});
