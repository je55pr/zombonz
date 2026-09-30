import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { migrateLocalScenes } from './migrate-godot-scenes.mjs';

const repository = fileURLToPath(new URL('..', import.meta.url));
const project = join(repository, 'tools/godot-map-editor');
const action = process.argv[2];
if (!['setup', 'check'].includes(action)) throw new Error('Usage: node scripts/godot-map-editor.mjs <setup|check>');
const dotnet = process.platform === 'win32' && existsSync(join(process.env.ProgramFiles ?? 'C:/Program Files', 'dotnet/dotnet.exe'))
  ? join(process.env.ProgramFiles ?? 'C:/Program Files', 'dotnet/dotnet.exe') : 'dotnet';
const env = { ...process.env };
// Godot's editor invokes dotnet itself, even if this shell has not picked up the SDK installer yet.
if (dotnet !== 'dotnet') {
  const pathKey = Object.keys(env).find(key => key.toLowerCase() === 'path') ?? 'PATH';
  env[pathKey] = `${dirname(dotnet)};${env[pathKey] ?? ''}`;
}

function run(command, args, rejectGodotErrors = false) {
  const result = spawnSync(command, args, { cwd: repository, env, encoding: 'utf8', windowsHide: true });
  process.stdout.write(result.stdout ?? '');
  process.stderr.write(result.stderr ?? '');
  if (result.error) throw new Error(`Cannot run ${command}: ${result.error.message}`);
  if (result.status !== 0 || (rejectGodotErrors && /^\s*(?:SCRIPT )?ERROR:/m.test(`${result.stdout}\n${result.stderr}`)))
    throw new Error(`${command} failed (${result.status}).`);
  return result.stdout.trim();
}

run(dotnet, ['build', join(project, 'ZombonzMapEditor.csproj'), '--nologo']);
await migrateLocalScenes(join(project, 'maps'));
if (action === 'check') {
  const godot = process.env.GODOT ?? 'godot';
  const version = run(godot, ['--version']);
  if (!/^4\.7\.\d+\.stable\.mono\./.test(version)) throw new Error(`Use Godot 4.7 .NET (tested with 4.7.2); found ${version}. Set GODOT to its executable path.`);
  // Give the .NET editor time to finish initialization before shutting down its tool scripts.
  run(godot, ['--headless', '--editor', '--path', project, '--quit-after', '10'], true);
  run(godot, ['--headless', '--path', project, 'res://tests/SmokeTest.tscn'], true);
} else {
  console.log('Open tools/godot-map-editor/project.godot in Godot 4.7 .NET. The C# plugin has been built.');
}
