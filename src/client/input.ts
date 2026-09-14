import type { ActionState, GameAction, InputFrame } from '../core/input.ts';

const KEY_ACTIONS: Partial<Record<string, GameAction>> = {
  KeyW: 'moveForward', KeyS: 'moveBackward', KeyA: 'moveLeft', KeyD: 'moveRight',
  KeyR: 'reload', KeyE: 'interact',
};

export interface BrowserInputOptions {
  pointerElement: HTMLElement;
  lookSensitivity?: number;
}

export class BrowserInput {
  private held = new Set<GameAction>();
  private pressed = new Set<GameAction>();
  private released = new Set<GameAction>();
  private sequence = 0;
  private lookYaw = 0;
  private lookPitch = 0;
  private lookSensitivity: number;

  constructor(
    private readonly options: BrowserInputOptions,
    private readonly target: Window = window,
  ) {
    this.lookSensitivity = options.lookSensitivity ?? 0.0022;
    target.addEventListener('keydown', this.onKeyDown);
    target.addEventListener('keyup', this.onKeyUp);
    target.addEventListener('mousedown', this.onMouseDown);
    target.addEventListener('mouseup', this.onMouseUp);
    target.addEventListener('mousemove', this.onMouseMove);
    options.pointerElement.addEventListener('click', this.onPointerClick);
  }

  setSensitivity(value: number): void {
    if (!Number.isFinite(value) || value <= 0) throw new RangeError('Sensitivity must be positive.');
    this.lookSensitivity = value;
  }

  private onPointerClick = () => {
    if (document.pointerLockElement !== this.options.pointerElement) {
      void this.options.pointerElement.requestPointerLock();
    }
  };

  private onMouseMove = (event: MouseEvent) => {
    if (document.pointerLockElement !== this.options.pointerElement) return;
    this.lookYaw -= event.movementX * this.lookSensitivity;
    this.lookPitch -= event.movementY * this.lookSensitivity;
  };

  private onKeyDown = (event: KeyboardEvent) => this.set(KEY_ACTIONS[event.code], true, event.repeat);
  private onKeyUp = (event: KeyboardEvent) => this.set(KEY_ACTIONS[event.code], false, false);
  private onMouseDown = (event: MouseEvent) => event.button === 0
    && document.pointerLockElement === this.options.pointerElement
    && this.set('fire', true, false);
  private onMouseUp = (event: MouseEvent) => event.button === 0 && this.set('fire', false, false);

  private set(action: GameAction | undefined, down: boolean, repeat: boolean): boolean {
    if (!action) return false;
    if (down) {
      if (!repeat && !this.held.has(action)) this.pressed.add(action);
      this.held.add(action);
    } else if (this.held.delete(action)) {
      this.released.add(action);
    }
    return true;
  }

  consume(): InputFrame {
    const actions: Partial<Record<GameAction, ActionState>> = {};
    const all = new Set([...this.held, ...this.pressed, ...this.released]);
    for (const action of all) {
      actions[action] = {
        held: this.held.has(action), pressed: this.pressed.has(action),
        released: this.released.has(action), value: this.held.has(action) ? 1 : 0,
      };
    }
    const frame = { sequence: this.sequence++, actions, look: { yaw: this.lookYaw, pitch: this.lookPitch } };
    this.pressed.clear(); this.released.clear(); this.lookYaw = 0; this.lookPitch = 0;
    return frame;
  }

  dispose(): void {
    this.target.removeEventListener('keydown', this.onKeyDown);
    this.target.removeEventListener('keyup', this.onKeyUp);
    this.target.removeEventListener('mousedown', this.onMouseDown);
    this.target.removeEventListener('mouseup', this.onMouseUp);
    this.target.removeEventListener('mousemove', this.onMouseMove);
    this.options.pointerElement.removeEventListener('click', this.onPointerClick);
  }
}
