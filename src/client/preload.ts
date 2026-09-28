import { MAPS } from '../maps/index.ts';
import { assetUrl, MATERIAL_IDS, readEnvironmentManifest } from './environmentMaterials.ts';
import { TREELINE_ASSETS } from './treeline.ts';
import { VENDING_MODEL, VENDING_PAINTS } from './mapDetails.ts';
import { TEAMMATE_MODEL } from './playerView.ts';
import { WEAPON_ASSETS, zombieAssetPaths, type ZombieAssetId } from './runtimeAssets.ts';
import { storeAsset } from './assetStore.ts';
import { AUDIO_CLIPS } from './audioClips.ts';

/** Every file the solo game fetches, for every map: environment maps, props, the zombie rig, all weapon models and every sound. */
export async function gameAssetUrls(zombie: ZombieAssetId = 'peter_d'): Promise<string[]> {
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
  paths.push(...zombieAssetPaths(zombie).map(path => `/assets/${path}`));
  for (const asset of new Set(Object.values(WEAPON_ASSETS))) paths.push(`/assets/weapons/${asset}/model.glb`);
  for (const clip of AUDIO_CLIPS) paths.push(`/assets/audio/${clip}.mp3`);
  return [...new Set(paths.map(assetUrl))];
}

export interface DownloadProgress {
  loadedBytes: number;
  /** Sum of the sizes the server reported; grows if a size was unknown until its download finished. */
  totalBytes: number;
  doneFiles: number;
  totalFiles: number;
  failed: string[];
}

async function inBatches<T>(items: readonly T[], concurrency: number, work: (item: T) => Promise<void>): Promise<void> {
  let next = 0;
  const workers = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (next < items.length) await work(items[next++]);
  });
  await Promise.all(workers);
}

/**
 * Downloads every URL in full and hands each file to `store` (by default the in-memory asset store the
 * game's loaders read). Sizes come from HEAD requests first so the progress bar measures bytes.
 * A failed file is reported and skipped: the game already falls back to placeholders for missing assets.
 */
export async function downloadAssets(urls: readonly string[], onProgress: (progress: DownloadProgress) => void,
  fetcher: typeof fetch = fetch, concurrency = 6,
  store: (url: string, blob: Blob) => void = storeAsset): Promise<DownloadProgress> {
  const progress: DownloadProgress = { loadedBytes: 0, totalBytes: 0, doneFiles: 0, totalFiles: urls.length, failed: [] };
  const sizes = new Map<string, number>();
  await inBatches(urls, 12, async url => {
    try {
      const head = await fetcher(url, { method: 'HEAD' });
      const size = Number(head.headers.get('content-length'));
      if (head.ok && Number.isFinite(size) && size > 0) sizes.set(url, size);
    } catch { /* The full download below reports the failure. */ }
  });
  progress.totalBytes = [...sizes.values()].reduce((total, size) => total + size, 0);
  onProgress({ ...progress });

  await inBatches(urls, concurrency, async url => {
    let received = 0;
    try {
      const response = await fetcher(url);
      if (!response.ok || !response.body) throw new Error(`${response.status}`);
      const reader = response.body.getReader();
      const chunks: Uint8Array[] = [];
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(value);
        received += value.byteLength; progress.loadedBytes += value.byteLength;
        progress.totalBytes = Math.max(progress.totalBytes, progress.loadedBytes);
        onProgress({ ...progress });
      }
      store(url, new Blob(chunks as BlobPart[], { type: response.headers.get('content-type') ?? '' }));
      if (!sizes.has(url)) progress.totalBytes = Math.max(progress.totalBytes, progress.loadedBytes);
    } catch {
      progress.failed.push(url);
      // Keep the bar honest: a failed file no longer counts towards the total.
      progress.totalBytes = Math.max(progress.loadedBytes, progress.totalBytes - Math.max(0, (sizes.get(url) ?? 0) - received));
    }
    progress.doneFiles += 1;
    onProgress({ ...progress, failed: [...progress.failed] });
  });
  return { ...progress, failed: [...progress.failed] };
}
