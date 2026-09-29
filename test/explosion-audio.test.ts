import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GameAudio } from '../src/client/audio.ts';
import { AUDIO_CLIPS } from '../src/client/audioClips.ts';
import { createPlayerState, createWorld, type SimulationEvent } from '../src/core/index.ts';

/** Just enough of the Web Audio API to see which clip is started and how fast. */
interface Played { clip: string; rate: number }
const played: Played[] = [];
let names: Map<unknown, string> | null = null;

class FakeParam { value = 0; setTargetAtTime(): void { /* unused */ } }
class FakeNode { connect(): void { /* unused */ } disconnect(): void { /* unused */ } }
class FakeBuffer {
  data: Float32Array;
  constructor(readonly length: number, readonly sampleRate: number) { this.data = new Float32Array(length); }
  getChannelData(): Float32Array { return this.data; }
}
class FakeContext {
  state = 'running'; currentTime = 0; destination = new FakeNode();
  createGain() { return Object.assign(new FakeNode(), { gain: new FakeParam() }); }
  createStereoPanner() { return Object.assign(new FakeNode(), { pan: new FakeParam() }); }
  createWaveShaper() { return Object.assign(new FakeNode(), { curve: null }); }
  createBufferSource() {
    const source = Object.assign(new FakeNode(), { buffer: null as unknown, playbackRate: new FakeParam(), loop: false, onended: null as unknown });
    return Object.assign(source, { start: () => played.push({ clip: names?.get(source.buffer) ?? '?', rate: source.playbackRate.value }) });
  }
  decodeAudioData() { return Promise.resolve(new FakeBuffer(4800, 48000)); }
  resume() { return Promise.resolve(); }
  close() { return Promise.resolve(); }
}

async function startAudio(): Promise<(events: SimulationEvent[], px?: number) => void> {
  const audio = new GameAudio(new EventTarget() as unknown as HTMLElement);
  audio.startFromGesture();
  const clips = (audio as unknown as { clips: Map<string, unknown> }).clips;
  await vi.waitFor(() => expect(AUDIO_CLIPS.every(clip => clips.has(clip))).toBe(true), { timeout: 8000 });
  names = new Map([...clips].map(([name, buffer]) => [buffer, name]));
  const world = createWorld(1), player = createPlayerState('e:1', { x: 0, y: 0, z: 0 });
  world.entities['e:1'] = player;
  played.length = 0; // the two ambience beds start looping as soon as they load
  return (events, px = 0) => { player.position.x = px; audio.consume(events, 'e:1', world); };
}
const heard = () => played.map(entry => entry.clip);

