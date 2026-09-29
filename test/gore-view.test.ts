import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { readAssetGeometry } from '../scripts/inspect-assets.mjs';
import {
  CRAWL_POINTS, LIMB, ZOMBIE_RIG_IDS, createZombieState, swingTiming, zombieHeadCentre, type ZombieState, type SimulationEvent, type Vec3,
} from '../src/core/index.ts';
import { GoreDirector } from '../src/client/goreDirector.ts';
import { GORE_BUDGET, GoreEffects } from '../src/client/goreEffects.ts';
import { ZOMBIE_ASSET_IDS, inPlaceClip, type ZombieAnimation, type ZombieAsset, type ZombieAssetId } from '../src/client/runtimeAssets.ts';
import { SkinnedZombieView } from '../src/client/skinnedZombieView.ts';
import { MAP_ZOMBIE_LOOKS, zombieLook } from '../src/client/zombieLooks.ts';
import { LIMB_IDS, RIGS, prepareLimbs } from '../src/client/zombieRig.ts';
import { MAPS } from '../src/maps/index.ts';

async function loadAsset(id: ZombieAssetId): Promise<ZombieAsset> {
  const model = await readAssetGeometry(`public/assets/zombies/${id}/model.glb`);
  const clips: ZombieAsset['clips'] = {};
  for (const name of ['idle', 'walk', 'run', 'attack', ...(id === 'peter_d' ? ['death'] : [])] as ZombieAnimation[]) {
    clips[name] = inPlaceClip((await readAssetGeometry(`public/assets/zombies/${id}/${name}.glb`)).animations[0], model.scene);
  }
  return { id, model: model.scene, clips };
}
const assets = Object.fromEntries(await Promise.all(ZOMBIE_ASSET_IDS.map(async id => [id, await loadAsset(id)]))) as Record<ZombieAssetId, ZombieAsset>;

/** Runs a view for `ticks` ticks (long enough for its crossfade to finish), returning the world position of a bone. */
function settle(view: SkinnedZombieView, zombie: ZombieState, ticks = 30, from = 0): number {
  let tick = from;
  for (let i = 0; i < ticks; i++) view.update(zombie, ++tick);
  return tick;
}
const boneOf = (view: SkinnedZombieView, name: string) => (view as unknown as { bones: Map<string, THREE.Object3D> }).bones.get(name)!.getWorldPosition(new THREE.Vector3());

describe('zombie looks', () => {
  it('are drawn from the zombie’s own id: the same every time, different from one zombie to the next', () => {
    const a = zombieLook({ id: 'e:12' }, 'bunker'), b = zombieLook({ id: 'e:12' }, 'bunker');
    expect(a).toEqual(b);
    const looks = Array.from({ length: 40 }, (_, i) => zombieLook({ id: `e:${i + 2}` as const }, 'bunker'));
    expect(new Set(looks.map(look => look.tint.getHexString())).size).toBeGreaterThan(8);
    expect(new Set(looks.map(look => look.tempo.toFixed(3))).size).toBeGreaterThan(30);
    expect(new Set(looks.map(look => look.posture)).size).toBeGreaterThanOrEqual(3);
  });

  it('stay within a believable build and pace, so hit volumes and animation still fit', () => {
    for (let i = 2; i < 200; i++) {
      const look = zombieLook({ id: `e:${i}` as const }, i % 2 ? 'bunker' : 'asylum');
      expect(look.height).toBeGreaterThanOrEqual(0.95); expect(look.height).toBeLessThanOrEqual(1.06);
      expect(look.width).toBeGreaterThanOrEqual(0.96); expect(look.width).toBeLessThanOrEqual(1.05);
      expect(look.tempo).toBeGreaterThanOrEqual(0.88); expect(look.tempo).toBeLessThanOrEqual(1.14);
      expect(look.phase).toBeGreaterThanOrEqual(0); expect(look.phase).toBeLessThan(1);
    }
  });

  it('give each map an identity of its own: the Asylum’s dead are paler than the Bunker’s', () => {
    const brightness = (map: string) => {
      const looks = Array.from({ length: 300 }, (_, i) => zombieLook({ id: `e:${i + 2}` as const }, map));
      return looks.reduce((sum, look) => sum + (look.tint.r + look.tint.g + look.tint.b) / 3, 0) / looks.length;
    };
    expect(brightness('asylum')).toBeGreaterThan(brightness('bunker') + 0.15);
    expect(Object.keys(MAP_ZOMBIE_LOOKS).sort()).toEqual(Object.keys(MAPS).sort());
  });

  it('uses only the models there are, in the proportions each map asks for', () => {
    expect(ZOMBIE_ASSET_IDS).toHaveLength(ZOMBIE_RIG_IDS.length);
    for (const map of Object.values(MAPS)) {
      expect(map.zombieLooks, map.id).toBeDefined();
      expect(map.zombieLooks!.length, map.id).toBeLessThanOrEqual(ZOMBIE_RIG_IDS.length);
      expect(map.zombieLooks!.filter(weight => weight > 0).length, map.id).toBeGreaterThanOrEqual(2);
    }
  });
});

