// Repackages the CC-BY "WW2 US Army Ranger" (Tactical_Beard, Sketchfab) COLLADA source as an OBJ + MTL +
// colour-texture ZIP, which Mixamo's auto-rigger accepts (it takes FBX, OBJ or a ZIP, not COLLADA).
// Usage: node ranger-for-mixamo.mjs <out.zip>
import * as THREE from 'three';
import { mkdirSync, writeFileSync, copyFileSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { loadSource } from './load.mjs';

const SOURCE = 'C:/ChatGPT/Shared/Cache/ZombonzAssets/originals/teammate/source/model';
const zip = process.argv[2];
if (!zip) throw new Error('Usage: node ranger-for-mixamo.mjs <out.zip>');
const work = 'C:/ChatGPT/Shared/Cache/ZombonzAssets/originals/teammate/mixamo-upload';
rmSync(work, { recursive: true, force: true });
mkdirSync(`${work}/textures`, { recursive: true });

const root = await loadSource(`${SOURCE}/model.dae`);
root.updateMatrixWorld(true);
// Group every triangle by material, in world space; the source is two units tall, so scale to 1.8 m.
const box = new THREE.Box3().setFromObject(root);
const scale = 1.8 / (box.max.y - box.min.y);
const lift = new THREE.Matrix4().makeScale(scale, scale, scale).multiply(new THREE.Matrix4().makeTranslation(0, -box.min.y, 0));
const groups = new Map();
root.traverse(object => {
  if (!object.isMesh) return;
  const geometry = (object.geometry.index ? object.geometry.toNonIndexed() : object.geometry.clone())
    .applyMatrix4(new THREE.Matrix4().multiplyMatrices(lift, object.matrixWorld));
  const materials = [].concat(object.material);
  const ranges = geometry.groups.length ? geometry.groups : [{ start: 0, count: geometry.attributes.position.count, materialIndex: 0 }];
  for (const range of ranges) {
    const name = materials[range.materialIndex]?.name || 'Cloth';
    if (!groups.has(name)) groups.set(name, []);
    groups.get(name).push({ geometry, start: range.start, count: range.count });
  }
});
const lines = ['# WW2 US Army Ranger by Tactical_Beard (CC BY 4.0), repackaged for Mixamo', 'mtllib model.mtl'];
let base = 1;
for (const [name, ranges] of groups) {
  lines.push(`g ${name}`, `usemtl ${name}`);
  for (const { geometry, start, count } of ranges) {
    const p = geometry.attributes.position, n = geometry.attributes.normal, uv = geometry.attributes.uv;
    for (let i = start; i < start + count; i++) {
      lines.push(`v ${p.getX(i).toFixed(5)} ${p.getY(i).toFixed(5)} ${p.getZ(i).toFixed(5)}`);
      lines.push(`vt ${uv ? uv.getX(i).toFixed(5) : 0} ${uv ? uv.getY(i).toFixed(5) : 0}`);
      lines.push(`vn ${n.getX(i).toFixed(4)} ${n.getY(i).toFixed(4)} ${n.getZ(i).toFixed(4)}`);
    }
    for (let i = 0; i < count; i += 3) {
      const [a, b, c] = [base + i, base + i + 1, base + i + 2];
      lines.push(`f ${a}/${a}/${a} ${b}/${b}/${b} ${c}/${c}/${c}`);
    }
    base += count;
  }
}
writeFileSync(`${work}/model.obj`, `${lines.join('\n')}\n`);
const mtl = [];
for (const name of groups.keys()) {
  copyFileSync(`${SOURCE}/textures/${name}_albedo.jpg`, `${work}/textures/${name}_albedo.jpg`);
  mtl.push(`newmtl ${name}`, 'Kd 1 1 1', `map_Kd textures/${name}_albedo.jpg`, '');
}
writeFileSync(`${work}/model.mtl`, mtl.join('\n'));
rmSync(zip, { force: true });
execFileSync('C:/Program Files/7-Zip/7z.exe', ['a', '-tzip', zip, `${work}/*`], { stdio: 'ignore' });
console.log(`wrote ${zip}: ${groups.size} materials, ${(base - 1) / 3} triangles`);
