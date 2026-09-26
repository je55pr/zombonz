import { describe, expect, it } from 'vitest';
import { GameSimulation, createInputFrame, damagePlayer, type GameAction } from '../src/core/index.ts';
import { BrowserInput } from '../src/client/input.ts';
import { buildHudSnapshot } from '../src/client/hud.ts';

const wall = { min: { x: 1, y: 0, z: -2 }, max: { x: 2, y: 3, z: 2 } };
function simulation() {
  return new GameSimulation({ seed: 1, playerSpawns: [{ x: 0, y: 0, z: 0 }],
    map: { zombieSpawns: [], collisionBoxes: [wall], walkSurfaces: [
      { minX: -5, maxX: 5, minZ: -5, maxZ: 5, startHeight: 0, endHeight: 0 },
    ] }, roundConfig: { initialWaitTicks: 9999, intermissionTicks: 9999 } });
}
function input(action: GameAction, pressed = true) {
  const frame = createInputFrame(0);
  frame.actions[action] = { held: true, pressed, released: false, value: 1 }; return frame;
}
function send(sim: GameSimulation, action: GameAction, pressed = true) {
  sim.tick({ [sim.playerIds[0]]: input(action, pressed) });
}
describe('G / F debug modes', () => {
  it('restores health and blocks damage until god mode is toggled off', () => {
    const sim = simulation(), player = sim.getPlayer(sim.playerIds[0])!;
    damagePlayer(player, 50);
    send(sim, 'toggleGodMode');
    expect(player.health).toBe(100);
    expect(damagePlayer(player, 500)).toEqual([]);
    expect(player.alive).toBe(true);
    send(sim, 'toggleGodMode', false); // held / key repeat must not toggle again
    expect(player.godMode).toBe(true);
    send(sim, 'toggleGodMode');
    expect(damagePlayer(player, 50)[0]).toMatchObject({ type: 'playerDamaged', health: 50 });
  });

  it('flies through walls and lands where noclip is disabled in clear space', () => {
    const sim = simulation(), player = sim.getPlayer(sim.playerIds[0])!;
    send(sim, 'toggleNoclip');
    for (let i = 0; i < 30; i++) send(sim, 'moveRight');
    expect(player.position.x).toBeCloseTo(3);
    for (let i = 0; i < 10; i++) send(sim, 'flyUp');
    expect(player.position.y).toBeCloseTo(1);
    send(sim, 'toggleNoclip');
    expect(player.position).toEqual({ x: player.position.x, y: 0, z: 0 });
    expect(player.noclip).toBe(false);
    expect(Math.hypot(player.velocity.x, player.velocity.y, player.velocity.z)).toBe(0);
    for (let i = 0; i < 60; i++) send(sim, 'moveLeft');
    expect(player.position.x).toBeGreaterThanOrEqual(2.34);
  });

  it.each(['wall', 'outside', 'underground'])('returns to its anchor when switched off %s', location => {
    const sim = simulation(), player = sim.getPlayer(sim.playerIds[0])!;
    send(sim, 'toggleNoclip');
    player.position = location === 'wall' ? { x: 1.5, y: 0, z: 0 }
      : location === 'outside' ? { x: 20, y: 3, z: 0 } : { x: 0, y: -2, z: 0 };
    send(sim, 'toggleNoclip');
    expect(player.position).toEqual({ x: 0, y: 0, z: 0 });
  });

  it('flies along camera pitch and allows descending independently', () => {
    const sim = simulation(), player = sim.getPlayer(sim.playerIds[0])!;
    send(sim, 'toggleNoclip'); player.pitch = Math.PI / 4;
    send(sim, 'moveForward');
    expect(player.position.y).toBeGreaterThan(0);
    expect(player.position.z).toBeLessThan(0);
    const y = player.position.y; send(sim, 'flyDown');
    expect(player.position.y).toBeLessThan(y);
    expect(player.godMode).toBe(false); // independent modes
  });

  it('surfaces active modes on the HUD and resets both on restart', () => {
    const sim = simulation();
    send(sim, 'toggleGodMode'); send(sim, 'toggleNoclip');
    expect(buildHudSnapshot(sim, sim.playerIds[0])).toMatchObject({ godMode: true, noclip: true });
    sim.restart();
    expect(buildHudSnapshot(sim, sim.playerIds[0])).toMatchObject({ godMode: false, noclip: false });
  });

  it('maps G/F to one toggle per physical press, including browser repeats', () => {
    const target = new EventTarget(), pointer = new EventTarget();
    const browser = new BrowserInput({ pointerElement: pointer as HTMLElement }, target as Window);
    for (const [code, action] of [['KeyG', 'toggleGodMode'], ['KeyF', 'toggleNoclip']] as const) {
      target.dispatchEvent(Object.assign(new Event('keydown'), { code, repeat: false }));
      expect(browser.consume().actions[action]?.pressed).toBe(true);
      target.dispatchEvent(Object.assign(new Event('keydown'), { code, repeat: true }));
      expect(browser.consume().actions[action]?.pressed).toBe(false);
      target.dispatchEvent(Object.assign(new Event('keyup'), { code }));
      browser.consume();
      target.dispatchEvent(Object.assign(new Event('keydown'), { code, repeat: false }));
      expect(browser.consume().actions[action]?.pressed).toBe(true);
    }
    browser.dispose();
  });
  it('releases held input when focus is lost', () => {
    const target = new EventTarget(), pointer = new EventTarget();
    const browser = new BrowserInput({ pointerElement: pointer as HTMLElement }, target as Window);
    target.dispatchEvent(Object.assign(new Event('keydown'), { code: 'KeyW', repeat: false }));
    expect(browser.consume().actions.moveForward?.held).toBe(true);
    target.dispatchEvent(new Event('blur'));
    expect(browser.consume().actions.moveForward).toMatchObject({ held: false, released: true });
    browser.dispose();
  });
});
