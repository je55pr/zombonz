import { afterEach, describe, expect, it, vi } from 'vitest';
import type * as THREE from 'three';
import { CanvasHud, type HudSnapshot } from '../src/client/hud.ts';

afterEach(() => vi.unstubAllGlobals());

type Call = { name: string; args: unknown[] };

/** A canvas whose 2D context writes down every call made to it, with text 40 units wide. */
function recordingCanvas(): { calls: Call[]; texts: () => string[] } {
  const calls: Call[] = [];
  const context = new Proxy({} as Record<string | symbol, unknown>, {
    get: (target, key) => {
      if (typeof key !== 'string') return undefined;
      if (key === 'measureText') return () => ({ width: 40 });
      if (key === 'createLinearGradient' || key === 'createRadialGradient') return () => ({ addColorStop: () => {} });
      return target[key] ??= (...args: unknown[]) => { calls.push({ name: key, args }); };
    },
    set: () => true,
  });
  vi.stubGlobal('document', { createElement: () => ({ width: 0, height: 0, getContext: () => context }) });
  return { calls, texts: () => calls.filter(call => call.name === 'fillText').map(call => String(call.args[0])) };
}

const renderer = { getDrawingBufferSize: (target: THREE.Vector2) => target.set(1600, 900), clearDepth: () => {}, render: () => {} };

const snapshot = (overrides: Partial<HudSnapshot> = {}): HudSnapshot => ({
  health: 100, maxHealth: 100, perks: '', points: 500, kills: 0, headshots: 0, round: 3, weapon: 'kar98k', magazineAmmo: 5,
  reserveAmmo: 45, holsteredWeapon: 'starter-pistol', reloading: false, grenadeCharges: 2, mineCharges: 0, roundPhase: 'active',
  interactionPrompt: null, lastStand: null, reviveProgress: 0, nearbyPowerup: null, bonusStatus: null, instaKillStatus: null,
  gameOver: false, team: '', pingMs: null, canRestart: true, paused: false, godMode: false, noclip: false, sprinting: false,
  aiming: false, ...overrides,
} as HudSnapshot);

function draw(overrides: Partial<HudSnapshot> = {}): { calls: Call[]; texts: string[] } {
  const canvas = recordingCanvas();
  const hud = new CanvasHud(renderer as unknown as THREE.WebGLRenderer);
  hud.render(snapshot(overrides), 0);
  hud.dispose();
  return { calls: canvas.calls, texts: canvas.texts() };
}

describe('the gameplay HUD shows state, not controls', () => {
  it('has no always-on controls strip at the top', () => {
    const { texts } = draw();
    expect(texts.filter(text => /WASD|SPRINT|RMB|KNIFE|RELOAD|SWITCH|MUTE|WHEEL/.test(text))).toEqual([]);
    // The map and the credits key stay.
    expect(texts).toContain('BUNKER');
    expect(texts.some(text => text.includes('CREDITS'))).toBe(true);
  });

  it('shows no key hint for grenades, mines or switching weapons', () => {
    const { texts } = draw({ grenadeCharges: 2, mineCharges: 2, holsteredWeapon: 'starter-pistol' });
    // T, G and Q are the default keys for those; a hint would be drawn as a keycap holding one of them.
    for (const key of ['T', 'G', 'Q']) expect(texts, key).not.toContain(key);
    // The holstered gun's name is state, so it stays.
    expect(texts.some(text => text.length > 4 && /PISTOL|1911/i.test(text))).toBe(true);
  });

  it('still shows a key hint when there is something to press it for: E at a buy point', () => {
    expect(draw({ interactionPrompt: 'E  Buy the Kar98k [200]' }).texts).toContain('E');
  });

  /** Where each grenade or mine icon is drawn: the centres they are translated to. */
  const icons = (calls: Call[]) => {
    const points: Array<{ x: number; y: number }> = [];
    calls.forEach((call, index) => { if (call.name === 'translate' && calls[index - 1]?.name === 'save') points.push({ x: call.args[0] as number, y: call.args[1] as number }); });
    return points;
  };

  it('draws the grenades on the right, level with the ammunition and clear of it', () => {
    const { calls } = draw({ grenadeCharges: 2 });
    const spots = icons(calls);
    // Four slots (two held, two spent).
    expect(spots).toHaveLength(4);
    // All on the right half of a 1600-wide screen, on the ammunition's row, and in a row rather than stacked.
    for (const spot of spots) { expect(spot.x).toBeGreaterThan(800); expect(spot.y).toBeGreaterThan(800); expect(spot.y).toBeLessThan(870); }
    expect(new Set(spots.map(spot => spot.y)).size).toBe(1);
    // Nothing is drawn over the ammunition: the count is right-aligned to x = 1556, 80 units wide here (both numbers 40).
    const ammoLeft = 1556 - 80;
    expect(Math.max(...spots.map(spot => spot.x)) + 12).toBeLessThan(ammoLeft);
    // Neighbours are spaced apart, not overlapping (each icon is about 20 wide).
    const xs = spots.map(spot => spot.x).sort((a, b) => a - b);
    xs.forEach((x, index) => { if (index > 0) expect(x - xs[index - 1]).toBeGreaterThanOrEqual(24); });
  });

  it('puts nothing where the grenades used to be, beside the health bar', () => {
    const { calls } = draw({ grenadeCharges: 4, mineCharges: 2 });
    expect(icons(calls).every(spot => spot.x > 800)).toBe(true);
  });

  it('adds the mines to the same row, beyond the grenades, while any are carried', () => {
    const grenades = icons(draw({ mineCharges: 0 }).calls);
    const both = icons(draw({ mineCharges: 1 }).calls);
    expect(grenades).toHaveLength(4);
    expect(both).toHaveLength(6);
    // Same row, all on the right, none on top of another.
    expect(new Set(both.map(spot => spot.y)).size).toBe(1);
    expect(both.every(spot => spot.x > 800)).toBe(true);
    const xs = both.map(spot => spot.x).sort((a, b) => a - b);
    xs.forEach((x, index) => { if (index > 0) expect(x - xs[index - 1]).toBeGreaterThanOrEqual(24); });
    // The grenades stay where they were, next to the ammunition; the mines are added beyond them, to their left.
    expect(both.slice(2)).toEqual(grenades);
    expect(Math.max(...both.slice(0, 2).map(spot => spot.x))).toBeLessThan(Math.min(...grenades.map(spot => spot.x)));
  });

  it('shows how many are left: held ones filled, spent ones outlined', () => {
    const { calls } = draw({ grenadeCharges: 3 });
    const fills = calls.filter(call => call.name === 'ellipse').length;
    expect(fills).toBe(4);
    // For each grenade's body (an ellipse), the next paint call is a fill if it is held and a stroke if it is spent.
    const paints = calls.map((call, index) => ({ call, index })).filter(({ call }) => call.name === 'ellipse')
      .map(({ index }) => calls.slice(index + 1).find(call => call.name === 'fill' || call.name === 'stroke')!.name);
    expect(paints).toEqual(['fill', 'fill', 'fill', 'stroke']);
  });
});
