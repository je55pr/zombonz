import { afterEach, describe, expect, it, vi } from 'vitest';
import { ADS_LOOK_SCALE } from '../src/client/aim.ts';
import { BrowserInput } from '../src/client/input.ts';

describe('looking around while aiming', () => {
  const pointer = new EventTarget() as unknown as HTMLElement;
  afterEach(() => vi.unstubAllGlobals());

  /** A BrowserInput with pointer lock "on", and a helper that moves the mouse and reads back how far the view turned. */
  function rig(lookScale?: () => number) {
    vi.stubGlobal('document', { pointerLockElement: pointer, addEventListener: () => {}, removeEventListener: () => {}, hidden: false });
    const target = new EventTarget();
    const input = new BrowserInput({ pointerElement: pointer, lookSensitivity: 0.002, lookScale }, target as unknown as Window);
    const move = (dx: number, dy: number) => target.dispatchEvent(Object.assign(new Event('mousemove'), { movementX: dx, movementY: dy }));
    return { input, move };
  }

  it('slows the view to 0.7 of its speed', () => {
    expect(ADS_LOOK_SCALE).toBe(0.7);
    let aiming = false;
    const { input, move } = rig(() => aiming ? ADS_LOOK_SCALE : 1);
    move(100, -50);
    const hip = input.consume().look;
    aiming = true;
    move(100, -50);
    const aimed = input.consume().look;
    expect(hip.yaw).toBeCloseTo(-0.2, 9);
    expect(hip.pitch).toBeCloseTo(0.1, 9);
    expect(aimed.yaw).toBeCloseTo(hip.yaw * 0.7, 9);
    expect(aimed.pitch).toBeCloseTo(hip.pitch * 0.7, 9);
  });

  it('applies whichever scale is in force as each movement happens, not when the frame is read', () => {
    let aiming = false;
    const { input, move } = rig(() => aiming ? ADS_LOOK_SCALE : 1);
    move(100, 0);
    aiming = true;
    move(100, 0);
    expect(input.consume().look.yaw).toBeCloseTo(-0.2 - 0.2 * 0.7, 9);
  });

  it('is unchanged when nothing scales it', () => {
    const { input, move } = rig();
    move(100, 0);
    expect(input.pendingLook().yaw).toBeCloseTo(-0.2, 9);
  });
});
