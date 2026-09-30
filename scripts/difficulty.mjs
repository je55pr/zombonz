import { createServer } from 'vite';

// Prints how the game feels to play against: how a chase and a dash through a crowd go, by the numbers.
// `npm run difficulty`. Everything is seeded, so the numbers are the same on any machine.
const vite = await createServer({ server: { middlewareMode: true }, appType: 'custom', logLevel: 'error' });
try {
  const { formatDifficulty } = await vite.ssrLoadModule('/src/bench/difficulty.ts');
  console.log(formatDifficulty());
} finally {
  await vite.close();
}
