import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import { HAZARD_KINDS, createHazard, type HazardDefinition } from '../src/core/index.ts';
import { SYNTH_CLIPS, SYNTH_RATE, synthesizeClip, type SynthClip } from '../src/client/explosionSynth.ts';
import { BlastEffects, groundFromSurfaces, type BlastKind } from '../src/client/blastEffects.ts';
import { GrenadeView } from '../src/client/grenadeView.ts';
import { HazardView } from '../src/client/hazardView.ts';
import { MineView } from '../src/client/mineView.ts';
import { LightPool } from '../src/client/lightPool.ts';
import { GRENADE_HEIGHT, MINE_CANISTER_HEIGHT, createGrenadeModel, createMineModel, mineRise, poseMine } from '../src/client/explosiveModels.ts';
import { TOSS_SECONDS, handToss } from '../src/client/weaponView.ts';
import { MINE_RULES } from '../src/core/grenade.ts';

vi.mock('../src/client/runtimeAssets.ts', async importOriginal => ({
  ...await importOriginal<typeof import('../src/client/runtimeAssets.ts')>(),
  loadModel: () => Promise.reject(new Error('no models in tests')),
}));

const rms = (samples: Float32Array, from: number, to: number) => {
  let sum = 0;
  for (let i = from; i < to; i++) sum += samples[i] * samples[i];
  return Math.sqrt(sum / Math.max(1, to - from));
};
/** The share of a window's energy below `cutoff` Hz (one-pole low-pass). */
function lowShare(samples: Float32Array, from: number, to: number, cutoff: number): number {
  const k = 1 - Math.exp(-2 * Math.PI * cutoff / SYNTH_RATE);
  let y = 0, low = 0, all = 0;
  for (let i = from; i < to; i++) { y += k * (samples[i] - y); low += y * y; all += samples[i] * samples[i]; }
  return low / Math.max(all, 1e-12);
}

describe('the synthesized sounds', () => {
  const clips = new Map<SynthClip, Float32Array>(SYNTH_CLIPS.map(name => [name, synthesizeClip(name)]));

  it('are finite, loud enough to hear, never past full scale, and end in silence', () => {
    for (const [name, samples] of clips) {
      let peak = 0, bad = 0;
      for (const value of samples) { if (!Number.isFinite(value)) bad++; peak = Math.max(peak, Math.abs(value)); }
      expect(bad, name).toBe(0);
      expect(peak, name).toBeLessThanOrEqual(1);
      expect(peak, name).toBeGreaterThan(0.5);
      expect(Math.abs(samples[samples.length - 1]), name).toBeLessThan(0.02);
    }
  });

  it('come out the same every time', () => {
    for (const name of ['blast-frag', 'mine-pop', 'grenade-bounce'] as const) expect(synthesizeClip(name)).toEqual(clips.get(name));
  });

  it('start with a bang and die away: the first tenth of a second is far louder than the last half', () => {
    for (const name of ['blast-frag', 'blast-barrel', 'blast-vehicle', 'blast-mine'] as const) {
      const samples = clips.get(name)!, tenth = SYNTH_RATE / 10;
      expect(rms(samples, 0, tenth), name).toBeGreaterThan(rms(samples, Math.floor(samples.length / 2), samples.length) * 6);
    }
  });

  it('get bigger with what blew up: a car lasts longer and rumbles lower than a grenade', () => {
    const frag = clips.get('blast-frag')!, barrel = clips.get('blast-barrel')!, vehicle = clips.get('blast-vehicle')!;
    expect(barrel.length).toBeGreaterThan(frag.length);
    expect(vehicle.length).toBeGreaterThan(barrel.length);
    // Under 120 Hz is where the weight of it is.
    const window = Math.floor(SYNTH_RATE * 0.4);
    expect(lowShare(vehicle, 0, window, 120)).toBeGreaterThan(lowShare(clips.get('blast-mine')!, 0, window, 120));
    expect(lowShare(barrel, 0, window, 120)).toBeGreaterThan(0.3);
  });

  it('keep small sounds small, and metal bright', () => {
    for (const name of ['grenade-ping', 'grenade-bounce', 'barrel-ping', 'metal-clang', 'mine-pop'] as const) {
      expect(clips.get(name)!.length / SYNTH_RATE, name).toBeLessThan(0.8);
    }
    // A grenade's ping is almost all treble; a blast is mostly not.
    const ping = clips.get('grenade-ping')!, blast = clips.get('blast-frag')!;
    expect(lowShare(ping, 0, Math.floor(SYNTH_RATE * 0.15), 500)).toBeLessThan(0.05);
    expect(lowShare(blast, 0, Math.floor(SYNTH_RATE * 0.15), 500)).toBeGreaterThan(0.4);
  });

  it('take well under a second to make, all told, so they can be built at the start screen', () => {
    const started = performance.now();
    for (const name of SYNTH_CLIPS) synthesizeClip(name);
    expect(performance.now() - started).toBeLessThan(1500);
  });
});

