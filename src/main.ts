/// <reference types="vite/client" />
import { MenuView } from './client/menuView.ts';
import type { MapId } from './maps/catalog.ts';
import { INITIAL_DOWNLOAD } from './client/menu.ts';
import { loadSettings, saveSettings } from './client/settings.ts';
import { PauseMenuView } from './client/pauseMenu.ts';
import type { DownloadStatus } from './client/menu.ts';

type GameModule = typeof import('./game.ts');

const gameCanvas = document.querySelector<HTMLCanvasElement>('#game');
if (!gameCanvas) throw new Error('Missing #game canvas.');
const buildId = (import.meta.env.VITE_BUILD_ID as string | undefined)?.slice(0, 7) ?? 'local';
const zombieVariant = new URLSearchParams(location.search).get('zombie') === 'pxltiger' ? 'pxltiger' : 'peter_d';

let game: GameModule | undefined;
let menu: MenuView | undefined;
let menuCanvas: HTMLCanvasElement | undefined;
let session: ReturnType<GameModule['startGame']> | undefined;
let pauseMenu: PauseMenuView | undefined;
let readyDownload: DownloadStatus | undefined;

function captureMouse(): void {
  if (document.pointerLockElement !== gameCanvas) {
    void gameCanvas!.requestPointerLock().catch(error => console.warn('Mouse capture unavailable', error));
  }
}

function showMenu(): void {
  session?.dispose(); session = undefined;
  pauseMenu?.dispose(); pauseMenu = undefined;
  if (document.pointerLockElement === gameCanvas) document.exitPointerLock();
  gameCanvas!.hidden = true;
  menuCanvas = document.createElement('canvas');
  menuCanvas.id = 'menu';
  menuCanvas.setAttribute('aria-label', 'Zombonz menu');
  gameCanvas!.before(menuCanvas);
  const view = new MenuView(menuCanvas, loadSettings(), effect => {
    if (effect.type === 'saveSettings') saveSettings(effect.settings);
    if (effect.type === 'retryDownload') void downloadGame(view);
    if (effect.type === 'startSolo' && game) void startSolo(game, effect.map);
  }, buildId);
  menu = view;
  if (readyDownload) view.setDownload(readyDownload);
  else void downloadGame(view);
}

/**
 * Builds the game behind the menu and only swaps canvases once it reports the map, zombie and starting
 * gun ready (or after a timeout, so a stalled warm-up can never trap the player on the menu).
 */
async function startSolo(module: GameModule, map: MapId): Promise<void> {
  // This runs inside the map-selection click/key gesture. Capture before awaiting asset warm-up.
  gameCanvas!.hidden = false;
  captureMouse();
  pauseMenu = new PauseMenuView(loadSettings(), {
    resume: () => { captureMouse(); session?.resume(); pauseMenu?.setOpen(false); },
    restart: () => { captureMouse(); session?.restart(); pauseMenu?.setOpen(false); },
    quit: showMenu,
    settings: settings => { saveSettings(settings); session?.updateSettings(settings); },
  });
  try {
    session = module.startGame(gameCanvas!, loadSettings(), map, {
      onPauseChange: paused => {
        if (paused && document.pointerLockElement === gameCanvas) document.exitPointerLock();
        pauseMenu?.setOpen(paused);
      },
    });
  } catch (error) {
    console.error('Unable to start the game', error);
    showMenu();
    return;
  }
  await Promise.race([session.ready.catch(error => console.warn('Game warm-up failed', error)),
    new Promise(resolve => setTimeout(resolve, 20000))]);
  menuCanvas?.remove();
  menu?.dispose();
  menuCanvas = undefined; menu = undefined;
  session?.start();
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
  readyDownload = { phase: 'ready', ...downloaded };
  view.setDownload(readyDownload);
}

// Development inspection URLs (?preview=...) skip the menu and open the map directly.
if (import.meta.env.DEV && new URLSearchParams(location.search).has('preview')) {
  void import('./game.ts').then(module => {
    gameCanvas.hidden = false;
    const previewSession = module.startGame(gameCanvas, loadSettings());
    void previewSession.ready.catch(error => console.warn('Preview warm-up failed', error));
  });
} else {
  showMenu();
}
