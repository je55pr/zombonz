/**
 * Files downloaded on the start screen, keyed by URL, so the game's loaders read them from memory
 * instead of the network (the HTTP cache is not reliable: the dev server disables it, and Pages keeps
 * files for only ten minutes). Models are released once parsed; textures stay until the store is cleared.
 */
const assets = new Map<string, Blob>();

export function storeAsset(url: string, blob: Blob): void {
  assets.set(url, blob);
}

export function getAsset(url: string): Blob | undefined {
  return assets.get(url);
}

/** Returns and forgets the file, for assets that are parsed exactly once. */
export function takeAsset(url: string): Blob | undefined {
  const blob = assets.get(url);
  assets.delete(url);
  return blob;
}

export function storedAssetCount(): number {
  return assets.size;
}

export function clearAssets(): void {
  assets.clear();
}
