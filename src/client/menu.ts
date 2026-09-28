import {
  SETTING_LIMITS, adjustSetting, formatSetting, type GameSettings, type SettingKey,
} from './settings.ts';
import { MAP_CATALOG, type MapId } from '../maps/catalog.ts';

/** Solo opens 'maps', where choosing a map starts the game; hosting a co-op game picks its map on 'hostMaps'. */
export type MenuScreen = 'main' | 'maps' | 'multiplayer' | 'hostMaps' | 'settings' | 'loading';

export interface MenuItem {
  id: string;
  label: string;
  /** Present on settings rows; the value shown beside the label. */
  value?: string;
  setting?: SettingKey;
  disabled?: boolean;
}

/** Start-screen download of the game code and every model/texture; play options unlock when it ends. */
export interface DownloadStatus {
  /** 'preparing' unpacks the downloaded files (decode textures, parse models) before play unlocks. */
  phase: 'code' | 'assets' | 'preparing' | 'ready' | 'error';
  loadedBytes: number;
  totalBytes: number;
  doneFiles: number;
  totalFiles: number;
  failedFiles: number;
  preparedSteps?: number;
  totalSteps?: number;
}

export const INITIAL_DOWNLOAD: Readonly<DownloadStatus> = {
  phase: 'code', loadedBytes: 0, totalBytes: 0, doneFiles: 0, totalFiles: 0, failedFiles: 0,
};

export interface MenuState {
  screen: MenuScreen;
  selected: number;
  settings: GameSettings;
  download: DownloadStatus;
  /** The map being started, once one is chosen. */
  map?: MapId;
}

export type MenuAction =
  | { type: 'up' } | { type: 'down' } | { type: 'left' } | { type: 'right' }
  | { type: 'activate'; index?: number } | { type: 'back' } | { type: 'hover'; index: number };

/** What the host should do after an action: start the solo game, persist settings or retry the download. */
export type MenuEffect = { type: 'startSolo'; map: MapId } | { type: 'saveSettings'; settings: GameSettings }
  | { type: 'retryDownload' } | { type: 'hostGame'; map: MapId } | { type: 'joinGame' } | null;

const SETTING_LABELS: Readonly<Record<SettingKey, string>> = {
  sensitivity: 'Mouse sensitivity', fov: 'Field of view', volume: 'Volume',
};

export function menuItems(state: MenuState): MenuItem[] {
  switch (state.screen) {
    case 'main': {
      // Play options stay locked until everything is downloaded (a failed asset still allows play).
      const locked = state.download.phase !== 'ready';
      return [
        { id: 'solo', label: 'Solo', disabled: locked }, { id: 'multiplayer', label: 'Multiplayer', disabled: locked },
        { id: 'settings', label: 'Settings' },
        ...(state.download.phase === 'error' ? [{ id: 'retry', label: 'Retry download' }] : []),
      ];
    }
    case 'maps':
      return [...MAP_CATALOG.map(map => ({ id: `map:${map.id}`, label: map.name })), { id: 'back', label: 'Back' }];
    case 'multiplayer':
      return [{ id: 'host', label: 'Host Game' }, { id: 'join', label: 'Join Game' }, { id: 'back', label: 'Back' }];
    case 'hostMaps':
      return [...MAP_CATALOG.map(map => ({ id: `host:${map.id}`, label: map.name })), { id: 'back', label: 'Back' }];
    case 'settings':
      return [
        ...(Object.keys(SETTING_LIMITS) as SettingKey[]).map(key => ({
          id: key, label: SETTING_LABELS[key], setting: key, value: formatSetting(key, state.settings[key]),
        })),
        { id: 'back', label: 'Back' },
      ];
    case 'loading':
      return [];
  }
}

export function createMenuState(settings: GameSettings, download: DownloadStatus = INITIAL_DOWNLOAD): MenuState {
  const state: MenuState = { screen: 'main', selected: 0, settings, download: { ...download } };
  state.selected = firstEnabled(state);
  return state;
}

function firstEnabled(state: MenuState): number {
  return Math.max(0, menuItems(state).findIndex(item => !item.disabled));
}

function open(state: MenuState, screen: MenuScreen): void {
  state.screen = screen; state.selected = firstEnabled(state);
}

/** Applies download progress; finishing moves the highlight to Solo so Enter plays straight away. */
export function setDownload(state: MenuState, download: DownloadStatus): void {
  const unlocked = state.download.phase !== 'ready' && download.phase === 'ready';
  state.download = { ...download };
  const items = menuItems(state);
  if (unlocked && state.screen === 'main') state.selected = 0;
  else if (state.selected >= items.length || items[state.selected]?.disabled) state.selected = firstEnabled(state);
}

/** Keyboard/mouse intent in, state change plus an effect for the host out. No DOM, so it is unit-testable. */
export function reduceMenu(state: MenuState, action: MenuAction): MenuEffect {
  const items = menuItems(state);
  if (state.screen === 'loading') return null;
  const wrap = (index: number) => (index + items.length) % items.length;
  // Keyboard movement skips locked rows.
  const step = (direction: number) => {
    let index = state.selected;
    for (let tries = 0; tries < items.length; tries++) {
      index = wrap(index + direction);
      if (!items[index].disabled) { state.selected = index; return; }
    }
  };
  switch (action.type) {
    case 'up': step(-1); return null;
    case 'down': step(1); return null;
    case 'hover':
      if (action.index >= 0 && action.index < items.length && !items[action.index].disabled) state.selected = action.index;
      return null;
    case 'back': if (state.screen !== 'main') open(state, state.screen === 'hostMaps' ? 'multiplayer' : 'main'); return null;
    case 'left': case 'right': {
      const setting = items[state.selected]?.setting;
      if (!setting) return null;
      state.settings = adjustSetting(state.settings, setting, action.type === 'left' ? -1 : 1);
      return { type: 'saveSettings', settings: state.settings };
    }
    case 'activate': {
      if (action.index !== undefined) state.selected = action.index;
      const item = items[state.selected];
      if (!item || item.disabled) return null;
      if (item.setting) {
        // Clicking a setting row steps it up, wrapping to the minimum after the maximum.
        const limit = SETTING_LIMITS[item.setting];
        const atMax = state.settings[item.setting] >= limit.max - 1e-9;
        state.settings = atMax ? { ...state.settings, [item.setting]: limit.min }
          : adjustSetting(state.settings, item.setting, 1);
        return { type: 'saveSettings', settings: state.settings };
      }
      if (item.id === 'solo') { open(state, 'maps'); return null; }
      const chosen = MAP_CATALOG.find(map => `map:${map.id}` === item.id);
      if (chosen) { state.map = chosen.id; open(state, 'loading'); return { type: 'startSolo', map: chosen.id }; }
      if (item.id === 'multiplayer') { open(state, 'multiplayer'); return null; }
      if (item.id === 'host') { open(state, 'hostMaps'); return null; }
      if (item.id === 'join') return { type: 'joinGame' };
      const hosted = MAP_CATALOG.find(map => `host:${map.id}` === item.id);
      if (hosted) return { type: 'hostGame', map: hosted.id };
      if (item.id === 'settings') { open(state, 'settings'); return null; }
      if (item.id === 'back') { open(state, state.screen === 'hostMaps' ? 'multiplayer' : 'main'); return null; }
      if (item.id === 'retry') { setDownload(state, { ...INITIAL_DOWNLOAD }); return { type: 'retryDownload' }; }
      return null;
    }
  }
}
