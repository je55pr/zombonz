import { describe, expect, it } from 'vitest';
import { INITIAL_DOWNLOAD, bootstrapProgressFraction, createMenuState, menuItems, reduceMenu,
  setDownload, type DownloadStatus } from '../src/client/menu.ts';
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
  it('keeps one progress meter below 100% until preparation is complete', () => {
    expect(bootstrapProgressFraction({ ...READY, phase: 'assets' })).toBe(0.8);
    expect(bootstrapProgressFraction({ ...READY, phase: 'preparing', preparedSteps: 5, totalSteps: 10 })).toBe(0.9);
    expect(bootstrapProgressFraction({ ...READY, phase: 'preparing', preparedSteps: 10, totalSteps: 10 })).toBe(0.99);
    expect(bootstrapProgressFraction(READY)).toBe(1);
  });

  it('offers Solo, Multiplayer and Settings, and Solo starts the game on the chosen map', () => {
    const state = createMenuState({ ...DEFAULT_SETTINGS }, READY);
    expect(menuItems(state).map(item => item.label)).toEqual(['Solo', 'Multiplayer', 'Settings']);
    expect(reduceMenu(state, { type: 'activate', index: 1 })).toBeNull();
    expect(state.screen).toBe('multiplayer');
    expect(menuItems(state).map(item => item.label)).toEqual(['Host Game', 'Join Game', 'Test my connection', 'Back']);
    expect(reduceMenu(state, { type: 'activate', index: 1 })).toEqual({ type: 'joinGame' });
    expect(reduceMenu(state, { type: 'activate', index: 2 })).toEqual({ type: 'testConnection' });
    expect(state.screen).toBe('multiplayer');
    expect(reduceMenu(state, { type: 'activate', index: 0 })).toBeNull();
    expect(state.screen).toBe('hostMaps');
    expect(reduceMenu(state, { type: 'activate', index: 1 })).toEqual({ type: 'hostGame', map: 'asylum' });
    reduceMenu(state, { type: 'back' });
    expect(state.screen).toBe('multiplayer');
    reduceMenu(state, { type: 'back' });
    expect(state.screen).toBe('main');
    expect(reduceMenu(state, { type: 'activate', index: 0 })).toBeNull();
    expect(state.screen).toBe('maps');
    expect(menuItems(state).map(item => item.label)).toEqual(['Bunker', 'Asylum', 'Back']);
    reduceMenu(state, { type: 'back' });
    expect(state.screen).toBe('main');
    reduceMenu(state, { type: 'activate', index: 0 });
    expect(reduceMenu(state, { type: 'activate', index: 1 })).toEqual({ type: 'startSolo', map: 'asylum' });
    expect(state.screen).toBe('loading');
    expect(state.map).toBe('asylum');
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

  it('shows only bootstrap progress until all assets are ready', () => {
    const state = createMenuState({ ...DEFAULT_SETTINGS });
    expect(state.screen).toBe('bootstrap');
    expect(menuItems(state)).toEqual([]);
    expect(reduceMenu(state, { type: 'activate', index: 0 })).toBeNull();
    expect(state.screen).toBe('bootstrap');
    setDownload(state, { ...INITIAL_DOWNLOAD, phase: 'assets', loadedBytes: 50, totalBytes: 100, doneFiles: 1, totalFiles: 3 });
    expect(menuItems(state)).toEqual([]);
    setDownload(state, READY);
    expect(state.screen).toBe('main');
    expect(state.selected).toBe(0);
    reduceMenu(state, { type: 'activate' });
    expect(reduceMenu(state, { type: 'activate' })).toEqual({ type: 'startSolo', map: 'bunker' });
  });

  it('keeps play locked while downloaded files are unpacked', () => {
    const state = createMenuState({ ...DEFAULT_SETTINGS });
    setDownload(state, { ...READY, phase: 'preparing', preparedSteps: 3, totalSteps: 24 });
    expect(menuItems(state)).toEqual([]);
    expect(reduceMenu(state, { type: 'activate', index: 0 })).toBeNull();
    setDownload(state, READY);
    expect(state.screen).toBe('main');
  });

  it('offers retry while bootstrap fails and keeps menus hidden', () => {
    const failed = createMenuState({ ...DEFAULT_SETTINGS });
    setDownload(failed, { ...INITIAL_DOWNLOAD, phase: 'error' });
    expect(menuItems(failed).map(item => item.id)).toEqual(['retry']);
    expect(reduceMenu(failed, { type: 'activate', index: 0 })).toEqual({ type: 'retryDownload' });
    expect(failed.download.phase).toBe('code');
    expect(menuItems(failed).map(item => item.id)).not.toContain('retry');
  });

  it('adjusts settings with left/right and clicks, saving each change', () => {
    const state = createMenuState({ ...DEFAULT_SETTINGS }, READY);
    reduceMenu(state, { type: 'activate', index: 2 });
    expect(menuItems(state).map(item => item.id)).toEqual(['sensitivity', 'fov', 'volume', 'bindings', 'back']);
    reduceMenu(state, { type: 'down' });
    expect(reduceMenu(state, { type: 'right' })).toEqual({ type: 'saveSettings', settings: { ...DEFAULT_SETTINGS, fov: 68 } });
    reduceMenu(state, { type: 'left' }); reduceMenu(state, { type: 'left' });
    expect(state.settings.fov).toBe(66);
    expect(menuItems(state)[1].value).toBe('66°');
    // Clicking a row at its maximum wraps to the minimum.
    state.settings.volume = 1;
    expect(reduceMenu(state, { type: 'activate', index: 2 })).toEqual({ type: 'saveSettings', settings: { ...state.settings, volume: 0 } });
    reduceMenu(state, { type: 'hover', index: 3 });
    expect(reduceMenu(state, { type: 'activate', index: 3 })).toEqual({ type: 'openBindings' });
    reduceMenu(state, { type: 'hover', index: 4 });
    expect(reduceMenu(state, { type: 'left' })).toBeNull(); // 'left' on the Back row changes nothing
    reduceMenu(state, { type: 'activate', index: 4 });
    expect(state.screen).toBe('main');
  });
});

