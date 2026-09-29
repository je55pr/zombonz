import { MAPS } from '../maps/index.ts';
import { assetUrl, MATERIAL_IDS, readEnvironmentManifest } from './environmentMaterials.ts';
import { TREELINE_ASSETS } from './treeline.ts';
import { VENDING_MODEL, VENDING_PAINTS } from './mapDetails.ts';
import { TEAMMATE_MODEL } from './playerView.ts';
import { WEAPON_ASSETS, ZOMBIE_ASSET_IDS, zombieAssetPaths } from './runtimeAssets.ts';
import { storeAsset, storeLazyAsset } from './assetStore.ts';
import { AUDIO_CLIPS } from './audioClips.ts';

/** Every file the solo game fetches, for every map: environment maps, props, the zombie rig, all weapon models and every sound. */
export async function gameAssetUrls(): Promise<string[]> {
  const manifest = await readEnvironmentManifest();
  const paths = ['/assets/environment/manifest.json'];
  for (const id of MATERIAL_IDS) {
    const item = manifest.materials[id];
    paths.push(item.basecolor, item.normal, item.arm);
  }
  for (const id of new Set(Object.values(MAPS).flatMap(map => map.decals.map(decal => decal.asset)))) {
    const maps = manifest.decals[id].maps;
    paths.push(maps.basecolor, maps.opacity);
  }
  for (const asset of new Set([...Object.values(MAPS).flatMap(map => map.props.map(prop => prop.asset)), ...TREELINE_ASSETS])) {
    paths.push(`/assets/props/${asset}/model.glb`);
  }
  if (manifest.sky) paths.push(manifest.sky.image);
  if (Object.values(MAPS).some(map => map.perkMachines?.length)) paths.push(`/assets/${VENDING_MODEL}`, ...Object.values(VENDING_PAINTS));
  paths.push(`/assets/${TEAMMATE_MODEL}`);
  for (const zombie of ZOMBIE_ASSET_IDS) paths.push(...zombieAssetPaths(zombie).map(path => `/assets/${path}`));
  for (const asset of new Set(Object.values(WEAPON_ASSETS))) paths.push(`/assets/weapons/${asset}/model.glb`);
  paths.push('/assets/weapons/knife/model.glb');
  for (const clip of AUDIO_CLIPS) paths.push(`/assets/audio/${clip}.mp3`);
  return [...new Set(paths.map(assetUrl))];
}

export interface DownloadProgress {
  /** Bytes made available to the game, whether from the persistent cache or the network. */
  loadedBytes: number;
  /** Exact sum from the generated manifest, including audio and large models. */
  totalBytes: number;
  doneFiles: number;
  totalFiles: number;
  cachedFiles: number;
  failed: string[];
}

export interface BootstrapManifest {
  version: 1;
  revision: string;
  files: Record<string, { size: number; sha256: string }>;
}

/** Only these methods are needed, which also makes cache behavior easy to exercise in tests. */
export interface AssetCache {
  match(url: string): Promise<Response | undefined>;
  put(url: string, response: Response): Promise<void>;
}

export const ASSET_CACHE_NAME = 'zombonz-assets-v1';
const PREPARATION_KEY = 'zombonz.prepared.v1';
/** Bump when the page-wide preparation format or algorithm changes. */
const PREPARATION_VERSION = 1;

export function wasPrepared(manifest: BootstrapManifest, storage?: Pick<Storage, 'getItem'>): boolean {
  try { return (storage ?? globalThis.localStorage)?.getItem(PREPARATION_KEY)
    === `${PREPARATION_VERSION}:${manifest.revision}`; }
  catch { return false; }
}

export function markPrepared(manifest: BootstrapManifest, storage?: Pick<Storage, 'setItem'>): void {
  try { (storage ?? globalThis.localStorage)?.setItem(PREPARATION_KEY, `${PREPARATION_VERSION}:${manifest.revision}`); }
  catch { /* Storage can be unavailable; a later launch will prepare again. */ }
}

export async function openAssetCache(): Promise<AssetCache | null> {
  try { return await globalThis.caches?.open(ASSET_CACHE_NAME) ?? null; }
  catch { return null; }
}

