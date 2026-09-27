import { afterEach, describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import { PointsPopups, RoundCounter, type HudLayout } from '../src/client/hudEffects.ts';

afterEach(() => vi.unstubAllGlobals());

function stubCanvas(): void {
  vi.stubGlobal('document', { createElement: () => {
    const context = new Proxy({ measureText: () => ({ width: 40 }) } as Record<string | symbol, unknown>,
      { get: (target, key) => target[key] ?? (target[key] = vi.fn()) });
    return { width: 0, height: 0, getContext: () => context };
  } });
}

const layout: HudLayout = { width: 1600, height: 900, scale: 1 };

describe('WaW-style HUD effects', () => {
  it('throws score popups that fly off and expire, capped for automatic fire', () => {
    stubCanvas();
    const scene = new THREE.Scene(), popups = new PointsPopups(scene);
    popups.spawn(10, { x: 1400, y: 720 }, layout, 0);
    popups.spawn(-950, { x: 1400, y: 720 }, layout, 0);
    popups.update(layout, 100, true);
    expect(popups.count).toBe(2);
    expect(scene.children).toHaveLength(2);
    popups.update(layout, 5000, true);
    expect(popups.count).toBe(0);
    expect(scene.children).toHaveLength(0);
    for (let i = 0; i < 60; i++) popups.spawn(10, { x: 1400, y: 720 }, layout, 6000);
    expect(popups.count).toBe(24);
  });

  it('fades a new round in white, settles it red, and flashes when the round is cleared', () => {
    stubCanvas();
    const scene = new THREE.Scene(), counter = new RoundCounter(scene);
    const material = (scene.children[0] as THREE.Mesh).material as THREE.MeshBasicMaterial;
    const red = new THREE.Color(0xd8382b);
    counter.update(1, 'spawning', layout, 0, true);
    expect(material.opacity).toBe(0);
    counter.update(1, 'spawning', layout, 5000, true);
    expect(material.opacity).toBe(1);
    expect(material.color.getHex()).toBe(red.getHex());
    counter.update(1, 'intermission', layout, 6000, true);
    expect(material.color.getHex()).not.toBe(red.getHex());
    counter.update(1, 'intermission', layout, 12000, true);
    expect(material.opacity).toBeCloseTo(0.45);
    counter.update(2, 'spawning', layout, 13000, false);
    expect((scene.children[0] as THREE.Mesh).visible).toBe(false);
  });
});
