import { afterEach, describe, expect, it, vi } from 'vitest';
import type * as THREE from 'three';
import { CanvasHud, type HudSnapshot } from '../src/client/hud.ts';

afterEach(() => vi.unstubAllGlobals());

interface Log { clears: number; texts: string[]; rects: number[][] }
interface FakeCanvas { width: number; height: number; getContext: () => unknown; log: Log }

/** Every canvas the HUD makes, each with its own record of what was drawn on it. */
function fakeCanvases(): FakeCanvas[] {
  const made: FakeCanvas[] = [];
  vi.stubGlobal('document', {
    createElement: () => {
      const log: Log = { clears: 0, texts: [], rects: [] };
      const context = new Proxy({} as Record<string | symbol, unknown>, {
        get: (target, key) => {
          if (typeof key !== 'string') return undefined;
          if (key === 'measureText') return () => ({ width: 40 });
          if (key === 'createLinearGradient' || key === 'createRadialGradient') return () => ({ addColorStop: () => {} });
          if (key === 'clearRect') return () => { log.clears += 1; };
          if (key === 'fillText') return (value: unknown) => { log.texts.push(String(value)); };
          if (key === 'roundRect') return (...args: number[]) => { log.rects.push(args); };
          return target[key] ??= () => {};
        },
        set: () => true,
      });
      const canvas = { width: 0, height: 0, getContext: () => context, log };
      made.push(canvas);
      return canvas;
    },
  });
  return made;
}

const renderer = { getDrawingBufferSize: (target: THREE.Vector2) => target.set(1600, 900), clearDepth: () => {}, render: () => {} };

const snapshot = (overrides: Partial<HudSnapshot> = {}): HudSnapshot => ({
  health: 100, maxHealth: 100, perks: '', points: 500, kills: 0, headshots: 0, round: 3, weapon: 'kar98k', magazineAmmo: 5,
  reserveAmmo: 45, holsteredWeapon: 'starter-pistol', reloading: false, grenadeCharges: 2, mineCharges: 0, roundPhase: 'active',
  interactionPrompt: null, lastStand: null, reviveProgress: 0, nearbyPowerup: null, bonusStatus: null, instaKillStatus: null,
  gameOver: false, team: '', pingMs: null, canRestart: true, paused: false, godMode: false, noclip: false, sprinting: false,
  aiming: false, ...overrides,
} as HudSnapshot);

/** A HUD, its main canvas (the first made), and the health bar's (the one that gets the "HP" label). */
function setup() {
  const made = fakeCanvases();
  const hud = new CanvasHud(renderer as unknown as THREE.WebGLRenderer);
  const bar = () => made.find(canvas => canvas.log.texts.includes('HP'))!;
  const layer = () => (hud as unknown as { healthBar: { mesh: THREE.Mesh } }).healthBar.mesh;
  return { hud, main: made[0], bar, layer };
}

/**
 * Health changes on every simulation tick while it refills. The whole HUD is one canvas that is repainted and uploaded to the
 * GPU in full when anything on it changes, which cost several milliseconds a frame in a busy scene, so health is a small layer
 * of its own and a refill leaves the main canvas alone.
 */
describe('the health bar is a layer of its own', () => {
  it('does not repaint the main HUD canvas as health refills, only its own', () => {
    const { hud, main, bar } = setup();
    hud.render(snapshot({ health: 52 }), 0);
    const mainBefore = main.log.clears, barBefore = bar().log.clears;
    let ticks = 0;
    for (let health = 54; health <= 100; health += 2, ticks++) hud.render(snapshot({ health }), 0);
    expect(ticks).toBe(24);
    expect(main.log.clears - mainBefore).toBe(0);
    expect(bar().log.clears - barBefore).toBe(ticks);
    expect(bar().log.texts).toContain('100');
    hud.dispose();
  });

  it('does not repaint anything for a frame where health has not changed', () => {
    const { hud, main, bar } = setup();
    hud.render(snapshot({ health: 80 }), 0);
    const mainBefore = main.log.clears, barBefore = bar().log.clears;
    for (let frame = 0; frame < 10; frame++) hud.render(snapshot({ health: 80 }), frame * 16);
    expect(main.log.clears).toBe(mainBefore);
    expect(bar().log.clears).toBe(barBefore);
    hud.dispose();
  });

  it('repaints the main canvas once when health crosses into the low range, for the red vignette, and once coming out', () => {
    const { hud, main } = setup();
    hud.render(snapshot({ health: 60 }), 0);
    const start = main.log.clears;
    for (const health of [58, 56, 54, 52]) hud.render(snapshot({ health }), 0);
    expect(main.log.clears - start).toBe(0);
    hud.render(snapshot({ health: 50 }), 0);
    expect(main.log.clears - start).toBe(1);
    for (const health of [48, 40, 30, 36, 44, 50]) hud.render(snapshot({ health }), 0);
    expect(main.log.clears - start).toBe(1);
    hud.render(snapshot({ health: 52 }), 0);
    expect(main.log.clears - start).toBe(2);
    hud.dispose();
  });

  it('still repaints the main canvas for what belongs on it', () => {
    const { hud, main } = setup();
    hud.render(snapshot({ points: 500 }), 0);
    const before = main.log.clears;
    hud.render(snapshot({ points: 600 }), 0);
    expect(main.log.clears).toBe(before + 1);
    hud.dispose();
  });

  it('draws the HP label, the number, and a bar as long as the health is', () => {
    const { hud, bar } = setup();
    hud.render(snapshot({ health: 65 }), 0);
    expect(bar().log.texts).toEqual(expect.arrayContaining(['HP', '65']));
    // The track, then the fill: 238 units wide in all.
    expect(bar().log.rects.map(rect => rect[2])).toEqual([238, 238 * 0.65]);
    hud.render(snapshot({ health: 0 }), 0);
    // Nothing left to fill.
    expect(bar().log.rects.slice(-1)[0][2]).toBe(238);
    hud.dispose();
  });

  it('measures the bar against the most health a player can have, which perks raise', () => {
    const { hud, bar } = setup();
    hud.render(snapshot({ health: 125, maxHealth: 250 }), 0);
    expect(bar().log.rects.map(rect => rect[2])).toEqual([238, 119]);
    hud.dispose();
  });

  it('is hidden under the game over screen, and shown otherwise', () => {
    const { hud, layer } = setup();
    hud.render(snapshot(), 0);
    expect(layer().visible).toBe(true);
    hud.render(snapshot({ gameOver: true }), 0);
    expect(layer().visible).toBe(false);
    hud.render(snapshot({ gameOver: false }), 0);
    expect(layer().visible).toBe(true);
    hud.dispose();
  });
});
