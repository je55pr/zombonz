import { afterEach, describe, expect, it, vi } from 'vitest';
import { BrowserInput } from '../src/client/input.ts';
import { DEFAULT_KEY_BINDINGS, actionKeyLabel, actionsByKey, keyLabel } from '../src/client/bindings.ts';

afterEach(() => vi.unstubAllGlobals());

function setup(options: { locked?: boolean; bindings?: Parameters<typeof actionsByKey>[0] } = {}) {
  const target = new EventTarget(), pointer = new EventTarget();
  vi.stubGlobal('document', { pointerLockElement: options.locked === false ? null : pointer,
    addEventListener: vi.fn(), removeEventListener: vi.fn() });
  const input = new BrowserInput({ pointerElement: pointer as HTMLElement, bindings: options.bindings }, target as Window);
  const key = (code: string, type: 'keydown' | 'keyup' = 'keydown') =>
    target.dispatchEvent(Object.assign(new Event(type), { code, repeat: false }));
  /** A wheel tick at a chosen time, since the input handler spaces flicks by the event's own timestamp. */
  const wheel = (at: number, deltaY = 100) => {
    const event = Object.assign(new Event('wheel'), { deltaY });
    Object.defineProperty(event, 'timeStamp', { value: at });
    target.dispatchEvent(event);
  };
  return { input, key, wheel };
}

describe('key bindings', () => {
  it('binds fly to K and god mode to L, with Space and C to move while flying', () => {
    expect(DEFAULT_KEY_BINDINGS.toggleNoclip).toEqual(['KeyK']);
    expect(DEFAULT_KEY_BINDINGS.toggleGodMode).toEqual(['KeyL']);
    const { input, key } = setup();
    key('KeyG'); key('KeyF');
    expect(input.consume().actions).toEqual({});
    key('KeyK'); key('KeyL'); key('Space'); key('KeyC');
    expect(Object.keys(input.consume().actions).sort()).toEqual(['flyDown', 'flyUp', 'toggleGodMode', 'toggleNoclip']);
    input.dispose();
  });

  it('follows rebound keys instead of the defaults', () => {
    const { input, key } = setup({ bindings: { ...DEFAULT_KEY_BINDINGS, toggleGodMode: ['KeyG'], toggleNoclip: [] } });
    key('KeyL'); key('KeyK');
    expect(input.consume().actions).toEqual({});
    key('KeyG');
    expect(input.consume().actions.toggleGodMode?.pressed).toBe(true);
    input.setBindings(DEFAULT_KEY_BINDINGS);
    key('KeyK', 'keydown');
    expect(input.consume().actions.toggleNoclip?.pressed).toBe(true);
    input.dispose();
  });

  it('names keys for the HUD', () => {
    expect(keyLabel('KeyK')).toBe('K');
    expect(keyLabel('Digit4')).toBe('4');
    expect(keyLabel('ShiftLeft')).toBe('SHIFT');
    expect(keyLabel('Space')).toBe('SPACE');
    expect(actionKeyLabel(DEFAULT_KEY_BINDINGS, 'toggleGodMode')).toBe('L');
    expect(actionKeyLabel({}, 'toggleGodMode')).toBe('?');
  });
});

describe('mouse wheel', () => {
  it('swaps weapons once per flick, in either direction', () => {
    const { input, wheel } = setup();
    wheel(1000, 100);
    expect(input.consume().actions.switchWeapon).toMatchObject({ pressed: true, held: false });
    wheel(2000, -100);
    expect(input.consume().actions.switchWeapon?.pressed).toBe(true);
    input.dispose();
  });

  it('treats a burst of wheel ticks as one swap, then swaps again once it settles', () => {
    const { input, wheel } = setup();
    wheel(1000); wheel(1040); wheel(1080); wheel(1120);
    expect(input.consume().actions.switchWeapon?.pressed).toBe(true);
    wheel(1150);
    expect(input.consume().actions.switchWeapon).toBeUndefined();
    wheel(1400);
    expect(input.consume().actions.switchWeapon?.pressed).toBe(true);
    input.dispose();
  });

  it('ignores the wheel while the pointer is not captured, and Q still swaps', () => {
    const { input, wheel, key } = setup({ locked: false });
    wheel(1000);
    expect(input.consume().actions.switchWeapon).toBeUndefined();
    key('KeyQ');
    expect(input.consume().actions.switchWeapon?.pressed).toBe(true);
    input.dispose();
  });
});