describe('taking a limb off a model', () => {
  it('knows which triangles of the one-mesh soldier are each limb: a small share of the body, none shared', () => {
    const view = new SkinnedZombieView(assets.peter_d, zombieLook({ id: 'e:2' }));
    const mesh = (view as unknown as { skinned: THREE.SkinnedMesh[] }).skinned[0];
    const data = prepareLimbs(mesh, RIGS.peter_d);
    const total = mesh.geometry.index!.count / 3;
    const seen = new Set<number>();
    for (const limb of LIMB_IDS) {
      const triangles = data.triangles.get(limb)!;
      expect(triangles.length, limb).toBeGreaterThan(50);
      expect(triangles.length / total, limb).toBeLessThan(0.3);
      for (const t of triangles) { expect(seen.has(t), `${limb} ${t}`).toBe(false); seen.add(t); }
    }
    expect(mesh.geometry.attributes.aLimb.count).toBe(mesh.geometry.attributes.position.count);
  });

  it.each(ZOMBIE_ASSET_IDS)('%s: a lost limb is hidden and its stump closed, and back on the next zombie it is not', id => {
    const view = new SkinnedZombieView(assets[id], zombieLook({ id: 'e:2' }));
    const zombie = createZombieState('e:2', { x: 0, y: 0, z: 0 }, 1, 'walk', ZOMBIE_ASSET_IDS.indexOf(id));
    let tick = settle(view, zombie);
    const capsBefore = (view as unknown as { caps: unknown[] }).caps.length;
    zombie.limbs = LIMB.head | LIMB.armL;
    tick = settle(view, zombie, 2, tick);
    expect((view as unknown as { caps: unknown[] }).caps.length).toBe(capsBefore + 2);
    if (id === 'peter_d') expect((view as unknown as { limbMask: { value: number } }).limbMask.value).toBe(LIMB.head | LIMB.armL);
    else {
      const hidden = (view as unknown as { skinned: THREE.SkinnedMesh[] }).skinned.filter(mesh => !mesh.visible).map(mesh => mesh.name).sort();
      expect(hidden).toEqual(['Z_Head', 'Z_L_ArmPalm', 'Z_L_Forearm']);
    }
    // No further stumps for what was already gone.
    settle(view, zombie, 5, tick);
    expect((view as unknown as { caps: unknown[] }).caps.length).toBe(capsBefore + 2);
    const other = new SkinnedZombieView(assets[id], zombieLook({ id: 'e:3' }));
    settle(other, createZombieState('e:3', { x: 0, y: 0, z: 0 }, 1));
    expect((other as unknown as { caps: unknown[] }).caps.length).toBe(0);
  });

  it.each(ZOMBIE_ASSET_IDS)('%s: a limb comes off as loose, well-formed geometry at the place it was, in the zombie’s colours', id => {
    const view = new SkinnedZombieView(assets[id], zombieLook({ id: 'e:2' }));
    const zombie = createZombieState('e:2', { x: 3, y: 0, z: -2 }, 1, 'walk', ZOMBIE_ASSET_IDS.indexOf(id));
    view.update(zombie, 1); settle(view, zombie);
    const expected: Record<string, [number, number]> = { head: [1.25, 1.75], armL: [0.55, 1.3], armR: [0.55, 1.3], legL: [0.05, 0.6], legR: [0.05, 0.6] };
    for (const limb of LIMB_IDS) {
      const piece = view.detach(limb)!;
      expect(piece, limb).not.toBeNull();
      expect(piece.children.length).toBeGreaterThan(0);
      expect(piece.position.y, limb).toBeGreaterThan(expected[limb][0]); expect(piece.position.y, limb).toBeLessThan(expected[limb][1]);
      expect(Math.abs(piece.position.x - 3), limb).toBeLessThan(0.8); expect(Math.abs(piece.position.z + 2), limb).toBeLessThan(0.8);
      for (const mesh of piece.children as THREE.Mesh[]) {
        const position = mesh.geometry.attributes.position, box = new THREE.Box3().setFromBufferAttribute(position as THREE.BufferAttribute);
        expect(Number.isFinite(box.min.x + box.max.x + box.min.y + box.max.y), limb).toBe(true);
        expect(box.getSize(new THREE.Vector3()).length(), limb).toBeLessThan(0.9);
        expect(mesh.geometry.attributes.normal.count).toBe(position.count);
        expect(mesh.geometry.index!.count % 3).toBe(0);
      }
    }
  });
});

