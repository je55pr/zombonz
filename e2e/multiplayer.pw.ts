import { expect, test, type BrowserContext, type Page, type TestInfo } from '@playwright/test';

interface Snapshot {
  role: 'host' | 'client';
  phase: string;
  room: string | null;
  players: number;
  slot: number | null;
  playerId: string | null;
  position: { x: number; y: number; z: number } | null;
  positions: Record<string, { x: number; y: number; z: number }>;
  ticks: number;
  log: string;
}

const snapshot = (page: Page) => page.evaluate(() => {
  const api = (window as typeof window & { zombonzE2E?: { snapshot(): Snapshot } }).zombonzE2E;
  return api?.snapshot() ?? null;
});

function capturePageLog(page: Page, label: string, lines: string[]): void {
  page.on('console', message => lines.push(`[${label}:console:${message.type()}] ${message.text()}`));
  page.on('pageerror', error => lines.push(`[${label}:pageerror] ${error.stack ?? error.message}`));
  page.on('requestfailed', request => lines.push(`[${label}:requestfailed] ${request.url()} ${request.failure()?.errorText ?? ''}`));
}

async function attachDiagnostics(testInfo: TestInfo, host: Page, client: Page, lines: string[]): Promise<void> {
  const state = { host: await snapshot(host).catch(() => null), client: await snapshot(client).catch(() => null), lines };
  await testInfo.attach('multiplayer-browser-smoke.json', {
    body: JSON.stringify(state, null, 2),
    contentType: 'application/json',
  });
}
async function close(contexts: BrowserContext[]): Promise<void> {
  await Promise.all(contexts.map(context => context.close().catch(() => {})));
}

test('real room WebRTC starts two players and replicates movement', async ({ browser }, testInfo) => {
  const hostContext = await browser.newContext();
  const clientContext = await browser.newContext();
  const contexts = [hostContext, clientContext];
  const host = await hostContext.newPage();
  const client = await clientContext.newPage();
  const logs: string[] = [];
  capturePageLog(host, 'host', logs);
  capturePageLog(client, 'client', logs);

  try {
    await host.goto('/?e2e=multiplayer&role=host');
    await expect.poll(async () => (await snapshot(host))?.phase).toBe('room-open');
    const room = (await snapshot(host))?.room;
    expect(room).toMatch(/^[A-Z2-9]{5}$/);

    await client.goto(`/?e2e=multiplayer&role=client&room=${room}`);
    await expect.poll(async () => (await snapshot(host))?.players).toBe(2);
    await expect.poll(async () => (await snapshot(client))?.players).toBe(2);

    await host.evaluate(() => {
      (window as typeof window & { zombonzE2E?: { start(): void } }).zombonzE2E?.start();
    });
    await expect.poll(async () => (await snapshot(host))?.phase).toBe('game');
    await expect.poll(async () => (await snapshot(client))?.phase).toBe('game');

    const clientState = await snapshot(client);
    expect(clientState?.slot).toBe(1);
    expect(clientState?.playerId).toBeTruthy();
    expect(Object.keys(clientState?.positions ?? {})).toHaveLength(2);
    const playerId = clientState!.playerId!;
    await expect.poll(async () => (await snapshot(host))?.positions[playerId] ?? null).not.toBeNull();
    const before = (await snapshot(host))!.positions[playerId];

    await client.evaluate(() => {
      (window as typeof window & { zombonzE2E?: { setMoving(value: boolean): void } }).zombonzE2E?.setMoving(true);
    });
    await expect.poll(async () => {
      const position = (await snapshot(host))?.positions[playerId];
      return position ? Math.hypot(position.x - before.x, position.z - before.z) : 0;
    }, { timeout: 10_000 }).toBeGreaterThan(1.5);

    await client.evaluate(() => {
      (window as typeof window & { zombonzE2E?: { setMoving(value: boolean): void } }).zombonzE2E?.setMoving(false);
    });
    const stoppedAt = (await snapshot(host))!.ticks;
    await expect.poll(async () => (await snapshot(host))?.ticks ?? 0).toBeGreaterThan(stoppedAt + 15);

    await expect.poll(async () => {
      const hostPosition = (await snapshot(host))?.positions[playerId];
      const clientPosition = (await snapshot(client))?.positions[playerId];
      if (!hostPosition || !clientPosition) return Infinity;
      return Math.hypot(hostPosition.x - clientPosition.x, hostPosition.z - clientPosition.z);
    }).toBeLessThan(0.5);
  } finally {
    await attachDiagnostics(testInfo, host, client, logs);
    await close(contexts);
  }
});