describe('the grenade and mine models', () => {
  it('build a grenade with a fuse, and a pinned one with its lever and ring as well', () => {
    const thrown = createGrenadeModel(), held = createGrenadeModel({ pinned: true });
    expect(held.root.children.length).toBeGreaterThan(thrown.root.children.length);
    const bounds = new THREE.Box3().setFromObject(thrown.root), size = bounds.getSize(new THREE.Vector3());
    expect(size.y).toBeGreaterThan(GRENADE_HEIGHT * 0.9);
    expect(size.y).toBeLessThan(GRENADE_HEIGHT * 1.4);
    expect(size.x).toBeLessThan(size.y);
    expect(thrown.fuse.emissiveIntensity).toBe(0);
  });

  it('build a mine with three prongs, and jump it under the rules’ pop height', () => {
    const mine = createMineModel();
    expect(mine.canister.children.length).toBeGreaterThanOrEqual(8);
    const rise = MINE_RULES.popHeight - 0.12;
    poseMine(mine, 'armed', 0, 0, rise);
    const resting = mine.canister.position.y;
    poseMine(mine, 'popping', 0.5, 0, rise);
    expect(mine.canister.position.y).toBeGreaterThan(resting + rise * 0.5);
    poseMine(mine, 'popping', 1, 0, rise);
    expect(mine.canister.position.y).toBeCloseTo(resting + rise);
    expect(new THREE.Box3().setFromObject(createMineModel().root).getSize(new THREE.Vector3()).y).toBeGreaterThan(MINE_CANISTER_HEIGHT);
    let last = -1;
    for (let p = 0; p <= 1; p += 0.05) { expect(mineRise(p)).toBeGreaterThanOrEqual(last); last = mineRise(p); }
  });

  it('blink amber while arming and glow red once set', () => {
    const mine = createMineModel();
    const colours = new Set<number>();
    for (let t = 0; t < 1; t += 0.05) { poseMine(mine, 'arming', 0, t, 1); colours.add(mine.lampMaterial.color.getHex()); }
    expect(colours.size).toBe(2);
    poseMine(mine, 'armed', 0, 0, 1);
    expect(mine.lampMaterial.color.getHex()).toBe(0x8a1410);
  });
});

describe('throwing and setting in the hand', () => {
  it.each(['grenade', 'mine'] as const)('dips the gun away and back, and shows the %s only while it is in hand and in view', kind => {
    expect(handToss(kind, -0.1)).toEqual({ dip: 0, item: null });
    expect(handToss(kind, TOSS_SECONDS[kind] + 0.01)).toEqual({ dip: 0, item: null });
    let shown = 0, peak = 0;
    for (let t = 0; t < TOSS_SECONDS[kind]; t += 0.01) {
      const { dip, item } = handToss(kind, t);
      expect(dip).toBeGreaterThanOrEqual(0); expect(dip).toBeLessThanOrEqual(1);
      peak = Math.max(peak, dip);
      if (!item) continue;
      shown++;
      // Inside the viewmodel camera's 52 degree view (a 4:3 window at the narrowest).
      const half = Math.tan(26 * Math.PI / 180) * -item.z;
      expect(Math.abs(item.y), `${kind} at ${t.toFixed(2)}`).toBeLessThan(half);
      expect(Math.abs(item.x), `${kind} at ${t.toFixed(2)}`).toBeLessThan(half * 1.33);
    }
    expect(peak).toBeGreaterThan(0.95);
    expect(shown).toBeGreaterThan(15);
    // The gun is back before the toss ends.
    expect(handToss(kind, TOSS_SECONDS[kind] - 0.02).dip).toBeLessThan(0.1);
  });
});

