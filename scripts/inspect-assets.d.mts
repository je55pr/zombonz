import type { GLTF } from 'three/addons/loaders/GLTFLoader.js';
export function readAssetGeometry(path: string): Promise<GLTF>;
export function readAssetJson(path: string): any;
export function assetExists(path: string): boolean;
export function glbFiles(dir: string): string[];
export function readGlbJson(path: string): { extensionsUsed?: string[]; [key: string]: unknown };
