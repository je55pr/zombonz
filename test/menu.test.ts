import { describe, expect, it } from 'vitest';
import { INITIAL_DOWNLOAD, createMenuState, menuItems, reduceMenu, setDownload, type DownloadStatus } from '../src/client/menu.ts';
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

const READY: DownloadStatus = { phase: 'ready', loadedBytes: 100, totalBytes: 100, doneFiles: 3, totalFiles: 3, failedFiles: 0 };

describe('start menu', () => {
  it('offers Solo, Multiplayer and Settings, and only Solo starts the game', () => {
    const state = createMenuState({ ...DEFAULT_SETTINGS }, READY);
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
    const state = createMenuState({ ...DEFAULT_SETTINGS }, READY);
    reduceMenu(state, { type: 'up' });
    expect(state.selected).toBe(2);
    reduceMenu(state, { type: 'down' });
    expect(state.selected).toBe(0);
  });

  it('locks Solo and Multiplayer while downloading, leaving Settings usable', () => {
    const state = createMenuState({ ...DEFAULT_SETTINGS });
    expect(menuItems(state).map(item => item.disabled ?? false)).toEqual([true, true, false]);
    expect(state.selected).toBe(2);
    expect(reduceMenu(state, { type: 'activate', index: 0 })).toBeNull();
    expect(state.screen).toBe('main');
    // Keyboard movement and hovering skip the locked rows.
    reduceMenu(state, { type: 'up' });
    expect(state.selected).toBe(2);
    reduceMenu(state, { type: 'hover', index: 1 });
    expect(state.selected).toBe(2);
    setDownload(state, { ...INITIAL_DOWNLOAD, phase: 'assets', loadedBytes: 50, totalBytes: 100, doneFiles: 1, totalFiles: 3 });
    expect(menuItems(state)[0].disabled).toBe(true);
    // Finishing unlocks play and moves the highlight to Solo.
    setDownload(state, READY);
    expect(menuItems(state)[0].disabled).toBe(false);
    expect(state.selected).toBe(0);
    expect(reduceMenu(state, { type: 'activate' })).toEqual({ type: 'startSolo' });
  });

  it('keeps play locked while downloaded files are unpacked', () => {
    const state = createMenuState({ ...DEFAULT_SETTINGS });
    setDownload(state, { ...READY, phase: 'preparing', preparedSteps: 3, totalSteps: 24 });
    expect(menuItems(state).slice(0, 2).every(item => item.disabled)).toBe(true);
    expect(reduceMenu(state, { type: 'activate', index: 0 })).toBeNull();
    setDownload(state, READY);
    expect(menuItems(state)[0].disabled).toBe(false);
  });

  it('still unlocks play when some assets fail, but offers a retry if the game itself fails', () => {
    const partial = createMenuState({ ...DEFAULT_SETTINGS });
    setDownload(partial, { ...READY, failedFiles: 2 });
    expect(menuItems(partial)[0].disabled).toBe(false);
    const failed = createMenuState({ ...DEFAULT_SETTINGS });
    setDownload(failed, { ...INITIAL_DOWNLOAD, phase: 'error' });
    expect(menuItems(failed).map(item => item.id)).toEqual(['solo', 'multiplayer', 'settings', 'retry']);
    expect(reduceMenu(failed, { type: 'activate', index: 3 })).toEqual({ type: 'retryDownload' });
    expect(failed.download.phase).toBe('code');
    expect(menuItems(failed).map(item => item.id)).not.toContain('retry');
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

describe('start-screen downloads', () => {
  function server(files: Record<string, number>, broken: string[] = []) {
    const requests: string[] = [];
    const fetcher = (async (url: string, init?: RequestInit) => {
      requests.push(`${init?.method ?? 'GET'} ${url}`);
      if (broken.includes(url)) return new Response(null, { status: 404 });
      const size = files[url];
      if (init?.method === 'HEAD') return new Response(null, { headers: { 'content-length': String(size) } });
      return new Response(new Uint8Array(size), { headers: { 'content-length': String(size) } });
    }) as unknown as typeof fetch;
    return { fetcher, requests };
  }

  it('fetches every file in full, measuring progress in bytes against HEAD sizes', async () => {
    const { downloadAssets } = await import('../src/client/preload.ts');
    const { fetcher, requests } = server({ '/a.glb': 1000, '/b.webp': 3000, '/c.glb': 6000 });
    const seen: number[] = [];
    const result = await downloadAssets(['/a.glb', '/b.webp', '/c.glb'], p => seen.push(p.loadedBytes / p.totalBytes), fetcher, 2);
    expect(result).toMatchObject({ loadedBytes: 10000, totalBytes: 10000, doneFiles: 3, totalFiles: 3, failed: [] });
    expect(requests.filter(r => r.startsWith('GET'))).toHaveLength(3);
    expect(requests.filter(r => r.startsWith('HEAD'))).toHaveLength(3);
    for (let i = 1; i < seen.length; i++) expect(seen[i]).toBeGreaterThanOrEqual(seen[i - 1]);
    expect(seen.at(-1)).toBe(1);
  });

  it('hands each completed file to the store for the game loaders', async () => {
    const { downloadAssets } = await import('../src/client/preload.ts');
    const { fetcher } = server({ '/a.glb': 1000, '/b.webp': 3000 });
    const stored = new Map<string, number>();
    await downloadAssets(['/a.glb', '/b.webp'], () => {}, fetcher, 2, (url, blob) => stored.set(url, blob.size));
    expect(Object.fromEntries(stored)).toEqual({ '/a.glb': 1000, '/b.webp': 3000 });
    const { storeAsset, takeAsset, getAsset } = await import('../src/client/assetStore.ts');
    storeAsset('/x.glb', new Blob([new Uint8Array(4)]));
    expect(getAsset('/x.glb')?.size).toBe(4);
    expect(takeAsset('/x.glb')?.size).toBe(4);
    expect(takeAsset('/x.glb')).toBeUndefined();
  });

  it('reports failures without stalling, and drops them from the total', async () => {
    const { downloadAssets } = await import('../src/client/preload.ts');
    const { fetcher } = server({ '/a.glb': 1000, '/b.glb': 2000 }, ['/b.glb']);
    const result = await downloadAssets(['/a.glb', '/b.glb'], () => {}, fetcher);
    expect(result.failed).toEqual(['/b.glb']);
    expect(result.doneFiles).toBe(2);
    expect(result.loadedBytes).toBe(1000);
    expect(result.totalBytes).toBe(1000);
  });
});

describe('start-screen asset list', () => {
  it('covers every weapon, prop, zombie file and environment map, and each exists on disk', async () => {
    const { readAssetJson, assetExists } = await import('../scripts/inspect-assets.mjs');
    const manifest = readAssetJson('public/assets/environment/manifest.json');
    const original = globalThis.fetch;
    globalThis.fetch = (async () => new Response(JSON.stringify(manifest))) as unknown as typeof fetch;
    try {
      const { gameAssetUrls } = await import('../src/client/preload.ts');
      const { WEAPON_ASSETS } = await import('../src/client/runtimeAssets.ts');
      const { BUNKER_PROPS } = await import('../src/maps/bunkerProps.ts');
      const urls = await gameAssetUrls();
      expect(new Set(urls).size).toBe(urls.length);
      for (const asset of new Set(Object.values(WEAPON_ASSETS))) expect(urls).toContain(`/assets/weapons/${asset}/model.glb`);
      for (const prop of BUNKER_PROPS) expect(urls).toContain(`/assets/props/${prop.asset}/model.glb`);
      for (const clip of ['model', 'idle', 'walk', 'run', 'attack', 'death']) expect(urls).toContain(`/assets/zombies/peter_d/${clip}.glb`);
      expect(urls.some(url => url.includes('pxltiger'))).toBe(false);
      expect(urls.filter(url => /\.(webp|jpg|png)$/.test(url)).length).toBeGreaterThanOrEqual(9 + 2);
      for (const url of urls) expect(assetExists(`public${url}`), url).toBe(true);
    } finally {
      globalThis.fetch = original;
    }
  });
});
