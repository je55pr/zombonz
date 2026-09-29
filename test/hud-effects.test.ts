import { afterEach, describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import { Crosshair, NukeFlash, PointsPopups, RoundCounter, nukeFlashOpacity, type HudLayout } from '../src/client/hudEffects.ts';

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

  it('opens the crosshair to the real spread cone and fades it out when hidden', () => {
    const scene = new THREE.Scene(), crosshair = new Crosshair(scene);
    // A 0.05 rad cone at a 70 degree field of view reaches about 32 layout units from the centre.
    expect(Crosshair.gapFor(0.05, 70, layout)).toBeCloseTo(5 + Math.tan(0.05) / Math.tan(35 * Math.PI / 180) * 450);
    expect(Crosshair.gapFor(0.05, 50, layout)).toBeGreaterThan(Crosshair.gapFor(0.05, 70, layout));
    crosshair.update(0.01, 70, layout, 0, true);
    for (let ms = 16; ms < 1000; ms += 16) crosshair.update(0.05, 70, layout, ms, true);
    expect(crosshair.currentGap).toBeCloseTo(Crosshair.gapFor(0.05, 70, layout), 1);
    for (let ms = 1000; ms < 2000; ms += 16) crosshair.update(0.05, 70, layout, ms, false);
    expect(scene.children.every(child => !child.visible)).toBe(true);
  });
});

describe('nuke flash', () => {
  it('holds white, fades smoothly to nothing, and never stays on', () => {
    expect(nukeFlashOpacity(-1)).toBe(0);
    expect(nukeFlashOpacity(0)).toBe(1);
    expect(nukeFlashOpacity(0.1)).toBe(1);
    let last = 1;
    for (let seconds = 0.2; seconds < 1.8; seconds += 0.1) {
      const now = nukeFlashOpacity(seconds);
      expect(now).toBeLessThanOrEqual(last);
      last = now;
    }
    expect(nukeFlashOpacity(0.9)).toBeGreaterThan(0.1);
    expect(nukeFlashOpacity(1.8)).toBe(0);
    expect(nukeFlashOpacity(60)).toBe(0);
  });

  it('draws over the view, hides when done, restarts on a second nuke and hides under overlays', () => {
    const scene = new THREE.Scene(), flash = new NukeFlash(scene);
    const mesh = scene.children[0] as THREE.Mesh, material = mesh.material as THREE.MeshBasicMaterial;
    flash.update(0, true);
    expect(flash.active).toBe(false);
    flash.trigger(1000);
    flash.update(1050, true);
    expect(flash.active).toBe(true);
    expect(material.opacity).toBe(1);
    flash.update(1400, false);
    expect(flash.active).toBe(false);
    flash.update(1900, true);
    expect(material.opacity).toBeGreaterThan(0.5);
    flash.trigger(1900);
    flash.update(1950, true);
    expect(material.opacity).toBe(1);
    flash.update(4000, true);
    expect(flash.active).toBe(false);
    expect(material.opacity).toBe(0);
    // The HUD canvas is drawn at render order 0; the flash goes beneath it.
    expect(mesh.renderOrder).toBeLessThan(0);
  });
});
