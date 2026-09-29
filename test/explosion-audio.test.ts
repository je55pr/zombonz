import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GameAudio } from '../src/client/audio.ts';
import { AUDIO_CLIPS } from '../src/client/audioClips.ts';
import { SYNTH_CLIPS } from '../src/client/explosionSynth.ts';
import { addEntity, createPlayerState, createWorld, type SimulationEvent } from '../src/core/index.ts';

/** Just enough of the Web Audio API to see which clip is started, how loudly, and how fast. */
interface Played { clip: string; gain: number; rate: number }
const played: Played[] = [];
let fakeClips: Map<unknown, string> | null = null;

class FakeParam { value = 0; setTargetAtTime(): void { /* unused */ } }
class FakeNode { connect(): void { /* unused */ } disconnect(): void { /* unused */ } }
class FakeBuffer {
  data: Float32Array;
  constructor(readonly length: number, readonly sampleRate: number) { this.data = new Float32Array(length); }
  getChannelData(): Float32Array { return this.data; }
  copyToChannel(source: Float32Array): void { this.data = source; }
}
class FakeContext {
  state = 'running'; currentTime = 0; destination = new FakeNode();
  createGain() { return Object.assign(new FakeNode(), { gain: new FakeParam() }); }
  createStereoPanner() { return Object.assign(new FakeNode(), { pan: new FakeParam() }); }
  createWaveShaper() { return Object.assign(new FakeNode(), { curve: null }); }
  createBuffer(_channels: number, length: number, rate: number) { return new FakeBuffer(length, rate); }
  createBufferSource() {
    const source = Object.assign(new FakeNode(), { buffer: null as unknown, playbackRate: new FakeParam(), loop: false, onended: null as unknown });
    return Object.assign(source, { start: () => played.push({ clip: fakeClips?.get(source.buffer) ?? '?', gain: 0, rate: source.playbackRate.value }) });
  }
  decodeAudioData() { return Promise.resolve(new FakeBuffer(4800, 48000)); }
  resume() { return Promise.resolve(); }
  close() { return Promise.resolve(); }
}

async function startAudio(): Promise<{ audio: GameAudio; at: (events: SimulationEvent[], px?: number) => void }> {
  const target = new EventTarget();
  const audio = new GameAudio(target as unknown as HTMLElement);
  audio.startFromGesture();
  // Rendering the synthesized clips gives the page a moment between each.
  await vi.waitFor(() => {
    const clips = (audio as unknown as { clips: Map<string, unknown> }).clips;
    expect([...SYNTH_CLIPS, ...AUDIO_CLIPS].every(clip => clips.has(clip))).toBe(true);
  }, { timeout: 8000 });
  const clips = (audio as unknown as { clips: Map<string, unknown> }).clips;
  fakeClips = new Map([...clips].map(([name, buffer]) => [buffer, name]));
  const world = createWorld(1), player = createPlayerState('e:1', { x: 0, y: 0, z: 0 });
  world.entities['e:1'] = player;
  return { audio, at: (events, px = 0) => { player.position.x = px; audio.consume(events, 'e:1', world); } };
}
const heard = () => played.map(entry => entry.clip);

