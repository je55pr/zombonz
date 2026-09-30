import { copyFile, readdir, readFile, writeFile } from 'node:fs/promises';
import { constants } from 'node:fs';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptNames = {
  'map_root.gd': 'ZombonzMapRoot.cs',
  'map_item.gd': 'ZombonzMapItem.cs',
};
const properties = {
  source_file: 'SourceFile', data_path: 'DataPath', kind: 'Kind', object_id: 'ObjectId',
  base_size: 'BaseSize', base_height: 'BaseHeight', cost: 'Cost', weapon_id: 'WeaponId',
  max_boards: 'MaxBoards', requires_power: 'RequiresPower', asset: 'Asset', weapon_cost: 'WeaponCost',
  ammo_cost: 'AmmoCost', barrier_id: 'BarrierId', material: 'Material',
};

/** Only rewrite nodes attached to our old scripts; leave transforms and other resources untouched. */
export function migrateScene(source) {
  const scriptIds = new Set();
  let migrated = source.replace(/^\[ext_resource[^\r\n]*\]$/gm, line => {
    const oldScript = Object.keys(scriptNames).find(name => line.includes(`path="res://addons/zombonz/${name}"`));
    if (!oldScript) return line;
    const id = line.match(/\bid="([^"]+)"/)?.[1];
    if (id) scriptIds.add(id);
    return line.replace(/ uid="[^"]*"/, '').replace(oldScript, scriptNames[oldScript]);
  });
  if (!scriptIds.size) return source;
  migrated = migrated.replace(/^\[node [^\r\n]*\][\s\S]*?(?=^\[|$(?![\s\S]))/gm, section => {
    const scriptId = section.match(/^script = ExtResource\("([^"]+)"\)/m)?.[1];
    if (!scriptIds.has(scriptId)) return section;
    return section.replace(/^(\w+)( = )/gm, (line, property, separator) => properties[property] ? properties[property] + separator : line);
  });
  return migrated;
}

export async function migrateLocalScenes(directory) {
  let entries;
  try { entries = await readdir(directory, { withFileTypes: true }); }
  catch (error) { if (error.code === 'ENOENT') return; throw error; }
  for (const entry of entries) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) { await migrateLocalScenes(path); continue; }
    if (!entry.name.endsWith('.tscn')) continue;
    const source = await readFile(path, 'utf8');
    const migrated = migrateScene(source);
    if (migrated === source) continue;
    const backup = `${path}.gd-backup`;
    try { await copyFile(path, backup, constants.COPYFILE_EXCL); }
    catch (error) { if (error.code !== 'EEXIST') throw error; }
    await writeFile(path, migrated);
    console.log(`Migrated ${path}; original saved as ${backup}`);
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await migrateLocalScenes(fileURLToPath(new URL('../tools/godot-map-editor/maps', import.meta.url)));
}
