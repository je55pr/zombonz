import {
  SETTING_LIMITS, adjustSetting, formatSetting, type GameSettings, type SettingKey,
} from './settings.ts';

export type MenuScreen = 'main' | 'multiplayer' | 'settings' | 'loading';

export interface MenuItem {
  id: string;
  label: string;
  /** Present on settings rows; the value shown beside the label. */
  value?: string;
  setting?: SettingKey;
  disabled?: boolean;
}

export interface MenuState {
  screen: MenuScreen;
  selected: number;
  settings: GameSettings;
}

export type MenuAction =
  | { type: 'up' } | { type: 'down' } | { type: 'left' } | { type: 'right' }
  | { type: 'activate'; index?: number } | { type: 'back' } | { type: 'hover'; index: number };

/** What the host should do after an action: start the solo game or persist changed settings. */
export type MenuEffect = { type: 'startSolo' } | { type: 'saveSettings'; settings: GameSettings } | null;

const SETTING_LABELS: Readonly<Record<SettingKey, string>> = {
  sensitivity: 'Mouse sensitivity', fov: 'Field of view', volume: 'Volume',
};

export function menuItems(state: MenuState): MenuItem[] {
  switch (state.screen) {
    case 'main':
      return [{ id: 'solo', label: 'Solo' }, { id: 'multiplayer', label: 'Multiplayer' }, { id: 'settings', label: 'Settings' }];
    case 'multiplayer':
      return [{ id: 'back', label: 'Back' }];
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

export function createMenuState(settings: GameSettings): MenuState {
  return { screen: 'main', selected: 0, settings };
}

function open(state: MenuState, screen: MenuScreen): void {
  state.screen = screen; state.selected = 0;
}

/** Keyboard/mouse intent in, state change plus an effect for the host out. No DOM, so it is unit-testable. */
export function reduceMenu(state: MenuState, action: MenuAction): MenuEffect {
  const items = menuItems(state);
  if (state.screen === 'loading') return null;
  const wrap = (index: number) => (index + items.length) % items.length;
  switch (action.type) {
    case 'up': state.selected = wrap(state.selected - 1); return null;
    case 'down': state.selected = wrap(state.selected + 1); return null;
    case 'hover': if (action.index >= 0 && action.index < items.length) state.selected = action.index; return null;
    case 'back': if (state.screen !== 'main') open(state, 'main'); return null;
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
      if (item.id === 'solo') { open(state, 'loading'); return { type: 'startSolo' }; }
      if (item.id === 'multiplayer') { open(state, 'multiplayer'); return null; }
      if (item.id === 'settings') { open(state, 'settings'); return null; }
      if (item.id === 'back') { open(state, 'main'); return null; }
      return null;
    }
  }
}
