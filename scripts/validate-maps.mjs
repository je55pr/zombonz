import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';

const files = process.argv.slice(2);
if (!files.length) files.push('src/maps/data/bunker.v1.json', 'src/maps/data/asylum.v1.json');
const vite = await createServer({ root: fileURLToPath(new URL('..', import.meta.url)), server: { middlewareMode: true, hmr: false }, appType: 'custom' });
let failed = false;
try {
  const { validateMapDocument } = await vite.ssrLoadModule('/src/maps/mapDocument.ts');
  for (const file of files) {
    try {
      const document = JSON.parse(await readFile(file, 'utf8'));
      const errors = validateMapDocument(document);
      if (errors.length) {
        failed = true;
        console.error(`${file}:\n${errors.map(error => `  ${error}`).join('\n')}`);
      } else console.log(`${file}: valid`);
    } catch (error) {
      failed = true;
      console.error(`${file}: ${error.message}`);
    }
  }
} finally {
  await vite.close();
}
if (failed) process.exitCode = 1;