describe('what explosions sound like, until the clips in docs/audio-wanted.md exist', () => {
  beforeEach(() => {
    played.length = 0;
    vi.stubGlobal('window', new EventTarget());
    vi.stubGlobal('AudioContext', FakeContext);
    vi.stubGlobal('fetch', async () => ({ ok: true, arrayBuffer: async () => new ArrayBuffer(8) }));
  });
  afterEach(() => vi.unstubAllGlobals());

  it('keeps ordinary reload completion quiet and racks shotguns', async () => {
    const at = await startAudio();
    at([{ type: 'weaponReloadCompleted', playerId: 'e:1', weaponId: 'starter-pistol',
      loaded: 4, magazineAmmo: 8, reserveAmmo: 32 }]);
    expect(heard()).toEqual([]);
    played.length = 0;
    at([{ type: 'weaponReloadCompleted', playerId: 'e:1', weaponId: 'trench-gun',
      loaded: 1, magazineAmmo: 6, reserveAmmo: 24 }]);
    expect(heard()).toEqual(['shotgun-rack']);
  });

  it('gives a grenade a metal tick as it is thrown and a clink when it bounces, and the recorded bang as it goes off', async () => {
    const at = await startAudio();
    at([{ type: 'grenadeThrown', grenadeId: 'g:1', playerId: 'e:1' }]);
    expect(heard()).toEqual(['door-metal']);
    played.length = 0;
    at([{ type: 'grenadeBounced', grenadeId: 'g:1', position: { x: 2, y: 0.1, z: 0 }, speed: 5 }]);
    expect(heard()).toEqual(['door-metal']);
    played.length = 0;
    at([{ type: 'grenadeExploded', grenadeId: 'g:1', playerId: 'e:1', position: { x: 3, y: 0.2, z: 0 } }]);
    expect(heard()).toEqual(['explosion-small']);
  });

  it('hears a teammate’s explosion where it happened, and nothing of one beyond earshot', async () => {
    const at = await startAudio();
    at([{ type: 'grenadeExploded', grenadeId: 'g:1', playerId: 'e:2', position: { x: 8, y: 0.2, z: 0 } }]);
    expect(heard()).toEqual(['explosion-small']);
    played.length = 0;
    at([{ type: 'grenadeExploded', grenadeId: 'g:1', playerId: 'e:2', position: { x: 90, y: 0.2, z: 0 } }]);
    expect(heard()).toEqual([]);
  });

  it('gives a barrel the large bang, a vehicle the same pitched lower, a mine and a rocket the small one', async () => {
    const at = await startAudio();
    const where = { x: 3, y: 0.5, z: 0 };
    const sound = (event: SimulationEvent) => { played.length = 0; at([event]); return played.map(entry => `${entry.clip}@${entry.rate}`); };
    expect(sound({ type: 'hazardExploded', hazardId: 'b', kind: 'barrel', playerId: 'e:2', position: where, radius: 4.5 })).toEqual(['explosion-large@1']);
    expect(sound({ type: 'hazardExploded', hazardId: 'j', kind: 'jeep', playerId: null, position: where, radius: 6 })).toEqual(['explosion-large@0.8']);
    expect(sound({ type: 'hazardExploded', hazardId: 't', kind: 'truck', playerId: 'e:1', position: where, radius: 6.5 })).toEqual(['explosion-large@0.8']);
    expect(sound({ type: 'mineExploded', mineId: 'm:1', playerId: 'e:2', position: where, radius: 4.5 })[0]).toContain('explosion-small');
    expect(sound({ type: 'weaponExploded', playerId: 'e:2', weaponId: 'rpg7', position: where, radius: 4 })[0]).toContain('explosion-small');
    expect(heard()).not.toContain('electric-boom');
    expect(sound({ type: 'weaponExploded', playerId: 'e:2', weaponId: 'irrlicht', position: where, radius: 2.2 })[0]).toContain('electric-boom');
  });

  it('clanks a barrel low and a car lower when shot, springs a mine with a clunk, and says nothing yet as a hazard catches', async () => {
    const at = await startAudio();
    const where = { x: 4, y: 0.5, z: 0 };
    const sound = (event: SimulationEvent) => { played.length = 0; at([event]); return played.slice(); };
    const barrel = sound({ type: 'hazardHit', hazardId: 'b', kind: 'barrel', playerId: 'e:2', damage: 50, position: where });
    const car = sound({ type: 'hazardHit', hazardId: 'j', kind: 'jeep', playerId: 'e:2', damage: 50, position: where });
    expect(barrel.map(entry => entry.clip)).toEqual(['door-metal']);
    expect(car.map(entry => entry.clip)).toEqual(['door-metal']);
    expect(car[0].rate).toBeLessThan(barrel[0].rate);
    expect(sound({ type: 'mineTriggered', mineId: 'm:1', position: where }).map(entry => entry.clip)).toEqual(['mechanical-button']);
    expect(sound({ type: 'hazardIgnited', hazardId: 'j', kind: 'jeep', position: where })).toEqual([]);
    expect(sound({ type: 'equipmentPurchased', playerId: 'e:1', buyId: 'x', item: 'bouncing-betty', charges: 2 }).map(entry => entry.clip)).toContain('pickup');
    expect(sound({ type: 'equipmentFull', playerId: 'e:1', buyId: 'x', item: 'bouncing-betty' }).map(entry => entry.clip)).toEqual(['buy-denied']);
  });
});
