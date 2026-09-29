/**
 * Files downloaded on the start screen, keyed by URL, so the game's loaders read them from memory
 * instead of the network (the HTTP cache is not reliable: the dev server disables it, and Pages keeps
 * files for only ten minutes). Models are released once parsed; textures stay until the store is cleared.
 */
type StoredAsset = Blob | (() => Promise<Blob>);
const assets = new Map<string, StoredAsset>();

export function storeAsset(url: string, blob: Blob): void {
  assets.set(url, blob);
}

/** A verified CacheStorage response can stay on disk until a game loader needs its bytes. */
export function storeLazyAsset(url: string, load: () => Promise<Blob>): void {
  assets.set(url, load);
}

export function getAsset(url: string): Blob | undefined {
  const asset = assets.get(url);
  return asset instanceof Blob ? asset : undefined;
}

export async function getAssetAsync(url: string): Promise<Blob | undefined> {
  const asset = assets.get(url);
  if (!asset) return undefined;
  if (asset instanceof Blob) return asset;
  const blob = await asset();
  assets.set(url, blob);
  return blob;
}

/** Returns and forgets the file, for assets that are parsed exactly once. */
export function takeAsset(url: string): Blob | undefined {
  const blob = assets.get(url);
  assets.delete(url);
  return blob instanceof Blob ? blob : undefined;
}

export async function takeAssetAsync(url: string): Promise<Blob | undefined> {
  const asset = assets.get(url);
  assets.delete(url);
  return typeof asset === 'function' ? asset() : asset;
}

export function storedAssetCount(): number {
  return assets.size;
}

export function clearAssets(): void {
  assets.clear();
}
