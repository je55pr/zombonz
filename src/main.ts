/// <reference types="vite/client" />
import { MenuView } from './client/menuView.ts';
import { loadSettings, saveSettings } from './client/settings.ts';

const gameCanvas = document.querySelector<HTMLCanvasElement>('#game');
if (!gameCanvas) throw new Error('Missing #game canvas.');
const buildId = (import.meta.env.VITE_BUILD_ID as string | undefined)?.slice(0, 7) ?? 'local';

async function startSolo(): Promise<void> {
  // The map, simulation, models and textures load only now, in their own chunk.
  const { startGame } = await import('./game.ts');
  menuCanvas?.remove();
  menu?.dispose();
  gameCanvas!.hidden = false;
  startGame(gameCanvas!, loadSettings());
}

let menu: MenuView | undefined;
let menuCanvas: HTMLCanvasElement | undefined;
// Development inspection URLs (?preview=...) skip the menu and open the map directly.
if (import.meta.env.DEV && new URLSearchParams(location.search).has('preview')) {
  void startSolo();
} else {
  gameCanvas.hidden = true;
  menuCanvas = document.createElement('canvas');
  menuCanvas.id = 'menu';
  menuCanvas.setAttribute('aria-label', 'Zombonz menu');
  gameCanvas.before(menuCanvas);
  menu = new MenuView(menuCanvas, loadSettings(), effect => {
    if (effect.type === 'saveSettings') saveSettings(effect.settings);
    if (effect.type === 'startSolo') void startSolo().catch(error => {
      console.error('Unable to start the game', error);
    });
  }, buildId);
}
