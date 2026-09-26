import { describe, expect, it, vi } from 'vitest';
import { SoloPauseController } from '../src/client/pause.ts';
import { BrowserInput } from '../src/client/input.ts';

describe('solo pause', () => {
  it('pauses on Escape, blur and pointer unlock; resumes only on a visible canvas click', () => {
    const target = new EventTarget(), surface = new EventTarget();
    const page = Object.assign(new EventTarget(), { hidden: false,
      pointerLockElement: surface as EventTarget | null });
    const changed = vi.fn();
    const pause = new SoloPauseController(surface as HTMLElement, target as Window,
      page as Document, changed);
    target.dispatchEvent(Object.assign(new Event('keydown'), { code: 'Escape', repeat: false }));
    expect(pause.paused).toBe(true);
    expect(changed).toHaveBeenCalledTimes(1);
    surface.dispatchEvent(new Event('pointerdown'));
    expect(pause.paused).toBe(false);
    target.dispatchEvent(new Event('blur'));
    expect(pause.paused).toBe(true);
    page.hidden = true; page.dispatchEvent(new Event('visibilitychange'));
    surface.dispatchEvent(new Event('pointerdown'));
    expect(pause.paused).toBe(true);
    page.hidden = false; surface.dispatchEvent(new Event('pointerdown'));
    expect(pause.paused).toBe(false);
    page.pointerLockElement = null; page.dispatchEvent(new Event('pointerlockchange'));
    expect(pause.paused).toBe(true);
    pause.dispose();
    surface.dispatchEvent(new Event('pointerdown'));
    expect(pause.paused).toBe(true);
  });

  it('keeps development previews unpaused when pointer lock is unavailable', () => {
    const target = new EventTarget(), surface = new EventTarget();
    const page = Object.assign(new EventTarget(), { hidden: false, pointerLockElement: null });
    const pause = new SoloPauseController(surface as HTMLElement, target as Window,
      page as Document, () => {}, false);
    page.dispatchEvent(new Event('pointerlockchange'));
    expect(pause.paused).toBe(false);
    pause.dispose();
  });

  it('does not trap the game-over screen behind a pause overlay', () => {
    const target = new EventTarget(), surface = new EventTarget(), page = new EventTarget();
    const pause = new SoloPauseController(surface as HTMLElement, target as Window,
      page as Document, () => {}, true, () => false);
    target.dispatchEvent(Object.assign(new Event('keydown'), { code: 'Escape', repeat: false }));
    expect(pause.paused).toBe(false);
    pause.dispose();
  });

  it('clears queued movement and firing before resuming', () => {
    const target = new EventTarget(), surface = new EventTarget();
    const input = new BrowserInput({ pointerElement: surface as HTMLElement }, target as Window);
    target.dispatchEvent(Object.assign(new Event('keydown'), { code: 'KeyW', repeat: false }));
    target.dispatchEvent(Object.assign(new Event('keydown'), { code: 'KeyG', repeat: false }));
    input.clear();
    expect(input.consume().actions).toEqual({});
    input.dispose();
  });
});