/** Fetched once per launch so changes to public assets invalidate individual cached files. */
export async function loadBootstrapManifest(fetcher: typeof fetch = fetch): Promise<BootstrapManifest> {
  const response = await fetcher(assetUrl('/assets/bootstrap-manifest.json'), { cache: 'no-store' });
  if (!response.ok) throw new Error(`Asset manifest: ${response.status}`);
  const manifest = await response.json() as BootstrapManifest;
  if (manifest.version !== 1 || typeof manifest.revision !== 'string'
    || !/^[a-f0-9]{64}$/.test(manifest.revision) || !manifest.files || typeof manifest.files !== 'object'
    || !Object.entries(manifest.files).every(([path, entry]) => path.startsWith('assets/')
      && entry && typeof entry === 'object' && Number.isSafeInteger(entry.size) && entry.size > 0
      && typeof entry.sha256 === 'string' && /^[a-f0-9]{64}$/.test(entry.sha256))) {
    throw new Error('Asset manifest is invalid.');
  }
  if (await sha256(new Blob([JSON.stringify(manifest.files)])) !== manifest.revision) {
    throw new Error('Asset manifest integrity check failed.');
  }
  return manifest;
}

function manifestPath(url: string): string {
  const index = url.indexOf('assets/');
  return index < 0 ? '' : url.slice(index).split('?')[0];
}

async function sha256(blob: Blob): Promise<string> {
  const hash = await crypto.subtle.digest('SHA-256', await blob.arrayBuffer());
  return [...new Uint8Array(hash)].map(byte => byte.toString(16).padStart(2, '0')).join('');
}

async function inBatches<T>(items: readonly T[], concurrency: number, work: (item: T) => Promise<void>): Promise<void> {
  let next = 0;
  const workers = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (next < items.length) await work(items[next++]);
  });
  await Promise.all(workers);
}

/**
 * Reuses valid persistent responses and downloads only missing or changed files. Every first download is
 * checked against the build manifest before it enters either cache. Cached responses carry the verified
 * hash and size as metadata, so later launches can inspect metadata without reading large bodies.
 */
export async function downloadAssets(urls: readonly string[], manifest: BootstrapManifest,
  onProgress: (progress: DownloadProgress) => void,
  fetcher: typeof fetch = fetch, cache: AssetCache | null = null, concurrency = 6,
  store: (url: string, blob: Blob) => void = storeAsset,
  storeCached: (url: string, load: () => Promise<Blob>) => void = storeLazyAsset): Promise<DownloadProgress> {
  const progress: DownloadProgress = { loadedBytes: 0,
    totalBytes: urls.reduce((total, url) => total + (manifest.files[manifestPath(url)]?.size ?? 0), 0),
    doneFiles: 0, totalFiles: urls.length, cachedFiles: 0, failed: [] };
  const emit = () => onProgress({ ...progress, failed: [...progress.failed] });
  emit();

  await inBatches(urls, concurrency, async url => {
    const entry = manifest.files[manifestPath(url)];
    let received = 0;
    try {
      if (!entry) throw new Error(`Asset is not in the build manifest: ${url}`);
      let cached: Response | undefined;
      try { cached = await cache?.match(url); } catch { /* A blocked cache is a normal network miss. */ }
      if (cached?.headers.get('x-zombonz-sha256') === entry.sha256
        && Number(cached.headers.get('x-zombonz-size')) === entry.size) {
        storeCached(url, async () => {
          const blob = await cached.blob();
          if (blob.size !== entry.size) throw new Error(`Cached asset size changed: ${url}`);
          return blob;
        });
        progress.loadedBytes += entry.size; progress.cachedFiles += 1;
        progress.doneFiles += 1; emit(); return;
      }
      const versioned = `${url}${url.includes('?') ? '&' : '?'}v=${entry.sha256.slice(0, 16)}`;
      const response = await fetcher(versioned, { cache: 'no-store' });
      if (!response.ok || !response.body) throw new Error(`${response.status}`);
      const reader = response.body.getReader();
      const chunks: Uint8Array[] = [];
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(value);
        received += value.byteLength; progress.loadedBytes += value.byteLength;
        if (received > entry.size) throw new Error(`Asset exceeds manifest size: ${url}`);
        emit();
      }
      const blob = new Blob(chunks as BlobPart[], { type: response.headers.get('content-type') ?? '' });
      if (blob.size !== entry.size || await sha256(blob) !== entry.sha256) throw new Error(`Asset integrity check failed: ${url}`);
      store(url, blob);
      try {
        await cache?.put(url, new Response(blob, { headers: {
          'content-type': blob.type, 'x-zombonz-sha256': entry.sha256, 'x-zombonz-size': String(entry.size),
        } }));
      } catch { /* Cache quota or private mode: this load still succeeds in memory. */ }
    } catch {
      progress.failed.push(url);
      progress.loadedBytes -= received;
    }
    progress.doneFiles += 1;
    emit();
  });
  return { ...progress, failed: [...progress.failed] };
}
