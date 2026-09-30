/// <reference types="vite/client" />
import { MenuView } from './client/menuView.ts';
import type { MapId } from './maps/catalog.ts';
import { INITIAL_DOWNLOAD } from './client/menu.ts';
import { loadSettings, saveSettings } from './client/settings.ts';
import { PauseMenuView } from './client/pauseMenu.ts';
import { BindingEditor } from './client/bindingEditor.ts';
import type { DownloadStatus } from './client/menu.ts';

type GameModule = typeof import('./game.ts');
type NetPlay = import('./game.ts').NetPlay;
type NetHost = import('./net/host.ts').NetHost;
type NetClient = import('./net/client.ts').NetClient;
type StartInfo = import('./net/client.ts').StartInfo;
type LobbyPlayer = import('./net/protocol.ts').LobbyPlayer;

const gameCanvas = document.querySelector<HTMLCanvasElement>('#game');
if (!gameCanvas) throw new Error('Missing #game canvas.');
const buildId = (import.meta.env.VITE_BUILD_ID as string | undefined)?.slice(0, 7) ?? 'local';

let game: GameModule | undefined;
let menu: MenuView | undefined;
let menuCanvas: HTMLCanvasElement | undefined;
let session: ReturnType<GameModule['startGame']> | undefined;
let pauseMenu: PauseMenuView | undefined;
let bindingEditor: BindingEditor | undefined;
let readyDownload: DownloadStatus | undefined;
let lobby: { dispose(): void } | undefined;
let connectionTest: { dispose(): void } | undefined;

/** A short message over whatever is showing, such as why a co-op game ended. */
function showNotice(text: string): void {
  const notice = document.createElement('div');
  notice.className = 'notice'; notice.setAttribute('role', 'status'); notice.textContent = text;
  document.body.append(notice);
  setTimeout(() => notice.remove(), 7000);
}

function captureMouse(): void {
  if (document.pointerLockElement !== gameCanvas) {
    void gameCanvas!.requestPointerLock().catch(error => console.warn('Mouse capture unavailable', error));
  }
}

function showMenu(): void {
  bindingEditor?.dispose(); bindingEditor = undefined;
  lobby?.dispose(); lobby = undefined;
  connectionTest?.dispose(); connectionTest = undefined;
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
    if (effect.type === 'openBindings') openBindings();
    if (effect.type === 'retryDownload') location.reload();
    if (effect.type === 'startSolo' && game) void startSession(game, effect.map);
    if (effect.type === 'hostGame') void openLobby({ kind: 'host', map: effect.map });
    if (effect.type === 'joinGame') void openLobby({ kind: 'join' });
    if (effect.type === 'testConnection') void openConnectionTest();
  }, buildId);
  menu = view;
  if (readyDownload) view.setDownload(readyDownload);
  else void downloadGame(view);
}

function openBindings(): void {
  if (bindingEditor) return;
  bindingEditor = new BindingEditor(bindings => session?.updateBindings(bindings), () => {
    bindingEditor = undefined;
    if (pauseMenu?.open) pauseMenu.element.querySelector<HTMLButtonElement>('[data-action="controls"]')?.focus();
  });
}

/** "Test my connection", over the menu or the lobby. */
async function openConnectionTest(): Promise<void> {
  if (connectionTest) return;
  const { ConnectionTestView } = await import('./client/connectionTest.ts');
  if (connectionTest) return;
  connectionTest = new ConnectionTestView(buildId, () => { connectionTest = undefined; });
}

/**
 * The co-op lobby, over the menu: hosting on the chosen map, or joining someone's game. A copy of the game that has a game server
 * (server/) gets the room lobby, with a short code to type; one without, or a player who asked for it, gets the lobby with connection codes.
 */
