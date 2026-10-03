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

// The reload check presses dock buttons with no map open; the dock reports that, and logs it as an error, by design.
const expectedGodotErrors = ['Open a Zombonz map scene first.'];

function run(command, args, rejectGodotErrors = false, timeout = undefined) {
  const result = spawnSync(command, args, { cwd: repository, env, encoding: 'utf8', windowsHide: true, timeout });
  process.stdout.write(result.stdout ?? '');
  process.stderr.write(result.stderr ?? '');
  if (result.error) throw new Error(`Cannot run ${command}: ${result.error.message}`);
  const godotError = `${result.stdout}\n${result.stderr}`.split('\n')
    .find(line => /^\s*(?:SCRIPT )?ERROR:/.test(line) && !expectedGodotErrors.some(text => line.includes(text)));
  if (result.status !== 0 || (rejectGodotErrors && godotError))
    throw new Error(`${command} failed (${result.status})${godotError ? `: ${godotError.trim()}` : '.'}`);
  return result.stdout.trim();
}

run(dotnet, ['build', join(project, 'ZombonzMapEditor.csproj'), '--nologo']);
await migrateLocalScenes(join(project, 'maps'));
if (action === 'check') {
  const godot = process.env.GODOT ?? 'godot';
  const version = run(godot, ['--version']);
  if (!/^4\.7\.\d+\.stable\.mono\./.test(version)) throw new Error(`Use Godot 4.7 .NET (tested with 4.7.2); found ${version}. Set GODOT to its executable path.`);
  // The editor quits itself once tests/ReloadCheck.gd has had it reload the C# code and pressed the dock again.
  env.ZOMBONZ_EDITOR_SMOKE_TEST = '1';
  const editorOutput = run(godot, ['--headless', '--editor', '--path', project], true, 10 * 60 * 1000);
  delete env.ZOMBONZ_EDITOR_SMOKE_TEST;
  if (!editorOutput.includes('C# map editor (editor):')) throw new Error('The editor plugin did not run its import checks.');
  if (!editorOutput.includes('C# map editor (reload):')) throw new Error('The dock was not checked after a C# reload.');
  run(godot, ['--headless', '--path', project, 'res://tests/SmokeTest.tscn'], true);
} else {
  console.log('Open tools/godot-map-editor/project.godot in Godot 4.7 .NET. The C# plugin has been built.');
}
