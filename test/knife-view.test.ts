import { describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import { readAssetGeometry } from '../scripts/inspect-assets.mjs';
import { MELEE_RULES, createPlayerState, type SimulationEvent } from '../src/core/index.ts';
import {
  KNIFE_LENGTH, KNIFE_STRIKE_SECONDS, KNIFE_SWING_SECONDS, WeaponView, knifeSwing, prepareWeapon,
} from '../src/client/weaponView.ts';

const swung = (playerId: `e:${number}` = 'e:1'): SimulationEvent[] => [{ type: 'meleeSwung', playerId }];
const TICK = 1 / 60;
const seconds = (from: number, to: number, step = TICK / 4) => Array.from({ length: Math.floor((to - from) / step) + 1 }, (_, i) => from + i * step);

describe('the knife swing animation', () => {
  it('is over in the same time as the core\'s cooldown, and its strike is the core\'s strike tick', () => {
    expect(KNIFE_SWING_SECONDS * 60).toBe(MELEE_RULES.cooldownTicks);
    expect(KNIFE_STRIKE_SECONDS * 60).toBe(MELEE_RULES.strikeTicks);
  });

  it('shows nothing before the swing or after it', () => {
    expect(knifeSwing(-0.01)).toEqual({ dip: 0, knife: null });
    expect(knifeSwing(KNIFE_SWING_SECONDS)).toEqual({ dip: 0, knife: null });
    expect(knifeSwing(KNIFE_SWING_SECONDS + 5)).toEqual({ dip: 0, knife: null });
    expect(knifeSwing(0).dip).toBe(0);
  });

  it('has the knife at full stretch, furthest in front of the player, on the tick the core lands the blow', () => {
    let furthest = { t: 0, z: 0 };
    for (const t of seconds(0, 0.5)) {
      const knife = knifeSwing(t).knife;
      if (knife && knife.z < furthest.z) furthest = { t, z: knife.z };
    }
    expect(Math.abs(furthest.t - KNIFE_STRIKE_SECONDS)).toBeLessThanOrEqual(TICK);
    // And it is moving faster into the strike than out of it: the blade gathers speed.
    const speed = (t: number) => { const a = knifeSwing(t - 0.01).knife!, b = knifeSwing(t + 0.01).knife!; return Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z); };
    expect(speed(KNIFE_STRIKE_SECONDS - 0.03)).toBeGreaterThan(speed(KNIFE_STRIKE_SECONDS + 0.12));
  });

  it('has the gun out of the way for the strike and back before the swing is over', () => {
    expect(knifeSwing(KNIFE_STRIKE_SECONDS).dip).toBeGreaterThan(0.95);
    expect(knifeSwing(KNIFE_SWING_SECONDS - 0.02).dip).toBeLessThan(0.05);
    // The knife is gone from view before the gun is back, so the two are never on screen together for long.
    const lastKnife = seconds(0, KNIFE_SWING_SECONDS).filter(t => knifeSwing(t).knife).pop()!;
    expect(knifeSwing(lastKnife).dip).toBeGreaterThan(0.2);
  });

  it('moves smoothly: no tick jumps the knife more than a hand could', () => {
    let previous = knifeSwing(0).knife!;
    for (let tick = 1; tick <= MELEE_RULES.cooldownTicks; tick++) {
      const now = knifeSwing(tick * TICK).knife;
      if (!now) break;
      expect(Math.hypot(now.x - previous.x, now.y - previous.y, now.z - previous.z), `tick ${tick}`).toBeLessThan(0.1);
      expect(Math.abs(now.ry - previous.ry) + Math.abs(now.rx - previous.rx) + Math.abs(now.rz - previous.rz), `tick ${tick}`).toBeLessThan(1.5);
      previous = now;
    }
  });

  it('keeps the knife in frame from the strike through the follow-through, at any window shape', () => {
    for (const aspect of [4 / 3, 16 / 9, 21 / 9]) {
      const vertical = Math.tan(52 * Math.PI / 360);
      for (const t of seconds(KNIFE_STRIKE_SECONDS, KNIFE_STRIKE_SECONDS + 0.15)) {
        const knife = knifeSwing(t).knife!;
        expect(Math.abs(knife.x) / -knife.z, `x at ${t}`).toBeLessThan(vertical * aspect);
        expect(Math.abs(knife.y) / -knife.z, `y at ${t}`).toBeLessThan(vertical);
      }
    }
  });
});