describe('explosions', () => {
  const surfaces = [{ minX: -50, maxX: 50, minZ: -50, maxZ: 50, startHeight: 0, endHeight: 0 }];
  let scene: THREE.Scene, camera: THREE.PerspectiveCamera, pool: LightPool, effects: BlastEffects;
  beforeEach(() => {
    scene = new THREE.Scene(); pool = new LightPool(scene);
    camera = new THREE.PerspectiveCamera(70, 1.33, 0.05, 80); camera.position.set(0, 1.6, 6); camera.lookAt(0, 1, 0);
    effects = new BlastEffects(scene, { ground: groundFromSurfaces(surfaces), lights: pool });
  });
  const run = (seconds: number, dt = 1 / 60) => { for (let t = 0; t < seconds; t += dt) effects.update(dt, camera); };
  const kinds: BlastKind[] = ['grenade', 'rocket', 'mine', 'barrel', 'vehicle', 'energy'];

  it.each(kinds)('a %s blast throws flame, and clears away completely', kind => {
    effects.update(1 / 60, camera);
    effects.detonate(kind, { x: 0, y: 0.5, z: 0 }, 4.5, 3);
    expect(effects.counts.fire).toBeGreaterThan(5);
    if (kind !== 'energy') { expect(effects.counts.smoke).toBeGreaterThan(5); }
    if (kind !== 'energy') expect(effects.counts.debris).toBeGreaterThan(5);
    // A barrel's husk and a car's wreck go on burning a while after the blast itself is over.
    run(30);
    expect(effects.counts.fire).toBe(0);
    expect(effects.counts.smoke).toBe(0);
    expect(effects.counts.debris).toBe(0);
    // Only the scorch mark stays, and it fades in the end.
    expect(effects.counts.scorch).toBe(kind === 'energy' ? 0 : 1);
    run(75);
    expect(effects.counts.scorch).toBe(0);
  });

  it('never holds more than its budget, however many go off at once', () => {
    effects.update(1 / 60, camera);
    for (let i = 0; i < 60; i++) effects.detonate(kinds[i % kinds.length], { x: (i % 7) - 3, y: 0.5, z: (i % 5) - 2 }, 4, i);
    const { fire, smoke, debris, scorch } = effects.counts;
    expect(fire).toBeLessThanOrEqual(320); expect(smoke).toBeLessThanOrEqual(300);
    expect(debris).toBeLessThanOrEqual(110); expect(scorch).toBeLessThanOrEqual(14);
    run(1);
  });

  it('lights the place with a flash that fades, and shakes the camera near it more than far away', () => {
    effects.update(1 / 60, camera);
    effects.detonate('barrel', { x: 0, y: 0.5, z: 4 }, 4.5, 1);
    run(0.05);
    pool.update(camera, 1 / 60);
    const flash = scene.children.find(child => child.name === 'blast-effects')!.children.filter(child => child.type === 'Object3D')
      .map(child => child as unknown as { intensity: number }).reduce((best, source) => Math.max(best, source.intensity), 0);
    expect(flash).toBeGreaterThan(20);
    const near = Math.hypot(...Object.values(effects.shake()));
    run(3);
    const later = Math.hypot(...Object.values(effects.shake()));
    expect(near).toBeGreaterThan(0.005);
    expect(later).toBeLessThan(near * 0.05);
    effects.clear();
    effects.update(1 / 60, camera);
    effects.detonate('barrel', { x: 40, y: 0.5, z: 40 }, 4.5, 1);
    expect(Math.hypot(...Object.values(effects.shake()))).toBeLessThan(0.0001);
  });

  it('burns while it is told to and stops when it is not, and a scheduled fire outlasts its blast', () => {
    effects.update(1 / 60, camera);
    for (let i = 0; i < 60; i++) { effects.burn('drum', { x: 0, y: 0, z: 0 }, 0.3, 1); effects.update(1 / 60, camera); }
    expect(effects.counts.flames).toBe(1);
    expect(effects.counts.fire).toBeGreaterThan(3);
    run(4);
    expect(effects.counts.flames).toBe(0);
    expect(effects.counts.fire).toBe(0);
    effects.detonate('vehicle', { x: 0, y: 1, z: 0 }, 6, 2);
    run(10);
    expect(effects.counts.flames, 'the wreck still burns').toBe(1);
    run(20);
    expect(effects.counts.flames).toBe(0);
  });

  it('lands debris on the floor and leaves none below it', () => {
    effects.update(1 / 60, camera);
    effects.detonate('barrel', { x: 0, y: 0.5, z: 0 }, 4.5, 9);
    run(3);
    const chunks = (effects as unknown as { chunks: Array<{ y: number; sy: number; landed: boolean }> }).chunks;
    expect(chunks.length).toBeGreaterThan(0);
    for (const chunk of chunks) expect(chunk.y).toBeGreaterThanOrEqual(chunk.sy / 2 - 1e-6);
    expect(chunks.some(chunk => chunk.landed)).toBe(true);
  });
});

