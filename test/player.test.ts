import { describe, expect, it } from 'vitest';
import {
  PLAYER_MOVEMENT,
  SPRINT_RULES,
  createInputFrame,
  createPlayerState,
  moveWithCollision,
  sampleWalkHeight,
  updatePlayerMovement,
} from '../src/core/index.ts';

const id = 'e:1' as const;

function heldMove(action: 'moveForward' | 'moveRight' | 'sprint' | 'aim') {
  const frame = createInputFrame(1);
  frame.actions[action] = { held: true, pressed: true, released: false, value: 1 };
  return frame;
}

describe('player movement', () => {
  it('jumps from the floor, lands once, and does not double jump', () => {
    const player = createPlayerState(id, { x: 0, y: 0, z: 0 });
    const jump = createInputFrame(1);
    jump.actions.jump = { held: true, pressed: true, released: false, value: 1 };
    updatePlayerMovement(player, jump, 1 / 60, []);
    expect(player.grounded).toBe(false);
    expect(player.position.y).toBeGreaterThan(0);
    const firstVelocity = player.velocity.y;
    updatePlayerMovement(player, jump, 1 / 60, []);
    expect(player.velocity.y).toBeLessThan(firstVelocity);
    for (let i = 0; i < 70; i++) updatePlayerMovement(player, createInputFrame(i + 2), 1 / 60, []);
    expect(player.grounded).toBe(true);
    expect(player.position.y).toBe(0);
  });

  it('uses low collision heights and refuses to stand under a ceiling', () => {
    const player = createPlayerState(id, { x: 0, y: 0, z: 0 });
    const ceiling = [{ min: { x: -1, y: 1.3, z: -1 }, max: { x: 1, y: 2, z: 1 } }];
    const crouch = createInputFrame(1);
    crouch.actions.crouch = { held: true, pressed: true, released: false, value: 1 };
    updatePlayerMovement(player, crouch, 1 / 60, ceiling);
    expect(player.stance).toBe('crouch');
    updatePlayerMovement(player, crouch, 1 / 60, ceiling);
    expect(player.stance).toBe('crouch');
    const prone = createInputFrame(2);
    prone.actions.prone = { held: true, pressed: true, released: false, value: 1 };
    updatePlayerMovement(player, prone, 1 / 60, ceiling);
    expect(player.stance).toBe('prone');
    updatePlayerMovement(player, crouch, 1 / 60, ceiling);
    expect(player.stance).toBe('crouch');
    player.position.x = 2;
    updatePlayerMovement(player, crouch, 1 / 60, ceiling);
    expect(player.stance).toBe('stand');
  });

  it('accelerates forward relative to authoritative yaw', () => {
    const player = createPlayerState(id, { x: 0, y: 0, z: 0 });
    updatePlayerMovement(player, heldMove('moveForward'), 1 / 60, []);
    expect(player.position.z).toBeLessThan(0);
    expect(player.velocity.z).toBeLessThan(0);
  });

  it('clamps authoritative pitch', () => {
    const player = createPlayerState(id, { x: 0, y: 0, z: 0 });
    const frame = createInputFrame(1);
    frame.look.pitch = 99;
    updatePlayerMovement(player, frame, 1 / 60, []);
    expect(player.pitch).toBe(PLAYER_MOVEMENT.maxPitch);
  });

  it('sprints forward faster and returns to walking speed when released', () => {
    const walk = createPlayerState(id, { x: 0, y: 0, z: 0 });
    const run = createPlayerState(id, { x: 0, y: 0, z: 0 });
    const frame = heldMove('moveForward');
    frame.actions.sprint = { held: true, pressed: true, released: false, value: 1 };
    for (let i = 0; i < 60; i++) {
      updatePlayerMovement(walk, heldMove('moveForward'), 1 / 60, []);
      updatePlayerMovement(run, frame, 1 / 60, []);
    }
    expect(run.sprinting).toBe(true);
    expect(run.position.z).toBeLessThan(walk.position.z * 1.4);
    updatePlayerMovement(run, heldMove('moveForward'), 1 / 60, []);
    expect(run.sprinting).toBe(false);
  });

  it('runs out of sprint after about four seconds, then recharges after a short pause', () => {
    const player = createPlayerState(id, { x: 0, y: 0, z: 0 });
    const sprint = heldMove('moveForward');
    sprint.actions.sprint = { held: true, pressed: false, released: false, value: 1 };
    for (let i = 0; i < SPRINT_RULES.maxTicks; i++) updatePlayerMovement(player, sprint, 1 / 60, []);
    expect(player.sprinting).toBe(true);
    updatePlayerMovement(player, sprint, 1 / 60, []);
    expect(player.sprinting).toBe(false);
    expect(player.sprintTicks).toBe(0);

    // Holding sprint while exhausted does not restart it until one second has recharged.
    for (let i = 0; i < SPRINT_RULES.rechargeDelayTicks + SPRINT_RULES.minStartTicks - 1; i++) {
      updatePlayerMovement(player, sprint, 1 / 60, []);
    }
    expect(player.sprinting).toBe(false);
    updatePlayerMovement(player, sprint, 1 / 60, []);
    expect(player.sprinting).toBe(true);
  });

  it('only recharges stamina once the pause after sprinting has passed', () => {
    const player = createPlayerState(id, { x: 0, y: 0, z: 0 });
    const sprint = heldMove('moveForward');
    sprint.actions.sprint = { held: true, pressed: false, released: false, value: 1 };
    for (let i = 0; i < 100; i++) updatePlayerMovement(player, sprint, 1 / 60, []);
    const spent = player.sprintTicks;
    for (let i = 0; i < SPRINT_RULES.rechargeDelayTicks; i++) updatePlayerMovement(player, heldMove('moveForward'), 1 / 60, []);
    expect(player.sprintTicks).toBe(spent);
    for (let i = 0; i < 1000; i++) updatePlayerMovement(player, heldMove('moveForward'), 1 / 60, []);
    expect(player.sprintTicks).toBe(SPRINT_RULES.maxTicks);
  });

  it('aiming slows movement and wins over sprint; firing cancels sprint', () => {
    const player = createPlayerState(id, { x: 0, y: 0, z: 0 });
    const frame = heldMove('moveForward');
    frame.actions.aim = { held: true, pressed: true, released: false, value: 1 };
    frame.actions.sprint = { held: true, pressed: true, released: false, value: 1 };
    for (let i = 0; i < 60; i++) updatePlayerMovement(player, frame, 1 / 60, []);
    expect(player.aiming).toBe(true);
    expect(player.sprinting).toBe(false);
    expect(Math.abs(player.position.z)).toBeLessThan(PLAYER_MOVEMENT.maxSpeed * 0.7);
    frame.actions.aim.held = false;
    frame.actions.fire = { held: true, pressed: true, released: false, value: 1 };
    updatePlayerMovement(player, frame, 1 / 60, []);
    expect(player.sprinting).toBe(false);
    frame.actions.fire.held = false;
    frame.actions.fire.pressed = false;
    updatePlayerMovement(player, frame, 1 / 60, []);
    expect(player.sprinting).toBe(true);
    frame.actions.aim.held = true;
    frame.actions.sprint.held = false;
    player.weapon.reloadTicksRemaining = 10;
    updatePlayerMovement(player, frame, 1 / 60, []);
    expect(player.aiming).toBe(false);
    player.weapon.reloadTicksRemaining = 0;
    frame.actions.toggleNoclip = { held: true, pressed: true, released: false, value: 1 };
    updatePlayerMovement(player, frame, 1 / 60, []);
    expect(player.aiming).toBe(false);
    expect(player.sprinting).toBe(false);
  });

  it('stops at collision boxes instead of passing through them', () => {
    const next = moveWithCollision(
      { x: 0, y: 0, z: 0 },
      { x: 2, y: 0, z: 0 },
      0.34,
      1.78,
      [{ min: { x: 1, y: 0, z: -1 }, max: { x: 2, y: 2, z: 1 } }],
    );
    expect(next.x).toBeCloseTo(0.66, 6);
  });

  it('samples ramps and upper floors deterministically', () => {
    const surfaces = [
      { minX: 0, maxX: 2, minZ: 0, maxZ: 1, startHeight: 0, endHeight: 2, slopeAxis: 'x' as const },
      { minX: 0, maxX: 4, minZ: 0, maxZ: 4, startHeight: 2, endHeight: 2 },
    ];
    expect(sampleWalkHeight(1, 0.5, 0, surfaces, 1.1)).toBe(1);
    expect(sampleWalkHeight(3, 2, 2, surfaces)).toBe(2);
  });
});
