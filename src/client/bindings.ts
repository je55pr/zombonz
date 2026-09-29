import type { GameAction } from '../core/input.ts';

/** Keyboard codes (`KeyboardEvent.code`) that trigger each action. An action may have several. */
export type KeyBindings = Readonly<Partial<Record<GameAction, readonly string[]>>>;

export const DEFAULT_KEY_BINDINGS: KeyBindings = {
  moveForward: ['KeyW'], moveBackward: ['KeyS'], moveLeft: ['KeyA'], moveRight: ['KeyD'],
  sprint: ['ShiftLeft', 'ShiftRight'],
  jump: ['Space'], crouch: ['KeyC'], prone: ['KeyZ'],
  reload: ['KeyR'], interact: ['KeyE'], melee: ['KeyV'], throwGrenade: ['KeyT'], placeMine: ['KeyG'], switchWeapon: ['KeyQ'],
  restart: ['Enter'],
  // Debug modes: fly with K, be invulnerable with L; Space and C move up and down while flying.
  toggleNoclip: ['KeyK'], toggleGodMode: ['KeyL'], flyUp: ['Space'], flyDown: ['KeyC'],
};

export const BINDABLE_ACTIONS: readonly { action: GameAction; label: string }[] = [
  { action: 'moveForward', label: 'Move forward' }, { action: 'moveBackward', label: 'Move backward' },
  { action: 'moveLeft', label: 'Strafe left' }, { action: 'moveRight', label: 'Strafe right' },
  { action: 'jump', label: 'Jump' }, { action: 'crouch', label: 'Crouch' }, { action: 'prone', label: 'Prone' },
  { action: 'sprint', label: 'Sprint' }, { action: 'aim', label: 'Aim' }, { action: 'fire', label: 'Fire' },
  { action: 'reload', label: 'Reload' }, { action: 'melee', label: 'Melee' },
  { action: 'throwGrenade', label: 'Throw grenade' }, { action: 'placeMine', label: 'Place mine' },
  { action: 'switchWeapon', label: 'Switch weapon' }, { action: 'interact', label: 'Interact' },
  { action: 'toggleNoclip', label: 'Toggle fly mode' }, { action: 'toggleGodMode', label: 'Toggle god mode' },
  { action: 'flyUp', label: 'Fly up' }, { action: 'flyDown', label: 'Fly down' },
  { action: 'restart', label: 'Restart' },
];

const STORAGE_KEY = 'zombonz.bindings.v1';
const validCode = (code: unknown): code is string => typeof code === 'string'
  && code !== 'Escape' && code !== 'Unidentified' && /^[A-Za-z][A-Za-z0-9]{0,31}$/.test(code);

export function normalizeBindings(raw: unknown): KeyBindings {
  const values = raw && typeof raw === 'object' ? raw as Record<string, unknown> : {};
  return Object.fromEntries(BINDABLE_ACTIONS.map(({ action }) => {
    const codes = values[action];
    return [action, Array.isArray(codes) ? codes.filter(validCode).slice(0, 2) : [...(DEFAULT_KEY_BINDINGS[action] ?? [])]];
  })) as KeyBindings;
}

export function loadBindings(storage: Pick<Storage, 'getItem'> | undefined = globalThis.localStorage): KeyBindings {
  try { const value = storage?.getItem(STORAGE_KEY); return normalizeBindings(value ? JSON.parse(value) : null); }
  catch { return normalizeBindings(null); }
}

export function saveBindings(bindings: KeyBindings,
  storage: Pick<Storage, 'setItem'> | undefined = globalThis.localStorage): void {
  try { storage?.setItem(STORAGE_KEY, JSON.stringify(normalizeBindings(bindings))); }
  catch { /* Site storage may be unavailable; the current session still keeps the binding. */ }
}

/** Assigning a key transfers it from other actions, avoiding accidental double actions. */
export function rebindKey(bindings: KeyBindings, action: GameAction, code: string): KeyBindings {
  if (!validCode(code)) return bindings;
  const result: Record<string, string[]> = {};
  for (const item of BINDABLE_ACTIONS) result[item.action] = (bindings[item.action] ?? []).filter(key => key !== code);
  result[action] = [code];
  return result as KeyBindings;
}

/** The lookup the input handler uses: which action a key code triggers. */
export function actionsByKey(bindings: KeyBindings): ReadonlyMap<string, readonly GameAction[]> {
  const lookup = new Map<string, GameAction[]>();
  for (const [action, codes] of Object.entries(bindings) as Array<[GameAction, readonly string[]]>) {
    for (const code of codes) lookup.set(code, [...(lookup.get(code) ?? []), action]);
  }
  return lookup;
}

/** A short on-screen name for a key code: `KeyK` is `K`, `ShiftLeft` is `SHIFT`. */
export function keyLabel(code: string): string {
  if (code.startsWith('Key')) return code.slice(3);
  if (code.startsWith('Digit')) return code.slice(5);
  return code.replace(/(Left|Right)$/, '').toUpperCase();
}

/** The label for an action's first key, or `?` if nothing is bound to it. */
export function actionKeyLabel(bindings: KeyBindings, action: GameAction): string {
  const code = bindings[action]?.[0];
  return code ? keyLabel(code) : '?';
}