describe('direct start', () => {
  it('holds simulation during loading and resumes it without a second click', () => {
    const surface = new EventTarget() as unknown as HTMLElement;
    const target = new EventTarget() as unknown as Window;
    const page = Object.assign(new EventTarget(), { hidden: false, pointerLockElement: null }) as unknown as Document;
    const pause = new SoloPauseController(surface, target, page, () => {}, true, () => true, true);
    expect(pause.paused).toBe(true);
    pause.resume();
    expect(pause.paused).toBe(false);
    const plain = new SoloPauseController(surface, target, page);
    expect(plain.paused).toBe(false);
    pause.dispose();
    plain.dispose();
  });
});

describe('start-screen downloads', () => {
  it('rejects an invalid build manifest before starting asset downloads', async () => {
    const { loadBootstrapManifest } = await import('../src/client/preload.ts');
    const fetcher = (async () => new Response(JSON.stringify({ version: 1,
      files: { 'assets/broken.glb': { size: 4, sha256: 'wrong' } } }))) as typeof fetch;
    await expect(loadBootstrapManifest(fetcher)).rejects.toThrow('invalid');
  });

  async function manifestFor(files: Record<string, number>) {
    const entries = await Promise.all(Object.entries(files).map(async ([url, size]) => {
      const digest = await crypto.subtle.digest('SHA-256', new Uint8Array(size));
      return [url.slice(1), { size,
        sha256: [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join(''),
      }] as const;
    }));
    const assetFiles = Object.fromEntries(entries);
    const revisionHash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(assetFiles)));
    const revision = [...new Uint8Array(revisionHash)].map(byte => byte.toString(16).padStart(2, '0')).join('');
    return { version: 1 as const, revision, files: assetFiles };
  }

  function cache() {
    const entries = new Map<string, Response>();
    return { entries, match: async (url: string) => entries.get(url)?.clone(),
      put: async (url: string, response: Response) => { entries.set(url, response.clone()); } };
  }

  function server(files: Record<string, number>, broken: string[] = []) {
    const requests: string[] = [];
    const fetcher = (async (url: string, init?: RequestInit) => {
      requests.push(`${init?.method ?? 'GET'} ${url}`);
      const path = url.split('?')[0];
      if (broken.includes(path) || files[path] === undefined) return new Response(null, { status: 404 });
      return new Response(new Uint8Array(files[path]));
    }) as unknown as typeof fetch;
    return { fetcher, requests };
  }

  it('uses exact manifest totals and verifies each download before storing it', async () => {
    const { downloadAssets } = await import('../src/client/preload.ts');
    const files = { '/assets/a.glb': 1000, '/assets/b.webp': 3000, '/assets/c.mp3': 6000 };
    const { fetcher, requests } = server(files);
    const seen: number[] = [];
    const result = await downloadAssets(Object.keys(files), await manifestFor(files),
      p => seen.push(p.loadedBytes / p.totalBytes), fetcher, cache(), 2);
    expect(result).toMatchObject({ loadedBytes: 10000, totalBytes: 10000, doneFiles: 3, totalFiles: 3, cachedFiles: 0, failed: [] });
    expect(requests.filter(r => r.startsWith('GET'))).toHaveLength(3);
    expect(requests.filter(r => r.startsWith('HEAD'))).toHaveLength(0);
    for (let i = 1; i < seen.length; i++) expect(seen[i]).toBeGreaterThanOrEqual(seen[i - 1]);
    expect(seen.at(-1)).toBe(1);
  });

  it('reuses a warm cache without a network request and refreshes only a stale entry', async () => {
    const { downloadAssets } = await import('../src/client/preload.ts');
    const files = { '/assets/a.glb': 1000, '/assets/b.webp': 3000 };
    const { fetcher, requests } = server(files), assetCache = cache(), manifest = await manifestFor(files);
    const stored = new Map<string, number>();
    const store = (url: string, blob: Blob) => stored.set(url, blob.size);
    await downloadAssets(Object.keys(files), manifest, () => {}, fetcher, assetCache, 2, store);
    requests.length = 0;
    const lazy = new Map<string, () => Promise<Blob>>();
    const storeCached = (url: string, load: () => Promise<Blob>) => lazy.set(url, load);
    const warm = await downloadAssets(Object.keys(files), manifest, () => {}, fetcher, assetCache, 2, store, storeCached);
    expect(warm).toMatchObject({ loadedBytes: 4000, totalBytes: 4000, cachedFiles: 2, failed: [] });
    expect(requests).toEqual([]);
    expect(lazy.size).toBe(2);
    expect((await lazy.get('/assets/a.glb')?.())?.size).toBe(1000);
    assetCache.entries.set('/assets/a.glb', new Response(new Uint8Array(1000), { headers: {
      'x-zombonz-sha256': '0'.repeat(64), 'x-zombonz-size': '1000',
    } }));
    const refreshed = await downloadAssets(Object.keys(files), manifest, () => {}, fetcher, assetCache, 2, store, storeCached);
    expect(refreshed.cachedFiles).toBe(1);
    expect(requests).toHaveLength(1);
    expect(Object.fromEntries(stored)).toEqual({ '/assets/a.glb': 1000, '/assets/b.webp': 3000 });
    const { storeAsset, takeAsset, getAsset, storeLazyAsset, takeAssetAsync } = await import('../src/client/assetStore.ts');
    storeAsset('/x.glb', new Blob([new Uint8Array(4)]));
    expect(getAsset('/x.glb')?.size).toBe(4);
    expect(takeAsset('/x.glb')?.size).toBe(4);
    expect(takeAsset('/x.glb')).toBeUndefined();
    let reads = 0;
    storeLazyAsset('/lazy.glb', async () => { reads++; return new Blob([new Uint8Array(7)]); });
    expect(reads).toBe(0);
    expect((await takeAssetAsync('/lazy.glb'))?.size).toBe(7);
    expect(reads).toBe(1);
  });

  it('invalidates the preparation record when the asset revision changes', async () => {
    const { markPrepared, wasPrepared } = await import('../src/client/preload.ts');
    const first = await manifestFor({ '/assets/a.glb': 1 });
    const second = await manifestFor({ '/assets/a.glb': 2 });
    const values = new Map<string, string>();
    const storage = { getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => { values.set(key, value); } };
    expect(wasPrepared(first, storage)).toBe(false);
    markPrepared(first, storage);
    expect(wasPrepared(first, storage)).toBe(true);
    expect(wasPrepared(second, storage)).toBe(false);
  });

  it('reports failed required files without claiming the bootstrap is complete', async () => {
    const { downloadAssets } = await import('../src/client/preload.ts');
    const files = { '/assets/a.glb': 1000, '/assets/b.glb': 2000 };
    const { fetcher } = server(files, ['/assets/b.glb']);
    const result = await downloadAssets(Object.keys(files), await manifestFor(files), () => {}, fetcher);
    expect(result.failed).toEqual(['/assets/b.glb']);
    expect(result.doneFiles).toBe(2);
    expect(result.loadedBytes).toBe(1000);
    expect(result.totalBytes).toBe(3000);
  });
});

