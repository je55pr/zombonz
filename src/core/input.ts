export type GameAction =
  | 'moveForward'
  | 'moveBackward'
  | 'moveLeft'
  | 'moveRight'
  | 'fire'
  | 'reload'
  | 'interact'
  | 'restart';

export interface ActionState {
  held: boolean;
  pressed: boolean;
  released: boolean;
  value: number;
}

export interface LookDelta {
  yaw: number;
  pitch: number;
}

export interface InputFrame {
  sequence: number;
  actions: Partial<Record<GameAction, ActionState>>;
  look: LookDelta;
}

export function inactiveAction(): ActionState {
  return { held: false, pressed: false, released: false, value: 0 };
}

export function createInputFrame(sequence: number): InputFrame {
  return { sequence, actions: {}, look: { yaw: 0, pitch: 0 } };
}