describe('a crawler is bent over, and its body is where the simulation put it', () => {
  it.each(ZOMBIE_ASSET_IDS)('%s: hips low, head up and forward, arms reaching, as in the crawl pose the hit volumes use', id => {
    const view = new SkinnedZombieView(assets[id], zombieLook({ id: 'e:2' }));
    const zombie = createZombieState('e:2', { x: 0, y: 0, z: 0 }, 1, 'walk', ZOMBIE_ASSET_IDS.indexOf(id));
    zombie.limbs = LIMB.legL | LIMB.legR;
    settle(view, zombie, 40);
    const rig = RIGS[id];
    const hips = boneOf(view, rig.hips), head = boneOf(view, rig.head), hand = boneOf(view, rig.arms.L[2]);
    // The hips sit at the height the simulation's crawl pose gives them, scaled by this zombie's build.
    expect(Math.abs(hips.y - CRAWL_POINTS[10] * zombieLook({ id: 'e:2' }).height)).toBeLessThan(0.08);
    expect(hips.y).toBeLessThan(0.55);
    expect(head.y).toBeLessThan(0.9); expect(head.y).toBeGreaterThan(0.3);
    expect(head.z).toBeGreaterThan(hips.z + 0.4);
    expect(hand.z).toBeGreaterThan(hips.z + 0.4);
    expect(hand.y).toBeLessThan(0.55);
  });

  it.each(ZOMBIE_ASSET_IDS)('%s: standing, the head bone is where the simulation puts the head (within a skull’s width)', id => {
    const view = new SkinnedZombieView(assets[id], { ...zombieLook({ id: 'e:2' }), posture: 'straight' });
    const zombie = createZombieState('e:2', { x: 0, y: 0, z: 0 }, 1, 'walk', ZOMBIE_ASSET_IDS.indexOf(id));
    settle(view, zombie, 40);
    const head = boneOf(view, RIGS[id].head), body = zombieHeadCentre(zombie);
    expect(Math.hypot(head.x - body.x, head.y - body.y, head.z - body.z)).toBeLessThan(0.16);
  });

  it.each(ZOMBIE_ASSET_IDS)('%s: through a swing the drawn head follows the simulation’s, from wind-up to blow', id => {
    const view = new SkinnedZombieView(assets[id], { ...zombieLook({ id: 'e:2' }), posture: 'straight' });
    const zombie = createZombieState('e:2', { x: 0, y: 0, z: 0 }, 1, 'walk', ZOMBIE_ASSET_IDS.indexOf(id));
    const { windupTicks, totalTicks } = swingTiming(zombie);
    let tick = settle(view, zombie, 30);
    zombie.attackTicks = 1; tick = settle(view, zombie, 12, tick);
    for (const ticks of [windupTicks * 0.4, windupTicks * 0.8, windupTicks, windupTicks + 8, totalTicks * 0.85]) {
      zombie.attackTicks = Math.round(ticks); tick = settle(view, zombie, 12, tick);
      const drawn = boneOf(view, RIGS[id].head), body = zombieHeadCentre(zombie);
      expect(Math.hypot(drawn.x - body.x, drawn.y - body.y, drawn.z - body.z), `${id} at swing tick ${zombie.attackTicks}`).toBeLessThan(0.22);
    }
  });
});

