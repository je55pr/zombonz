import { describe, expect, it } from 'vitest';
import { createMenuState, menuItems, reduceMenu } from '../src/client/menu.ts';
import {
  DEFAULT_SETTINGS, adjustSetting, loadSettings, normalizeSettings, saveSettings, SETTING_LIMITS,
} from '../src/client/settings.ts';
import { SoloPauseController } from '../src/client/pause.ts';

describe('settings', () => {
  it('clamps, snaps and repairs stored values', () => {
    expect(normalizeSettings({ sensitivity: 99, fov: 10, volume: 0.33 })).toEqual({ sensitivity: 3, fov: 55, volume: 0.3 });
    expect(normalizeSettings({ sensitivity: 'fast', fov: Number.NaN })).toEqual(DEFAULT_SETTINGS);
    expect(normalizeSettings(null)).toEqual(DEFAULT_SETTINGS);
  });

  it('steps without floating-point drift and stops at the limits', () => {
    let settings = { ...DEFAULT_SETTINGS, volume: 0 };
    for (let i = 0; i < 3; i++) settings = adjustSetting(settings, 'volume', 1);
    expect(settings.volume).toBe(0.3);
    for (let i = 0; i < 20; i++) settings = adjustSetting(settings, 'volume', 1);
    expect(settings.volume).toBe(SETTING_LIMITS.volume.max);
  });

  it('round-trips through storage and survives storage that throws or is missing', () => {
    const store = new Map<string, string>();
    const storage = { getItem: (key: string) => store.get(key) ?? null, setItem: (key: string, value: string) => { store.set(key, value); } };
    saveSettings({ sensitivity: 1.5, fov: 80, volume: 0.5 }, storage);
    expect(loadSettings(storage)).toEqual({ sensitivity: 1.5, fov: 80, volume: 0.5 });
    const broken = { getItem: () => { throw new Error('blocked'); }, setItem: () => { throw new Error('blocked'); } };
    expect(loadSettings(broken)).toEqual(DEFAULT_SETTINGS);
    expect(() => saveSettings(DEFAULT_SETTINGS, broken)).not.toThrow();
    expect(loadSettings(undefined)).toEqual(DEFAULT_SETTINGS);
    expect(loadSettings({ getItem: () => '{not json' })).toEqual(DEFAULT_SETTINGS);
  });
});

describe('start menu', () => {
  it('offers Solo, Multiplayer and Settings, and only Solo starts the game', () => {
    const state = createMenuState({ ...DEFAULT_SETTINGS });
    expect(menuItems(state).map(item => item.label)).toEqual(['Solo', 'Multiplayer', 'Settings']);
    expect(reduceMenu(state, { type: 'activate', index: 1 })).toBeNull();
    expect(state.screen).toBe('multiplayer');
    reduceMenu(state, { type: 'back' });
    expect(state.screen).toBe('main');
    expect(reduceMenu(state, { type: 'activate', index: 0 })).toEqual({ type: 'startSolo' });
    expect(state.screen).toBe('loading');
    // Once loading, input is ignored so the game cannot be started twice.
    expect(reduceMenu(state, { type: 'activate' })).toBeNull();
  });

  it('wraps keyboard selection', () => {
    const state = createMenuState({ ...DEFAULT_SETTINGS });
    reduceMenu(state, { type: 'up' });
    expect(state.selected).toBe(2);
    reduceMenu(state, { type: 'down' });
    expect(state.selected).toBe(0);
  });

  it('adjusts settings with left/right and clicks, saving each change', () => {
    const state = createMenuState({ ...DEFAULT_SETTINGS });
    reduceMenu(state, { type: 'activate', index: 2 });
    expect(menuItems(state).map(item => item.id)).toEqual(['sensitivity', 'fov', 'volume', 'back']);
    reduceMenu(state, { type: 'down' });
    expect(reduceMenu(state, { type: 'right' })).toEqual({ type: 'saveSettings', settings: { ...DEFAULT_SETTINGS, fov: 68 } });
    reduceMenu(state, { type: 'left' }); reduceMenu(state, { type: 'left' });
    expect(state.settings.fov).toBe(66);
    expect(menuItems(state)[1].value).toBe('66°');
    // Clicking a row at its maximum wraps to the minimum.
    state.settings.volume = 1;
    expect(reduceMenu(state, { type: 'activate', index: 2 })).toEqual({ type: 'saveSettings', settings: { ...state.settings, volume: 0 } });
    reduceMenu(state, { type: 'hover', index: 3 });
    expect(reduceMenu(state, { type: 'left' })).toBeNull(); // 'left' on the Back row changes nothing
    reduceMenu(state, { type: 'activate', index: 3 });
    expect(state.screen).toBe('main');
  });
});

describe('click to start', () => {
  it('starts paused until the first click, then behaves like a normal pause', () => {
    const surface = new EventTarget() as unknown as HTMLElement;
    const target = new EventTarget() as unknown as Window;
    const page = Object.assign(new EventTarget(), { hidden: false, pointerLockElement: null }) as unknown as Document;
    const pause = new SoloPauseController(surface, target, page, () => {}, true, () => true, true);
    expect(pause.paused).toBe(true);
    expect(pause.started).toBe(false);
    surface.dispatchEvent(new Event('pointerdown'));
    expect(pause.paused).toBe(false);
    expect(pause.started).toBe(true);
    const plain = new SoloPauseController(surface, target, page);
    expect(plain.paused).toBe(false);
    expect(plain.started).toBe(true);
  });
});
