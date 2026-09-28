// Turns transmissive glass (KHR_materials_transmission) into plain see-through glass. While a
// transmissive material is on screen, three.js draws the whole opaque scene a second time into a
// mipmapped texture every frame (about 10 ms on an integrated GPU), so no runtime asset may use it.
// Glass keeps its colour and gloss and becomes an alpha-blended pane instead.
// Usage: node plain-glass.mjs   (run from this folder; rewrites every affected GLB under public/assets)
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';

/** How much of the glass shows: enough for a sheen and tint, little enough to see what is behind it. */
export const GLASS_ALPHA = 0.25;
/** Extensions that only mean something to transmissive glass. */
const GLASS_EXTENSIONS = ['KHR_materials_transmission', 'KHR_materials_volume', 'KHR_materials_ior'];

/** Converts every transmissive material in the document; returns their names. */
export function plainGlass(doc) {
  const converted = [];
  for (const material of doc.getRoot().listMaterials()) {
    if (!material.getExtension('KHR_materials_transmission')) continue;
    for (const name of GLASS_EXTENSIONS) material.setExtension(name, null);
    const [r, g, b, a] = material.getBaseColorFactor();
    material.setAlphaMode('BLEND').setBaseColorFactor([r, g, b, Math.min(a, GLASS_ALPHA)]);
    converted.push(material.getName());
  }
  // Drop extensions nothing uses any more, so the file stops declaring them.
  for (const extension of doc.getRoot().listExtensionsUsed()) {
    if (!GLASS_EXTENSIONS.includes(extension.extensionName)) continue;
    const used = doc.getRoot().listMaterials().some(material => material.getExtension(extension.extensionName));
    if (!used) extension.dispose();
  }
  return converted;
}

function glbFiles(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap(entry => entry.isDirectory() ? glbFiles(`${dir}/${entry.name}`)
    : entry.name.endsWith('.glb') ? [`${dir}/${entry.name}`] : []);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const assets = fileURLToPath(new URL('../../public/assets', import.meta.url));
  const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
  const manifestPath = `${assets}/props/manifest.json`;
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  for (const path of glbFiles(assets)) {
    // Only files that declare the extension are opened and rewritten.
    if (!readFileSync(path).includes('KHR_materials_transmission')) continue;
    const doc = await io.read(path);
    const converted = plainGlass(doc);
    if (!converted.length) continue;
    await io.write(path, doc);
    const published = `/assets${path.slice(assets.length).replaceAll('\\', '/')}`;
    const prop = Object.values(manifest.props).find(entry => entry.model === published);
    if (prop) prop.bytes = statSync(path).size;
    console.log(`${published}: ${converted.join(', ')}`);
  }
  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
}