async function openLobby(mode: { kind: 'host'; map: MapId } | { kind: 'join' }, options: { codes?: boolean } = {}): Promise<void> {
  if (lobby) return;
  const [{ LobbyView }, { RoomLobbyView }, { signalAvailable }] = await Promise.all([
    import('./client/lobby.ts'), import('./client/roomLobby.ts'), import('./network/signaling.ts'),
  ]);
  const rooms = !options.codes && await signalAvailable();
  if (lobby || !game) return;
  const module = game;
  const callbacks = {
    hostStarted: (host: NetHost, players: LobbyPlayer[], seed: number, map: MapId) => {
      lobby = undefined;
      void startSession(module, map, { role: 'host', host, players, seed });
    },
    clientStarted: (client: NetClient, start: StartInfo) => {
      lobby = undefined;
      void startSession(module, start.map, { role: 'client', client, start });
    },
    back: () => { lobby = undefined; },
    testConnection: () => { void openConnectionTest(); },
    useCodes: () => { lobby = undefined; void openLobby(mode, { codes: true }); },
  };
  lobby = rooms ? new RoomLobbyView(mode, callbacks) : new LobbyView(mode, callbacks);
}

/**
 * Builds the game behind the menu and only swaps canvases once it reports the map, zombie and starting
 * gun ready (or after a timeout, so a stalled warm-up can never trap the player on the menu).
 */
async function startSession(module: GameModule, map: MapId, net?: NetPlay): Promise<void> {
  // Solo and hosting start from a click or key press, so the mouse can be captured straight away.
  // A joining player starts when the host does, with no gesture of their own to capture it.
  gameCanvas!.hidden = false;
  if (net?.role !== 'client') captureMouse();
  pauseMenu = new PauseMenuView(loadSettings(), {
    resume: () => { captureMouse(); session?.resume(); pauseMenu?.setOpen(false); },
    restart: () => { captureMouse(); session?.restart(); pauseMenu?.setOpen(false); },
    quit: showMenu,
    settings: settings => { saveSettings(settings); session?.updateSettings(settings); },
    controls: openBindings,
  }, document.body, { online: !!net, canRestart: net?.role !== 'client' });
  try {
    session = module.startGame(gameCanvas!, loadSettings(), map, {
      onPauseChange: paused => {
        if (paused && document.pointerLockElement === gameCanvas) document.exitPointerLock();
        pauseMenu?.setOpen(paused);
      },
      onDisconnected: reason => { showMenu(); showNotice(reason); },
    }, net);
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
  // Without the mouse captured, offer the menu so one click on Resume captures it.
  if (net?.role === 'client' && document.pointerLockElement !== gameCanvas) pauseMenu?.setOpen(true);
}

/**
 * Runs before the main menu: validate the build manifest, reuse cached assets, download missing files,
 * and prepare the page's models, textures and audio before Solo or Multiplayer can be chosen.
 */
async function downloadGame(view: MenuView): Promise<void> {
  let latest: DownloadStatus = { ...INITIAL_DOWNLOAD };
  const report = (status: DownloadStatus) => { latest = status; view.setDownload(status); };
  report(latest);
  try {
    game ??= await import('./game.ts');
  } catch (error) {
    console.error('Unable to download the game code', error);
    report({ ...latest, phase: 'error' });
    return;
  }
  try {
    const manifest = await game.loadBootstrapManifest();
    const cache = await game.openAssetCache();
    // The required URL list comes from the environment manifest. Load that small file first, then
    // display progress against the complete list with exact sizes from the build manifest.
    const environmentUrl = `${import.meta.env.BASE_URL}assets/environment/manifest.json`;
    const environment = await game.downloadAssets([environmentUrl], manifest, () => {}, fetch, cache);
    if (environment.failed.length) throw new Error('Environment manifest unavailable.');
    const urls = await game.gameAssetUrls();
    const result = await game.downloadAssets(urls, manifest, progress => report({
      phase: 'assets', ...progress, failedFiles: progress.failed.length,
    }), fetch, cache);
    if (result.failed.length) throw new Error(`${result.failed.length} required assets unavailable.`);
    const downloaded = { ...result, failedFiles: 0 };
    if (result.cachedFiles !== result.totalFiles || !game.wasPrepared(manifest)) {
      await game.prepareGameAssets((preparedSteps, totalSteps) => report({
        phase: 'preparing', ...downloaded, preparedSteps, totalSteps,
      }));
      game.markPrepared(manifest);
    }
    readyDownload = { phase: 'ready', ...downloaded };
    report(readyDownload);
  } catch (error) {
    console.error('Unable to bootstrap game assets', error);
    report({ ...latest, phase: 'error' });
  }
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
