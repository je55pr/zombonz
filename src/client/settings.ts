/** Per-player preferences. Presentation only: none of these affect the deterministic simulation. */
export interface GameSettings {
  /** Multiplier on the base mouse-look speed. */
  sensitivity: number;
  /** Hip-fire field of view in degrees; aiming and sprinting adjust from it. */
  fov: number;
  /** Master volume, 0 to 1. */
  volume: number;
}

export type SettingKey = keyof GameSettings;

export const SETTING_LIMITS: Readonly<Record<SettingKey, { min: number; max: number; step: number }>> = {
  sensitivity: { min: 0.2, max: 3, step: 0.1 },
  fov: { min: 55, max: 90, step: 1 },
  volume: { min: 0, max: 1, step: 0.1 },
};

export const DEFAULT_SETTINGS: Readonly<GameSettings> = { sensitivity: 1, fov: 67, volume: 0.8 };

const STORAGE_KEY = 'zombonz.settings.v1';

function clampSetting(key: SettingKey, value: unknown): number {
  const limit = SETTING_LIMITS[key];
  if (typeof value !== 'number' || !Number.isFinite(value)) return DEFAULT_SETTINGS[key];
  // Snap to the step so repeated adjustments never drift (0.1 + 0.2 and friends).
  const snapped = Math.round((value - limit.min) / limit.step) * limit.step + limit.min;
  return Math.min(limit.max, Math.max(limit.min, Number(snapped.toFixed(3))));
}

export function normalizeSettings(raw: unknown): GameSettings {
  const source = (raw && typeof raw === 'object' ? raw : {}) as Partial<Record<SettingKey, unknown>>;
  return {
    sensitivity: clampSetting('sensitivity', source.sensitivity),
    fov: clampSetting('fov', source.fov),
    volume: clampSetting('volume', source.volume),
  };
}

export function adjustSetting(settings: GameSettings, key: SettingKey, steps: number): GameSettings {
  return { ...settings, [key]: clampSetting(key, settings[key] + steps * SETTING_LIMITS[key].step) };
}

/** Storage can be missing or throw (private windows, blocked site data); settings then just don't persist. */
export function loadSettings(storage: Pick<Storage, 'getItem'> | undefined = globalThis.localStorage): GameSettings {
  try {
    const text = storage?.getItem(STORAGE_KEY);
    return normalizeSettings(text ? JSON.parse(text) : null);
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export function saveSettings(settings: GameSettings,
  storage: Pick<Storage, 'setItem'> | undefined = globalThis.localStorage): void {
  try {
    storage?.setItem(STORAGE_KEY, JSON.stringify(normalizeSettings(settings)));
  } catch {
    // Not persisting is acceptable; the current session still uses the settings.
  }
}

export function formatSetting(key: SettingKey, value: number): string {
  if (key === 'fov') return `${Math.round(value)}°`;
  if (key === 'volume') return `${Math.round(value * 100)}%`;
  return `${value.toFixed(1)}×`;
}