describe('gore effects', () => {
  const scene = () => new THREE.Scene();
  const ground = () => 0;

  it('never exceed their budgets, however much is thrown, and clean themselves up', () => {
    const gore = new GoreEffects(scene(), { ground });
    for (let i = 0; i < 40; i++) gore.spray({ x: 0, y: 1, z: 0 }, { x: 0, y: 0, z: -1 }, 60);
    gore.burst({ x: 0, y: 1, z: 0 }, 400);
    for (let i = 0; i < 100; i++) gore.splat(i * 0.1, 0, 0, 1);
    for (let i = 0; i < 40; i++) gore.throwPiece(new THREE.Group().add(new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.1, 0.1), new THREE.MeshBasicMaterial())) as THREE.Group, { x: 1, y: 3, z: 0 });
    const counts = gore.counts();
    expect(counts.droplets).toBeLessThanOrEqual(GORE_BUDGET.droplets);
    expect(counts.chunks).toBeLessThanOrEqual(GORE_BUDGET.chunks);
    expect(counts.pieces).toBeLessThanOrEqual(GORE_BUDGET.pieces);
    expect(counts.splats).toBeLessThanOrEqual(GORE_BUDGET.splats);
    for (let i = 0; i < 60 * 60; i++) gore.update(1 / 60);
    expect(gore.counts()).toEqual({ droplets: 0, chunks: 0, pieces: 0, splats: 0 });
    expect(gore.active).toBe(false);
  });

  it('land on the floor and stay there, and droplets are gone when they touch it', () => {
    const gore = new GoreEffects(scene(), { ground: () => 0.5 });
    const piece = new THREE.Group().add(new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.1, 0.1), new THREE.MeshBasicMaterial())) as THREE.Group;
    piece.position.set(0, 1.5, 0);
    gore.throwPiece(piece, { x: 2, y: 2, z: 0 }, 0.1);
    for (let i = 0; i < 60 * 4; i++) gore.update(1 / 60);
    expect(piece.position.y).toBeGreaterThanOrEqual(0.5 + 0.1 - 1e-6);
    expect(piece.position.y).toBeLessThan(0.75);
    gore.spray({ x: 0, y: 0.6, z: 0 }, { x: 0, y: -1, z: 0 }, 30, 3);
    for (let i = 0; i < 30; i++) gore.update(1 / 60);
    expect(gore.counts().droplets).toBe(0);
  });

  it('draw nothing and cost nothing when nothing has happened, and forget it all on clear', () => {
    const gore = new GoreEffects(scene(), { ground });
    gore.update(1 / 60);
    expect((gore.root.children.find(child => (child as THREE.Points).isPoints) as THREE.Points).visible).toBe(false);
    gore.spray({ x: 0, y: 2, z: 0 }, null, 20);
    gore.update(1 / 60);
    expect(gore.counts().droplets).toBeGreaterThan(0);
    gore.clear();
    expect(gore.counts()).toEqual({ droplets: 0, chunks: 0, pieces: 0, splats: 0 });
  });
});

