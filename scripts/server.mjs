// Builds the game and runs or deploys the game server (see docs/server-setup.md):
//   npm run server:dev              build, then serve the game and the room server locally (http://localhost:8787)
//   npm run server:deploy           build, then deploy to your Cloudflare account (log in first with: npx wrangler login)
// Anything after `--` goes to wrangler, e.g. npm run server:deploy -- --dry-run
import { spawnSync } from 'node:child_process';

const [command, ...rest] = process.argv.slice(2);
if (command !== 'dev' && command !== 'deploy') {
  console.error('Usage: node scripts/server.mjs dev|deploy [wrangler options]');
  process.exit(2);
}

// The build ID is shown on the F2 screen and in "Test my connection", so players can check they run the same version.
const git = spawnSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' });
const env = { ...process.env, VITE_BUILD_ID: process.env.VITE_BUILD_ID || (git.status === 0 ? git.stdout.trim() : 'local') };

function run(program, args) {
  const result = spawnSync(program, args, { stdio: 'inherit', shell: true, env });
  if (result.status !== 0) process.exit(result.status ?? 1);
}

run('npm', ['run', 'build']);
run('npx', ['wrangler', command, ...rest]);