describe('grenades and mines in the world', () => {
  const surfaces = [{ minX: -50, maxX: 50, minZ: -50, maxZ: 50, startHeight: 0, endHeight: 0 }];
  it('tumbles a thrown grenade, settles it on its side and puts it out with its blast', () => {
    const scene = new THREE.Scene(), camera = new THREE.PerspectiveCamera();
    const effects = new BlastEffects(scene, { ground: groundFromSurfaces(surfaces) });
    const view = new GrenadeView(scene, effects);
    const grenade = { id: 'g:1', ownerId: 'e:1' as const, position: { x: 0, y: 1.5, z: 0 }, velocity: { x: 0, y: 3, z: -8 }, fuseTicksRemaining: 100 };
    view.update([grenade], 0, 1 / 60);
    const mesh = scene.children.find(child => child.name === 'grenade')!;
    expect(mesh).toBeDefined();
    const start = mesh.quaternion.clone();
    for (let i = 0; i < 20; i++) view.update([grenade], i, 1 / 60);
    expect(mesh.quaternion.angleTo(start)).toBeGreaterThan(1.5);
    // Rolling to a stop, it lies flat: its long axis is level.
    const resting = { ...grenade, position: { x: 0, y: 0.1, z: -4 }, velocity: { x: 0, y: 0, z: 0 } };
    for (let i = 0; i < 90; i++) view.update([resting], i, 1 / 60);
    expect(Math.abs(new THREE.Vector3(0, 1, 0).applyQuaternion(mesh.quaternion).y)).toBeLessThan(0.05);
    // Its neck glows as the fuse runs out.
    view.update([{ ...resting, fuseTicksRemaining: 10 }], 91, 1 / 60);
    let glow = 0;
    mesh.traverse(object => { const material = (object as THREE.Mesh).material as THREE.MeshStandardMaterial | undefined; if (material?.emissiveIntensity) glow = material.emissiveIntensity; });
    expect(glow).toBeGreaterThan(0);
    // Gone from the pool, it is gone from the scene; the blast is drawn.
    view.update([], 92, 1 / 60);
    expect(scene.children.find(child => child.name === 'grenade')).toBeUndefined();
    camera.position.set(0, 1.6, 0);
    view.events([{ type: 'grenadeExploded', grenadeId: 'g:1', playerId: 'e:1', position: { x: 0, y: 0.2, z: -4 } }], 92);
    expect(effects.counts.fire).toBeGreaterThan(5);
    view.events([{ type: 'matchRestarted', previousSeed: 1, seed: 2 }], 93);
    expect(effects.counts.fire).toBe(0);
  });

  it('draws every kind of explosion from its own event', () => {
    const scene = new THREE.Scene();
    const effects = new BlastEffects(scene, { ground: groundFromSurfaces(surfaces) });
    const view = new GrenadeView(scene, effects);
    const at = { x: 0, y: 0.5, z: 0 };
    const counts = (event: Parameters<GrenadeView['events']>[0][number]) => {
      effects.clear(); view.events([event], 1);
      return effects.counts;
    };
    expect(counts({ type: 'mineExploded', mineId: 'm:1', playerId: 'e:1', position: at, radius: 4.5 }).debris).toBeGreaterThan(20);
    expect(counts({ type: 'hazardExploded', hazardId: 'a', kind: 'barrel', playerId: 'e:1', position: at, radius: 4.5 }).flames).toBe(1);
    expect(counts({ type: 'hazardExploded', hazardId: 'a', kind: 'jeep', playerId: 'e:1', position: at, radius: 6 }).smoke).toBeGreaterThan(30);
    expect(counts({ type: 'weaponExploded', playerId: 'e:1', weaponId: 'irrlicht', position: at, radius: 2.2 }).smoke).toBe(0);
    expect(counts({ type: 'weaponExploded', playerId: 'e:1', weaponId: 'rpg7', position: at, radius: 4 }).smoke).toBeGreaterThan(5);
    expect(counts({ type: 'hazardHit', hazardId: 'a', kind: 'barrel', playerId: 'e:1', damage: 50, position: at }).fire).toBeGreaterThan(3);
  });

  it('shows mines where they lie, blinks them, jumps a sprung one and clears the lot', () => {
    const scene = new THREE.Scene(), view = new MineView(scene);
    const mines = [
      { id: 'm:1', ownerId: 'e:1' as const, position: { x: 1, y: 0, z: 2 }, phase: 'arming' as const, ticksRemaining: 40 },
      { id: 'm:2', ownerId: 'e:1' as const, position: { x: 3, y: 0, z: 2 }, phase: 'popping' as const, ticksRemaining: MINE_RULES.popTicks / 2 },
    ];
    view.update(mines, 0.1);
    const models = scene.children.filter(child => child.name === 'bouncing-betty');
    expect(models).toHaveLength(2);
    expect(models[0].position.x).toBe(1);
    const jumped = models[1].children.find(child => child.type === 'Group')!;
    expect(jumped.position.y).toBeGreaterThan(0.3);
    view.update([mines[0]], 0.2);
    expect(scene.children.filter(child => child.name === 'bouncing-betty')).toHaveLength(1);
    view.clear();
    expect(scene.children.filter(child => child.name === 'bouncing-betty')).toHaveLength(0);
  });
});