describe('what the gore director makes of events', () => {
  function rig() {
    const effects = new GoreEffects(new THREE.Scene(), { ground: () => 0 });
    const calls = { sprays: 0, bursts: 0, splats: 0, pieces: 0 };
    const spray = effects.spray.bind(effects), burst = effects.burst.bind(effects), splat = effects.splat.bind(effects), piece = effects.throwPiece.bind(effects);
    effects.spray = (...args) => { calls.sprays++; spray(...args); };
    effects.burst = (...args) => { calls.bursts++; burst(...args); };
    effects.splat = (...args) => { calls.splats++; splat(...args); };
    effects.throwPiece = (...args) => { calls.pieces++; piece(...args); };
    const flashes: string[] = [];
    const detachments: string[] = [];
    const views = new Map<`e:${number}`, SkinnedZombieView>();
    const world = { tick: 0, seed: 1, nextEntityNumber: 9, entities: {} as Record<string, unknown> };
    for (const id of ['e:2', 'e:3'] as const) {
      world.entities[id] = createZombieState(id, { x: 0, y: 0, z: -4 }, 1);
      views.set(id, { flash: () => flashes.push(id),
        detach: (limb: string) => { detachments.push(limb); const group = new THREE.Group(); group.position.set(0, 1, -4); group.add(new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.1, 0.1), new THREE.MeshBasicMaterial())); return group; },
      } as unknown as SkinnedZombieView);
    }
    return { director: new GoreDirector(effects, views), calls, flashes, detachments, world: world as never, effects };
  }
  const dismembered = (lost: Array<'head' | 'armL' | 'armR' | 'legL' | 'legR'>, patch: Record<string, unknown> = {}): SimulationEvent => ({
    type: 'zombieDismembered', zombieId: 'e:2', playerId: 'e:1', lost, limbs: 0, part: 'armL', point: { x: 0, y: 1, z: -4 } as Vec3,
    direction: { x: 0, y: 0, z: -1 } as Vec3, source: 'bullet', lethal: false, crawler: false, gutted: false, ...patch,
  } as SimulationEvent);

  it('sprays and flashes the body where a bullet lands, more for the head, and ignores a hit with no place', () => {
    const { director, calls, flashes, world } = rig();
    director.consume([{ type: 'weaponHit', playerId: 'e:1', weaponId: 'kar98k', zombieId: 'e:2', damage: 10, distance: 4, hitZone: 'body' }], world);
    expect(calls.sprays).toBe(0); expect(flashes).toEqual([]);
    director.consume([{ type: 'weaponHit', playerId: 'e:1', weaponId: 'kar98k', zombieId: 'e:2', damage: 10, distance: 4, hitZone: 'head',
      part: 'head', point: { x: 0, y: 1.5, z: -4 }, direction: { x: 0, y: 0, z: -1 } }], world);
    expect(calls.sprays).toBe(2); expect(flashes).toEqual(['e:2']);
  });

  it('throws what came off, and a shot-off head and blast-torn zombie make a mess to match', () => {
    const { director, calls, detachments, world } = rig();
    director.consume([dismembered(['armL'])], world);
    expect(detachments).toEqual(['armL']); expect(calls.pieces).toBe(1);
    const blast = rig();
    blast.director.consume([dismembered(['head', 'armL', 'legL'], { source: 'explosion', part: null, lethal: true, direction: null })], blast.world);
    expect(blast.calls.pieces).toBe(3); expect(blast.calls.bursts).toBe(1); expect(blast.calls.splats).toBeGreaterThanOrEqual(2);
  });

  it('copies only a few limbs a frame, and still bleeds for the rest', () => {
    const { director, calls, detachments, world } = rig();
    director.consume([dismembered(['head', 'armL', 'armR', 'legL', 'legR'], { source: 'explosion', part: null, lethal: true, direction: null })], world);
    expect(detachments).toHaveLength(3); expect(calls.pieces).toBe(3);
    expect(calls.sprays).toBeGreaterThanOrEqual(5);
  });

  it('leaves a pool where a zombie dies, and copes with a view that is gone', () => {
    const { director, calls, world } = rig();
    director.consume([{ type: 'zombieDied', zombieId: 'e:3', playerId: 'e:1', method: 'head' }, dismembered(['armR'], { zombieId: 'e:9' })], world);
    expect(calls.splats).toBe(1); expect(calls.sprays).toBeGreaterThanOrEqual(1);
    expect(calls.pieces).toBe(0);
  });
});
