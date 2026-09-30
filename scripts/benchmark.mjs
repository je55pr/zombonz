import { createServer } from 'vite';

// Runs the simulation stress scenarios and prints how long ticks take, and how much work they do.
// `npm run benchmark` runs them all; `npm run benchmark -- train` (or wave, bunker) runs one.
// Times are for this machine; the work counts are exact and the same everywhere.
const names = process.argv.slice(2);
const vite = await createServer({ server: { middlewareMode: true }, appType: 'custom', logLevel: 'error' });
try {
  const { SCENARIOS, formatResult } = await vite.ssrLoadModule('/src/bench/scenarios.ts');
  for (const name of names.length ? names : Object.keys(SCENARIOS)) {
    if (!SCENARIOS[name]) throw new Error(`No scenario "${name}". Choose from: ${Object.keys(SCENARIOS).join(', ')}`);
    console.log(formatResult(SCENARIOS[name]()) + '\n');
  }
} finally {
  await vite.close();
}