describe('barrels and cars in the world', () => {
  const barrel: HazardDefinition = { id: 'b1', kind: 'barrel', position: { x: 0, y: 0, z: -3 }, yaw: 0 };
  const jeep: HazardDefinition = { id: 'j1', kind: 'jeep', position: { x: 6, y: 0, z: -3 }, yaw: 0.5 };
  const surfaces = [{ minX: -50, maxX: 50, minZ: -50, maxZ: 50, startHeight: 0, endHeight: 0 }];
  function setup() {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const scene = new THREE.Scene(), camera = new THREE.PerspectiveCamera();
    const effects = new BlastEffects(scene, { ground: groundFromSurfaces(surfaces) });
    const view = new HazardView(scene, [barrel, jeep], effects);
    const states = [createHazard(barrel), createHazard(jeep)];
    return { scene, camera, effects, view, states };
  }

  it('shows a stand-in until the model loads, and keeps it if it never does', async () => {
    const { scene, view } = setup();
    await view.ready;
    expect(view.failures).toBe(2);
    expect(scene.getObjectByName('hazards')!.children).toHaveLength(2);
  });

  it('smokes as it is shot up, burns with a fire that grows, and goes out when it goes off', () => {
    const { effects, camera, view, states } = setup();
    view.update(states); effects.update(1 / 60, camera);
    expect(effects.counts.flames).toBe(0);
    states[0].health = HAZARD_KINDS.barrel.health * 0.5;
    view.update(states);
    expect(effects.counts.flames).toBe(1);
    states[0].phase = 'burning'; states[0].burnTicks = 10;
    for (let i = 0; i < 30; i++) { view.update(states); effects.update(1 / 60, camera); }
    expect(effects.counts.fire).toBeGreaterThan(2);
    states[0].phase = 'exploded';
    view.update(states); effects.update(1 / 60, camera); effects.update(1 / 60, camera);
    expect(effects.counts.flames).toBe(0);
  });

  it('leaves a husk where a barrel stood and a blackened shell where a car did, and puts both back for a new match', () => {
    const { scene, view, states } = setup();
    const hazards = scene.getObjectByName('hazards')!;
    states[0].phase = 'exploded'; states[1].phase = 'exploded';
    view.update(states);
    // The barrel's stand-in is hidden and a husk (a group) is added; the car stays.
    expect(hazards.children.filter(child => child.type === 'Group')).toHaveLength(1);
    expect(hazards.children.filter(child => child.type === 'Mesh' && child.visible)).toHaveLength(1);
    states[0].phase = 'intact'; states[1].phase = 'intact';
    view.update(states);
    expect(hazards.children.filter(child => child.type === 'Group')).toHaveLength(0);
    expect(hazards.children.every(child => child.visible)).toBe(true);
  });
});