describe('start-screen asset list', () => {
  it('covers every weapon, prop, zombie file, environment map and sound, and each exists on disk', async () => {
    const { readAssetJson, assetExists } = await import('../scripts/inspect-assets.mjs');
    const manifest = readAssetJson('public/assets/environment/manifest.json');
    const bootstrap = readAssetJson('public/assets/bootstrap-manifest.json') as {
      files: Record<string, { size: number; sha256: string }>;
    };
    const original = globalThis.fetch;
    globalThis.fetch = (async () => new Response(JSON.stringify(manifest))) as unknown as typeof fetch;
    try {
      const { gameAssetUrls } = await import('../src/client/preload.ts');
      const { WEAPON_ASSETS } = await import('../src/client/runtimeAssets.ts');
      const { BUNKER_PROPS } = await import('../src/maps/bunkerProps.ts');
      const { AUDIO_CLIPS } = await import('../src/client/audioClips.ts');
      const urls = await gameAssetUrls();
      expect(new Set(urls).size).toBe(urls.length);
      expect(urls).toContain('/assets/weapons/knife/model.glb');
      expect(urls).toContain('/assets/audio/knife.mp3');
      expect(urls).toContain('/assets/audio/flesh-hit.mp3');
      for (const asset of new Set(Object.values(WEAPON_ASSETS))) expect(urls).toContain(`/assets/weapons/${asset}/model.glb`);
      for (const prop of BUNKER_PROPS) expect(urls).toContain(`/assets/props/${prop.asset}/model.glb`);
      for (const clip of ['model', 'idle', 'walk', 'run', 'attack', 'death']) expect(urls).toContain(`/assets/zombies/peter_d/${clip}.glb`);
      for (const clip of AUDIO_CLIPS) expect(urls).toContain(`/assets/audio/${clip}.mp3`);
      // Every look's model, since a match draws zombies of each.
      for (const clip of ['model', 'idle', 'walk', 'run', 'attack']) expect(urls).toContain(`/assets/zombies/pxltiger/${clip}.glb`);
      expect(urls.filter(url => /\.(webp|jpg|png)$/.test(url)).length).toBeGreaterThanOrEqual(9 + 2);
      for (const url of urls) {
        expect(assetExists(`public${url}`), url).toBe(true);
        expect(bootstrap.files[url.slice(1)]?.size, `${url} missing from bootstrap manifest`).toBeGreaterThan(0);
        expect(bootstrap.files[url.slice(1)]?.sha256).toMatch(/^[a-f0-9]{64}$/);
      }
    } finally {
      globalThis.fetch = original;
    }
  });
});
