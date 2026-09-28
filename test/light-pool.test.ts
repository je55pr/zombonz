import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { LightPool, LightSource } from '../src/client/lightPool.ts';

/** A camera at the origin looking down -z, and a pool of four with lamps every 5 m ahead of it. */
function setup() {
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(70, 16 / 9, 0.05, 80);
  const pool = new LightPool(scene, 4);
  const lamps = Array.from({ length: 10 }, (_, i) => {
    const lamp = pool.add(new LightSource(0xffc38b, 11, 4, 1.6));
    lamp.position.set(0, 3, -(i + 1) * 5); scene.add(lamp);
    return lamp;
  });
  return { scene, camera, pool, lamps };
}
const pointLights = (scene: THREE.Scene) => scene.children.filter(child => child instanceof THREE.PointLight) as THREE.PointLight[];

describe('light pool', () => {
  it('draws the nearest sources with a fixed number of real lights', () => {
    const { scene, camera, pool, lamps } = setup();
    pool.update(camera, 0);
    expect(pointLights(scene)).toHaveLength(4);
    expect(new Set(pool.shining())).toEqual(new Set(lamps.slice(0, 4)));
    // Each real light takes on its source's place and settings.
    const lit = pointLights(scene).find(light => light.position.z === -5)!;
    expect(lit.intensity).toBe(11); expect(lit.distance).toBe(4); expect(lit.decay).toBe(1.6);
  });

  it('skips sources that are off or hidden', () => {
    const { scene, camera, pool, lamps } = setup();
    lamps[0].intensity = 0;
    const box = new THREE.Group(); box.visible = false; scene.add(box); box.add(lamps[1]);
    pool.update(camera, 0);
    expect(new Set(pool.shining())).toEqual(new Set(lamps.slice(2, 6)));
  });

  it('prefers lights whose reach is on screen', () => {
    const { scene, camera, pool, lamps } = setup();
    const behind = pool.add(new LightSource(0xffffff, 5, 4, 2)); behind.position.set(0, 3, 16); scene.add(behind);
    const ahead = lamps.slice(0, 4);
    pool.update(camera, 0);
    expect(new Set(pool.shining())).toEqual(new Set(ahead));
    // Turned round, the lamp behind is on screen and near enough to take a slot.
    camera.rotation.y = Math.PI;
    for (let frame = 0; frame < 60; frame++) pool.update(camera, 1 / 60);
    expect(pool.shining()).toContain(behind);
  });

  it('fades a light out before another takes its slot, and back in', () => {
    const { scene, camera, pool, lamps } = setup();
    pool.update(camera, 0);
    // Walking 30 m down the row brings the far lamps nearest.
    camera.position.z = -30;
    pool.update(camera, 0.1);
    // Nothing new shines yet: every slot is still fading out its old lamp.
    expect(pool.shining().every(lamp => lamps.indexOf(lamp) < 4)).toBe(true);
    const dimming = pointLights(scene).find(light => light.intensity > 0)!;
    expect(dimming.intensity).toBeLessThan(11);
    for (let frame = 0; frame < 60; frame++) pool.update(camera, 1 / 60);
    expect(new Set(pool.shining())).toEqual(new Set([lamps[4], lamps[5], lamps[6], lamps[7]]));
    expect(pointLights(scene).every(light => light.intensity === 11)).toBe(true);
  });

  it('keeps its lights while the camera shuffles about', () => {
    // One real light between two lamps: halfway between them, the nearer one changes at every step.
    const scene = new THREE.Scene(), camera = new THREE.PerspectiveCamera(70, 16 / 9, 0.05, 80);
    const pool = new LightPool(scene, 1);
    const [left, right] = [-5, 5].map(x => {
      const lamp = pool.add(new LightSource(0xffffff, 5, 4, 2)); lamp.position.set(x, 3, -3); scene.add(lamp);
      return lamp;
    });
    camera.position.x = 0.5; pool.update(camera, 0);
    expect(pool.shining()).toEqual([right]);
    for (let frame = 0; frame < 400; frame++) {
      camera.position.x = Math.cos(frame / 40) * 0.5; // about two seconds on each side
      pool.update(camera, 1 / 60);
      expect(pool.shining()).toEqual([right]);
    }
    // Well over to the left, the left lamp takes over.
    camera.position.x = -4;
    for (let frame = 0; frame < 60; frame++) pool.update(camera, 1 / 60);
    expect(pool.shining()).toEqual([left]);
  });

  it('follows a source that moves with its parent', () => {
    const { scene, camera, pool } = setup();
    const chest = new THREE.Group(); scene.add(chest);
    const glow = pool.add(new LightSource(0xffbf57, 20, 6, 2)); glow.position.set(0, 1.3, 0); chest.add(glow);
    chest.position.set(1, 0, -2);
    pool.update(camera, 0);
    const light = pointLights(scene).find(item => item.intensity === 20)!;
    [1, 1.3, -2].forEach((value, axis) => expect(light.position.getComponent(axis)).toBeCloseTo(value));
  });
});