describe('the knife in the first-person view', () => {
  const setup = () => {
    const view = new WeaponView(), player = createPlayerState('e:1', { x: 0, y: 0, z: 0 });
    const renderer = { clearDepth: vi.fn(), render: vi.fn() };
    view.update(player, 0); view.render(renderer as unknown as THREE.WebGLRenderer, 16 / 9);
    const scene = renderer.render.mock.calls[0][0] as THREE.Scene;
    const knives: THREE.Object3D[] = [];
    scene.traverse(object => { if (object.name === 'held-knife') knives.push(object); });
    return { view, player, scene, knife: knives[0], knives, pose: scene.getObjectByName('weapon-pose')! };
  };

  it('has exactly one knife in the scene, hidden until a swing', () => {
    const { knives, knife } = setup();
    expect(knives).toHaveLength(1);
    expect(knife.visible).toBe(false);
  });

  it('draws the knife from the swing to its end, lowers the gun meanwhile, and puts everything back', () => {
    const { view, player, knife, pose } = setup();
    for (let tick = 0; tick < 30; tick++) view.update(player, tick, TICK);
    const restY = pose.position.y;
    view.events(swung(), 'e:1', 100);
    const visibleTicks: number[] = [];
    let lowestGun = restY;
    for (let tick = 100; tick <= 100 + MELEE_RULES.cooldownTicks + 10; tick++) {
      view.update(player, tick, TICK);
      if (knife.visible) visibleTicks.push(tick - 100);
      lowestGun = Math.min(lowestGun, pose.position.y);
    }
    expect(visibleTicks[0]).toBe(0);
    expect(visibleTicks.at(-1)!).toBeLessThan(MELEE_RULES.cooldownTicks);
    expect(visibleTicks).toContain(MELEE_RULES.strikeTicks);
    expect(lowestGun).toBeLessThan(restY - 0.25);
    expect(knife.visible).toBe(false);
    expect(pose.position.y).toBeCloseTo(restY, 3);
  });

  it('ignores another player\'s swing, and a match restart clears one in progress', () => {
    const { view, player, knife } = setup();
    view.events(swung('e:2'), 'e:1', 10);
    view.update(player, 12, TICK);
    expect(knife.visible).toBe(false);
    view.events(swung(), 'e:1', 20);
    view.update(player, 22, TICK);
    expect(knife.visible).toBe(true);
    view.events([{ type: 'matchRestarted', previousSeed: 1, seed: 2 }], 'e:1', 23);
    view.update(player, 24, TICK);
    expect(knife.visible).toBe(false);
  });

  it('never leaves a second knife or a stuck one behind when swings come thick and fast', () => {
    const { view, player, scene, knife } = setup();
    for (let tick = 0; tick < 300; tick++) {
      if (tick % 7 === 0) view.events(swung(), 'e:1', tick);
      view.update(player, tick, TICK);
    }
    const knives: THREE.Object3D[] = [];
    scene.traverse(object => { if (object.name === 'held-knife') knives.push(object); });
    expect(knives).toHaveLength(1);
    for (let tick = 300; tick < 400; tick++) view.update(player, tick, TICK);
    expect(knife.visible).toBe(false);
  });

  it('is not drawn for a player who is downed or dead', () => {
    const { view, player, knife } = setup();
    view.events(swung(), 'e:1', 10);
    view.update(player, 14, TICK);
    expect(knife.visible).toBe(true);
    player.alive = false;
    view.update(player, 15, TICK);
    expect(knife.visible).toBe(false);
    player.alive = true; player.downed = { ticks: 100 } as never;
    view.update(player, 16, TICK);
    expect(knife.visible).toBe(false);
  });

  it('takes the hand from a grenade toss and pulls the view out of aiming quickly', () => {
    const { view, player, pose } = setup();
    player.aiming = true;
    for (let tick = 0; tick < 60; tick++) view.update(player, tick, TICK);
    const aimedX = pose.position.x;
    view.events(swung(), 'e:1', 60);
    // The core drops aiming as the swing starts; the view follows it out within a few ticks.
    player.aiming = false;
    for (let tick = 60; tick < 66; tick++) view.update(player, tick, TICK);
    expect(pose.position.x).toBeGreaterThan(aimedX + 0.05);
  });
});

describe('the knife model', () => {
  it('is a 32 cm Ka-Bar with its tip toward the muzzle direction, and cheap to draw', async () => {
    const source = await readAssetGeometry('public/assets/weapons/knife/model.glb');
    const knife = prepareWeapon(source.scene, 'knife');
    const box = new THREE.Box3().setFromObject(knife.root), size = box.getSize(new THREE.Vector3());
    expect(size.z).toBeCloseTo(KNIFE_LENGTH, 3);
    expect(box.max.z).toBeCloseTo(0, 3);
    // Blade at the front (-z), thin; handle and pommel at the back, thick.
    const spread = (from: number, to: number) => {
      const slice = new THREE.Box3(); const p = new THREE.Vector3();
      knife.root.traverse(object => {
        if (!(object instanceof THREE.Mesh)) return;
        const position = object.geometry.getAttribute('position');
        for (let i = 0; i < position.count; i++) { p.fromBufferAttribute(position, i); if (p.z >= from && p.z <= to) slice.expandByPoint(p); }
      });
      return slice.getSize(new THREE.Vector3());
    };
    expect(spread(box.min.z, box.min.z + 0.03).x).toBeLessThan(0.008);
    expect(spread(-0.045, 0).x).toBeGreaterThan(0.025);
    let meshes = 0, triangles = 0;
    knife.root.traverse(object => {
      if (!(object instanceof THREE.Mesh)) return;
      meshes++; triangles += (object.geometry.index ? object.geometry.index.count : object.geometry.getAttribute('position').count) / 3;
    });
    expect(meshes).toBeLessThanOrEqual(2);
    expect(triangles).toBeLessThan(3000);
  });
});
