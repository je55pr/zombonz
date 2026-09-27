// Re-encodes an existing runtime GLB's textures as WebP without touching its geometry or node names.
// Colour and normal maps stay at most 2K; packed ORM maps drop to 1K, matching convert.mjs.
// Textures no material uses are dropped (only textures: nodes, skins and animations are untouched).
// Usage: node recompress.mjs <in.glb> [out.glb]   (overwrites in place when out is omitted)
import { NodeIO, PropertyType } from '@gltf-transform/core';
import { ALL_EXTENSIONS, EXTTextureWebP } from '@gltf-transform/extensions';
import { prune } from '@gltf-transform/functions';
import sharp from 'sharp';

const [input, output = input] = process.argv.slice(2);
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
const doc = await io.read(input);
doc.createExtension(EXTTextureWebP).setRequired(true);
await doc.transform(prune({ propertyTypes: [PropertyType.TEXTURE] }));
for (const texture of doc.getRoot().listTextures()) {
  const slots = new Set(doc.getGraph().listParentEdges(texture).map(edge => edge.getName()));
  const packed = slots.has('metallicRoughnessTexture') || slots.has('occlusionTexture');
  const normal = slots.has('normalTexture');
  const size = packed ? 1024 : 2048;
  const image = await sharp(Buffer.from(texture.getImage()))
    .resize({ width: size, height: size, fit: 'inside', withoutEnlargement: true })
    .webp({ quality: packed ? 88 : normal ? 90 : 85 }).toBuffer();
  texture.setImage(new Uint8Array(image)).setMimeType('image/webp');
  const uri = texture.getURI();
  if (uri) texture.setURI(uri.replace(/\.(png|jpe?g)$/i, '.webp'));
}
await io.write(output, doc);
