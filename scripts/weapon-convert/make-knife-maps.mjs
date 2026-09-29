// The gamekorp Ka-Bar knife (CC0, opengameart.org/content/kabar-combat-knife) ships one baked greyscale skin.jpg and no
// material maps. This writes a metallic and a roughness map from its UV layout, so the steel (the blade and the guard,
// the left and middle of the skin) is shiny metal and the ribbed handle (the right block) is dull and non-metallic.
// Usage: node make-knife-maps.mjs "<dir holding skin.jpg>"
import sharp from 'sharp';

const dir = process.argv[2];
const { width, height } = await sharp(`${dir}/skin.jpg`).metadata();
const handleFrom = Math.round(width * 0.565); // the handle's block starts here in the 1024 px skin
const build = (steel, handle) => {
  const data = Buffer.alloc(width * height);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) data[y * width + x] = x < handleFrom ? steel : handle;
  return sharp(data, { raw: { width, height, channels: 1 } });
};
// Not fully metallic: the viewmodel scene has lights but no environment, so a fully metallic blade would render black.
await build(150, 10).png().toFile(`${dir}/metallic.png`);
await build(95, 215).png().toFile(`${dir}/roughness.png`);
console.log('wrote metallic.png and roughness.png', width, height);
