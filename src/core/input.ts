export type GameAction =
  | 'moveForward'
  | 'moveBackward'
  | 'moveLeft'
  | 'moveRight'
  | 'sprint'
  | 'jump'
  | 'crouch'
  | 'prone'
  /** Internal control sent while an online player has the pause menu open. */
  | 'cancelGrenade'
  | 'aim'
  | 'fire'
  | 'reload'
  | 'melee'
  | 'throwGrenade'
  | 'placeMine'
  | 'switchWeapon'
  | 'interact'
  | 'toggleGodMode'
  | 'toggleNoclip'
  | 'flyUp'
  | 'flyDown'
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
