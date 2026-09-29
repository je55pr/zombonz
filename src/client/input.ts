import type { ActionState, GameAction, InputFrame } from '../core/input.ts';
import { DEFAULT_KEY_BINDINGS, actionsByKey, type KeyBindings } from './bindings.ts';

/** Wheel ticks closer together than this count as one flick, so a free-spinning wheel swaps once. */
const WHEEL_SWITCH_GAP_MS = 180;

export interface BrowserInputOptions {
  pointerElement: HTMLElement;
  lookSensitivity?: number;
  previewFireKey?: boolean;
  /** Which keys trigger which actions; the defaults if omitted. */
  bindings?: KeyBindings;
}

export class BrowserInput {
  private held = new Set<GameAction>();
  private pressed = new Set<GameAction>();
  private released = new Set<GameAction>();
  private sequence = 0;
  private lookYaw = 0;
  private lookPitch = 0;
  private lookSensitivity: number;
  private keyActions: ReadonlyMap<string, readonly GameAction[]>;
  private lastWheelSwitch = -Infinity;

  constructor(
    private readonly options: BrowserInputOptions,
    private readonly target: Window = window,
  ) {
    this.lookSensitivity = options.lookSensitivity ?? 0.0022;
    this.keyActions = actionsByKey(options.bindings ?? DEFAULT_KEY_BINDINGS);
    target.addEventListener('keydown', this.onKeyDown);
    target.addEventListener('keyup', this.onKeyUp);
    target.addEventListener('mousedown', this.onMouseDown);
    target.addEventListener('mouseup', this.onMouseUp);
    target.addEventListener('mousemove', this.onMouseMove);
    target.addEventListener('wheel', this.onWheel);
    target.addEventListener('blur', this.onBlur);
    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', this.onVisibilityChange);
      document.addEventListener('pointerlockchange', this.onPointerLockChange);
    }
    options.pointerElement.addEventListener('click', this.onPointerClick);
    options.pointerElement.addEventListener('contextmenu', this.onContextMenu);
  }

  /** Applies new key bindings and clears any action held under the old mapping. */
  setBindings(bindings: KeyBindings): void {
    this.clear();
    this.keyActions = actionsByKey(bindings);
  }

  setSensitivity(value: number): void {
    if (!Number.isFinite(value) || value <= 0) throw new RangeError('Sensitivity must be positive.');
    this.lookSensitivity = value;
  }

  private onPointerClick = () => {
    if (document.pointerLockElement !== this.options.pointerElement) {
      void this.options.pointerElement.requestPointerLock().catch(() => { /* Embedded previews may deny pointer lock. */ });
    }
  };
  private onContextMenu = (event: Event) => event.preventDefault();

  private releaseHeld(): void {
    for (const action of this.held) this.released.add(action);
    this.held.clear(); this.pressed.clear();
    this.lookYaw = 0; this.lookPitch = 0;
  }

  clear(): void {
    this.held.clear(); this.pressed.clear(); this.released.clear();
    this.lookYaw = 0; this.lookPitch = 0;
  }

  private onBlur = () => this.releaseHeld();
  private onVisibilityChange = () => { if (document.hidden) this.releaseHeld(); };
  private onPointerLockChange = () => { if (document.pointerLockElement !== this.options.pointerElement) this.releaseHeld(); };

  private onMouseMove = (event: MouseEvent) => {
    if (document.pointerLockElement !== this.options.pointerElement) return;
    this.lookYaw -= event.movementX * this.lookSensitivity;
    this.lookPitch -= event.movementY * this.lookSensitivity;
  };

  private actionsForKey(code: string): readonly GameAction[] {
    return code === 'KeyP' && this.options.previewFireKey ? ['fire'] : this.keyActions.get(code) ?? [];
  }
  private onKeyDown = (event: KeyboardEvent) => { for (const action of this.actionsForKey(event.code)) this.set(action, true, event.repeat); };
  private onKeyUp = (event: KeyboardEvent) => { for (const action of this.actionsForKey(event.code)) this.set(action, false, false); };
  private onMouseDown = (event: MouseEvent) => {
    if (document.pointerLockElement !== this.options.pointerElement) return;
    if (event.button === 0) this.set('fire', true, false);
    if (event.button === 2) this.set('aim', true, false);
    if (event.button === 1) this.set('throwGrenade', true, false);
  };
  /**
   * Either way of the wheel swaps weapons. The inventory holds two guns, so there is no direction to
   * pick; a longer one would want to cycle by the sign of `deltaY`.
   */
  private onWheel = (event: WheelEvent) => {
    if (document.pointerLockElement !== this.options.pointerElement) return;
    if (event.timeStamp - this.lastWheelSwitch < WHEEL_SWITCH_GAP_MS) return;
    this.lastWheelSwitch = event.timeStamp;
    // A wheel has no held state: it is a press and release at once.
    this.set('switchWeapon', true, false);
    this.set('switchWeapon', false, false);
  };
  private onMouseUp = (event: MouseEvent) => {
    if (event.button === 0) this.set('fire', false, false);
    if (event.button === 2) this.set('aim', false, false);
    if (event.button === 1) this.set('throwGrenade', false, false);
  };

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

  pendingLook(): InputFrame['look'] {
    return { yaw: this.lookYaw, pitch: this.lookPitch };
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
    this.target.removeEventListener('wheel', this.onWheel);
    this.target.removeEventListener('blur', this.onBlur);
    if (typeof document !== 'undefined') {
      document.removeEventListener('visibilitychange', this.onVisibilityChange);
      document.removeEventListener('pointerlockchange', this.onPointerLockChange);
    }
    this.options.pointerElement.removeEventListener('click', this.onPointerClick);
    this.options.pointerElement.removeEventListener('contextmenu', this.onContextMenu);
  }
}
