/// <reference types="vite/client" />
import { MenuView } from './client/menuView.ts';
import type { MapId } from './maps/catalog.ts';
import { INITIAL_DOWNLOAD } from './client/menu.ts';
import { loadSettings, saveSettings } from './client/settings.ts';

type GameModule = typeof import('./game.ts');

const gameCanvas = document.querySelector<HTMLCanvasElement>('#game');
if (!gameCanvas) throw new Error('Missing #game canvas.');
const buildId = (import.meta.env.VITE_BUILD_ID as string | undefined)?.slice(0, 7) ?? 'local';
const zombieVariant = new URLSearchParams(location.search).get('zombie') === 'pxltiger' ? 'pxltiger' : 'peter_d';

let game: GameModule | undefined;
let menu: MenuView | undefined;
let menuCanvas: HTMLCanvasElement | undefined;

/**
 * Builds the game behind the menu and only swaps canvases once it reports the map, zombie and starting
 * gun ready (or after a timeout, so a stalled warm-up can never trap the player on the menu).
 */
async function startSolo(module: GameModule, map: MapId): Promise<void> {
  const ready = module.startGame(gameCanvas!, loadSettings(), map);
  await Promise.race([ready.catch(error => console.warn('Game warm-up failed', error)),
    new Promise(resolve => setTimeout(resolve, 20000))]);
  menuCanvas?.remove();
  menu?.dispose();
  gameCanvas!.hidden = false;
}

/**
 * Runs on the start screen: fetch the game code, then every model and texture it uses, so the browser
 * cache holds them before Solo or Multiplayer can be chosen. A missing asset still unlocks play.
 */
async function downloadGame(view: MenuView): Promise<void> {
  view.setDownload({ ...INITIAL_DOWNLOAD });
  try {
    game ??= await import('./game.ts');
  } catch (error) {
    console.error('Unable to download the game code', error);
    view.setDownload({ ...INITIAL_DOWNLOAD, phase: 'error' });
    return;
  }
  let urls: string[] = [];
  try {
    urls = await game.gameAssetUrls(zombieVariant);
  } catch (error) {
    // Without the environment manifest the list is incomplete; the game still loads what it can.
    console.warn('Unable to list game assets', error);
  }
  const result = await game.downloadAssets(urls, progress => view.setDownload({
    phase: 'assets', ...progress, failedFiles: progress.failed.length,
  }));
  if (result.failed.length) console.warn('Assets that failed to download', result.failed);
  const downloaded = { ...result, failedFiles: result.failed.length };
  // Unpack everything the opening moments need, so Bunker appears fully textured with the real pistol.
  await game.prepareGameAssets((preparedSteps, totalSteps) => view.setDownload({
    phase: 'preparing', ...downloaded, preparedSteps, totalSteps,
  }), zombieVariant);
  view.setDownload({ phase: 'ready', ...downloaded });
}

// Development inspection URLs (?preview=...) skip the menu and open the map directly.
if (import.meta.env.DEV && new URLSearchParams(location.search).has('preview')) {
  void import('./game.ts').then(module => { gameCanvas.hidden = false; void module.startGame(gameCanvas, loadSettings()); });
} else {
  menuCanvas = document.createElement('canvas');
  menuCanvas.id = 'menu';
  menuCanvas.setAttribute('aria-label', 'Zombonz menu');
  gameCanvas.before(menuCanvas);
  const view = new MenuView(menuCanvas, loadSettings(), effect => {
    if (effect.type === 'saveSettings') saveSettings(effect.settings);
    if (effect.type === 'retryDownload') void downloadGame(view);
    // Solo is only selectable once the download has finished, so the module is loaded.
    if (effect.type === 'startSolo' && game) void startSolo(game, effect.map);
  }, buildId);
  menu = view;
  void downloadGame(view);
}
