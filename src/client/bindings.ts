import type { GameAction } from '../core/input.ts';

/** Keyboard codes (`KeyboardEvent.code`) that trigger each action. An action may have several. */
export type KeyBindings = Readonly<Partial<Record<GameAction, readonly string[]>>>;

export const DEFAULT_KEY_BINDINGS: KeyBindings = {
  moveForward: ['KeyW'], moveBackward: ['KeyS'], moveLeft: ['KeyA'], moveRight: ['KeyD'],
  sprint: ['ShiftLeft', 'ShiftRight'],
  reload: ['KeyR'], interact: ['KeyE'], melee: ['KeyV'], throwGrenade: ['KeyT'], placeMine: ['KeyG'], switchWeapon: ['KeyQ'],
  restart: ['Enter'],
  // Debug modes: fly with K, be invulnerable with L; Space and C move up and down while flying.
  toggleNoclip: ['KeyK'], toggleGodMode: ['KeyL'], flyUp: ['Space'], flyDown: ['KeyC'],
};

/** The lookup the input handler uses: which action a key code triggers. */
export function actionsByKey(bindings: KeyBindings): ReadonlyMap<string, GameAction> {
  const lookup = new Map<string, GameAction>();
  for (const [action, codes] of Object.entries(bindings) as Array<[GameAction, readonly string[]]>) {
    for (const code of codes) lookup.set(code, action);
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
