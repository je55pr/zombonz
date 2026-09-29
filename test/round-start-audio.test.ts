import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { assetExists, readAssetJson } from '../scripts/inspect-assets.mjs';
import { GameAudio } from '../src/client/audio.ts';
import { AUDIO_CLIPS } from '../src/client/audioClips.ts';
import { createPlayerState, createWorld, type RoundPhase, type SimulationEvent } from '../src/core/index.ts';

/** Just enough of the Web Audio API to see which clip is started. */
const played: string[] = [];
let names: Map<unknown, string> | null = null;

class FakeParam { value = 0; setTargetAtTime(): void { /* unused */ } }
class FakeNode { connect(): void { /* unused */ } disconnect(): void { /* unused */ } }
class FakeContext {
  state = 'running'; currentTime = 0; destination = new FakeNode();
  createGain() { return Object.assign(new FakeNode(), { gain: new FakeParam() }); }
  createStereoPanner() { return Object.assign(new FakeNode(), { pan: new FakeParam() }); }
  createWaveShaper() { return Object.assign(new FakeNode(), { curve: null }); }
  createBufferSource() {
    const source = Object.assign(new FakeNode(), { buffer: null as unknown, playbackRate: new FakeParam(), loop: false, onended: null as unknown });
    return Object.assign(source, { start: () => played.push(names?.get(source.buffer) ?? '?') });
  }
  decodeAudioData() { return Promise.resolve({ length: 4800, sampleRate: 48000, getChannelData: () => new Float32Array(4800) }); }
  resume() { return Promise.resolve(); }
  close() { return Promise.resolve(); }
}

async function startAudio(): Promise<(events: SimulationEvent[]) => void> {
  const audio = new GameAudio(new EventTarget() as unknown as HTMLElement);
  audio.startFromGesture();
  const clips = (audio as unknown as { clips: Map<string, unknown> }).clips;
  await vi.waitFor(() => expect(AUDIO_CLIPS.every(clip => clips.has(clip))).toBe(true), { timeout: 8000 });
  names = new Map([...clips].map(([name, buffer]) => [buffer, name]));
  const world = createWorld(1), player = createPlayerState('e:1', { x: 0, y: 0, z: 0 });
  world.entities['e:1'] = player;
  played.length = 0; // the two ambience beds start looping as soon as they load
  return events => audio.consume(events, 'e:1', world);
}

const phase = (round: number, from: RoundPhase, to: RoundPhase): SimulationEvent => ({ type: 'roundPhaseChanged', round, from, to });

describe('the round-start cue', () => {
  beforeEach(() => {
    played.length = 0;
    vi.stubGlobal('window', new EventTarget());
    vi.stubGlobal('AudioContext', FakeContext);
    vi.stubGlobal('fetch', async () => ({ ok: true, arrayBuffer: async () => new ArrayBuffer(8) }));
  });
  afterEach(() => vi.unstubAllGlobals());

  it('strikes a bell as a round starts spawning, and at no other change of phase', async () => {
    const at = await startAudio();
    at([phase(1, 'waiting', 'spawning')]);
    expect(played).toHaveLength(1);
    expect(played[0]).toMatch(/^round-start-[123]$/);
    played.length = 0;
    at([phase(2, 'intermission', 'spawning')]);
    expect(played).toHaveLength(1);
    expect(played[0]).toMatch(/^round-start-[123]$/);
    for (const [from, to] of [['spawning', 'active'], ['active', 'intermission'], ['active', 'gameOver']] as const) {
      played.length = 0;
      at([phase(3, from, to)]);
      expect(played, `${from} -> ${to}`).toEqual([]);
    }
  });

  it('no longer plays the distant groan', async () => {
    const at = await startAudio();
    for (let round = 1; round <= 12; round++) at([phase(round, 'intermission', 'spawning')]);
    expect(played).toHaveLength(12);
    expect(played).not.toContain('zombie-distant');
    expect(AUDIO_CLIPS).not.toContain('zombie-distant' as never);
    expect(assetExists('public/assets/audio/zombie-distant.mp3')).toBe(false);
  });

  it('takes a different strike from round to round, so a long run does not hear the same one every time', async () => {
    const at = await startAudio();
    for (let round = 1; round <= 9; round++) at([phase(round, 'intermission', 'spawning')]);
    expect(new Set(played)).toEqual(new Set(['round-start-1', 'round-start-2', 'round-start-3']));
    played.forEach((clip, index) => { if (index > 0) expect(clip, `round ${index + 1}`).not.toBe(played[index - 1]); });
    // The same round always sounds the same, wherever it is heard.
    played.length = 0;
    at([phase(4, 'intermission', 'spawning')]); at([phase(4, 'intermission', 'spawning')]);
    expect(played[0]).toBe(played[1]);
  });

  it('ships three short strikes, and the manifest that the start screen downloads from lists them', () => {
    const manifest = readAssetJson('public/assets/bootstrap-manifest.json').files as Record<string, { size: number }>;
    for (const name of ['round-start-1', 'round-start-2', 'round-start-3']) {
      expect(assetExists(`public/assets/audio/${name}.mp3`), name).toBe(true);
      expect(AUDIO_CLIPS).toContain(name as never);
      const size = manifest[`assets/audio/${name}.mp3`]?.size;
      // 64 kbit/s mono is about 8 KB a second, so this is a length of between one and three seconds.
      expect(size, name).toBeLessThan(24 * 1024);
      expect(size, name).toBeGreaterThan(8 * 1024);
    }
    expect(manifest['assets/audio/zombie-distant.mp3']).toBeUndefined();
  });
});
