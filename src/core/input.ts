export type GameAction =
  | 'moveForward'
  | 'moveBackward'
  | 'moveLeft'
  | 'moveRight'
  | 'fire'
  | 'reload'
  | 'interact';

export interface ActionState {
  held: boolean;
  pressed: boolean;
  released: boolean;
  value: number;
}

export interface InputFrame {
  sequence: number;
  actions: Partial<Record<GameAction, ActionState>>;
}

export function inactiveAction(): ActionState {
  return { held: false, pressed: false, released: false, value: 0 };
}

export function createInputFrame(sequence: number): InputFrame {
  return { sequence, actions: {} };
}
