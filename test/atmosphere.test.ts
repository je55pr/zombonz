import { afterEach, describe, expect, it, vi } from 'vitest';
import { lampFlicker } from '../src/client/atmosphere.ts';
import { GameAudio } from '../src/client/audio.ts';

afterEach(() => vi.unstubAllGlobals());

describe('presentation atmosphere', () => {
  it('uses sparse bounded, repeatable lamp dips with separate phase offsets', () => {
    expect(lampFlicker(0, 0)).toBe(0.45);
    expect(lampFlicker(3, 0)).toBe(1.08);
    expect(lampFlicker(150, 0)).toBe(0.74);
    expect(lampFlicker(0, 137)).not.toBe(lampFlicker(0, 0));
    const samples = Array.from({ length: 1000 }, (_, tick) => lampFlicker(tick, 47));
    expect(samples.every(value => value >= 0.45 && value <= 1.08)).toBe(true);
    expect(samples).toEqual(Array.from({ length: 1000 }, (_, tick) => lampFlicker(tick, 47)));
  });

  it('starts recorded ambience without oscillators and mutes it during pause or M mute', async () => {
    const target = new EventTarget(), surface = new EventTarget();
    const gains: { gain: { value: number; setTargetAtTime: ReturnType<typeof vi.fn> } }[] = [];
    const ambientStart = vi.fn(), oscillator = vi.fn();
    class FakeAudioContext {
      currentTime = 0; state = 'running'; destination = {};
      createGain() {
        const node = { gain: { value: 0, setTargetAtTime: vi.fn() }, connect: vi.fn() };
        gains.push(node); return node;
      }
      decodeAudioData() { return Promise.resolve({}); }
      createBufferSource() { return { buffer: null, loop: false, connect: vi.fn(), start: ambientStart, stop: vi.fn() }; }
      createOscillator() { oscillator(); throw new Error('Procedural audio must not run'); }
      close() { return Promise.resolve(); }
    }
    vi.stubGlobal('window', target);
    vi.stubGlobal('AudioContext', FakeAudioContext);
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, arrayBuffer: async () => new ArrayBuffer(1) }));
    const audio = new GameAudio(surface as HTMLElement);
    surface.dispatchEvent(new Event('pointerdown'));
    await vi.waitFor(() => expect(ambientStart).toHaveBeenCalledTimes(2));
    expect(oscillator).not.toHaveBeenCalled();
    audio.setPaused(true);
    expect(gains[0].gain.setTargetAtTime).toHaveBeenLastCalledWith(0, 0, 0.03);
    audio.setPaused(false);
    expect(gains[0].gain.setTargetAtTime).toHaveBeenLastCalledWith(0.7, 0, 0.03);
    target.dispatchEvent(Object.assign(new Event('keydown'), { code: 'KeyM', repeat: false }));
    expect(gains[0].gain.setTargetAtTime).toHaveBeenLastCalledWith(0, 0, 0.015);
    audio.dispose();
  });
});