describe('what explosions sound like', () => {
  beforeEach(() => {
    played.length = 0;
    vi.stubGlobal('window', new EventTarget());
    vi.stubGlobal('AudioContext', FakeContext);
    vi.stubGlobal('fetch', async () => ({ ok: true, arrayBuffer: async () => new ArrayBuffer(8) }));
  });
  afterEach(() => vi.unstubAllGlobals());

  it('gives a grenade a ping as it is thrown, a clink when it bounces and a synthesized bang under the recorded one', async () => {
    const { at } = await startAudio();
    at([{ type: 'grenadeThrown', grenadeId: 'g:1', playerId: 'e:1' }]);
    expect(heard()).toContain('grenade-ping');
    played.length = 0;
    at([{ type: 'grenadeBounced', grenadeId: 'g:1', position: { x: 2, y: 0.1, z: 0 }, speed: 5 }]);
    expect(heard()).toEqual(['grenade-bounce']);
    played.length = 0;
    at([{ type: 'grenadeExploded', grenadeId: 'g:1', playerId: 'e:1', position: { x: 3, y: 0.2, z: 0 } }]);
    expect(heard()).toContain('blast-frag');
  });

  it('hears a teammate’s explosion where it happened, and nothing of one beyond earshot', async () => {
    const { at } = await startAudio();
    at([{ type: 'grenadeExploded', grenadeId: 'g:1', playerId: 'e:2', position: { x: 8, y: 0.2, z: 0 } }]);
    expect(heard()).toContain('blast-frag');
    played.length = 0;
    at([{ type: 'grenadeExploded', grenadeId: 'g:1', playerId: 'e:2', position: { x: 90, y: 0.2, z: 0 } }]);
    expect(heard()).toEqual([]);
  });

  it('gives each thing its own bang: a barrel’s, a car’s, a mine’s and a rocket’s', async () => {
    const { at } = await startAudio();
    const at3 = { x: 3, y: 0.5, z: 0 };
    const sounds = (event: SimulationEvent) => { played.length = 0; at([event]); return heard(); };
    expect(sounds({ type: 'hazardExploded', hazardId: 'b', kind: 'barrel', playerId: 'e:2', position: at3, radius: 4.5 })).toContain('blast-barrel');
    expect(sounds({ type: 'hazardExploded', hazardId: 'j', kind: 'jeep', playerId: null, position: at3, radius: 6 })).toContain('blast-vehicle');
    expect(sounds({ type: 'hazardExploded', hazardId: 't', kind: 'truck', playerId: 'e:1', position: at3, radius: 6.5 })).toContain('blast-vehicle');
    expect(sounds({ type: 'mineExploded', mineId: 'm:1', playerId: 'e:2', position: at3, radius: 4.5 })).toContain('blast-mine');
    expect(sounds({ type: 'weaponExploded', playerId: 'e:2', weaponId: 'rpg7', position: at3, radius: 4 })).toContain('blast-frag');
    expect(sounds({ type: 'weaponExploded', playerId: 'e:2', weaponId: 'irrlicht', position: at3, radius: 2.2 })).not.toContain('blast-frag');
  });

  it('rings a barrel and clangs a car when shot, whoomphs as they catch, and pops a mine as it springs', async () => {
    const { at } = await startAudio();
    const where = { x: 4, y: 0.5, z: 0 };
    const sounds = (event: SimulationEvent) => { played.length = 0; at([event]); return heard(); };
    expect(sounds({ type: 'hazardHit', hazardId: 'b', kind: 'barrel', playerId: 'e:2', damage: 50, position: where })).toEqual(['barrel-ping']);
    expect(sounds({ type: 'hazardHit', hazardId: 'j', kind: 'jeep', playerId: 'e:2', damage: 50, position: where })).toEqual(['metal-clang']);
    expect(sounds({ type: 'hazardIgnited', hazardId: 'j', kind: 'jeep', position: where })).toEqual(['flame-ignite']);
    expect(sounds({ type: 'mineTriggered', mineId: 'm:1', position: where })).toEqual(['mine-pop']);
    expect(sounds({ type: 'equipmentPurchased', playerId: 'e:1', buyId: 'x', item: 'bouncing-betty', charges: 2 })).toContain('pickup');
    expect(sounds({ type: 'equipmentFull', playerId: 'e:1', buyId: 'x', item: 'bouncing-betty' })).toEqual(['buy-denied']);
  });

  it('crackles from anything burning nearby, and not from a fire far off', async () => {
    const { audio } = await startAudio();
    const world = createWorld(1);
    addEntity(world, createPlayerState('e:1', { x: 0, y: 0, z: 0 }));
    world.tick = 0;
    audio.burning([{ id: 'j', position: { x: 6, y: 1, z: 0 } }], 'e:1', world);
    expect(heard().some(clip => clip.startsWith('fire-crackle'))).toBe(true);
    played.length = 0;
    audio.burning([{ id: 'j', position: { x: 200, y: 1, z: 0 } }], 'e:1', world);
    expect(heard()).toEqual([]);
  });
});
