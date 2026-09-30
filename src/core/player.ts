import type { CollisionBox, WalkSurface } from './collision.ts';
import { moveWithCollision, sampleWalkHeight, walkSurfaceHeight } from './collision.ts';
import type { InputFrame } from './input.ts';
import type { EntityId, PlayerState, Vec3 } from './types.ts';
import { GRENADE_RULES } from './grenade.ts';
import { createStarterWeaponState } from './weapon.ts';

export const PLAYER_MOVEMENT = {
  maxSpeed: 4.0,
  sprintMultiplier: 1.5,
  aimMultiplier: 0.65,
  acceleration: 22,
  deceleration: 28,
  radius: 0.34,
  height: 1.78,
  eyeHeight: 1.62,
  crouchHeight: 1.12,
  crouchEyeHeight: 1.02,
  proneHeight: 0.55,
  proneEyeHeight: 0.43,
  crouchMultiplier: 0.64,
  proneMultiplier: 0.34,
  jumpSpeed: 5.2,
  gravity: 14,
  maxPitch: Math.PI * 0.47,
} as const;

/** WaW/BO1 sprint: about four seconds, a short pause, then recharge; an exhausted player needs one second back. */
export const SPRINT_RULES = {
  maxTicks: 240,
  rechargeDelayTicks: 30,
  rechargePerTick: 1,
  minStartTicks: 60,
} as const;

export function createPlayerState(id: EntityId, position: Vec3, startingPoints = 500): PlayerState {
  return {
    id,
    kind: 'player',
    position: { ...position },
    velocity: { x: 0, y: 0, z: 0 },
    yaw: 0,
    pitch: 0,
    sprinting: false,
    stance: 'stand',
    grounded: true,
    grenadeWindupTicks: 0,
    sprintTicks: SPRINT_RULES.maxTicks,
    sprintRechargeDelayTicks: 0,
    aiming: false,
    spreadBloom: 0,
    health: 100,
    recoveryDelayTicks: 0,
    meleeCooldownTicks: 0,
    meleeStrikeTicks: 0,
    hurtGraceTicks: 0,
    grenadeCharges: GRENADE_RULES.starting,
    mineCharges: 0,
    bouncingBettyOwned: false,
    repairRewardRound: 0,
    repairPointsEarned: 0,
    points: startingPoints,
    pointsEarned: startingPoints,
    kills: 0,
    headshots: 0,
    weapon: createStarterWeaponState(),
    holsteredWeapon: null,
    switchTicksRemaining: 0,
    perks: [],
    downed: null,
    selfRevives: 0,
    godMode: false,
    noclip: false,
    noclipAnchor: null,
    alive: true,
  };
}

function moveToward(current: number, target: number, maxDelta: number): number {
  if (current < target) return Math.min(current + maxDelta, target);
  if (current > target) return Math.max(current - maxDelta, target);
  return target || 0; // Canonical zero survives JSON snapshots without a -0 distinction.
}

function held(frame: InputFrame, action: keyof InputFrame['actions']): number {
  return frame.actions[action]?.held ? 1 : 0;
}

export function playerHeight(player: PlayerState): number {
  return player.stance === 'prone' ? PLAYER_MOVEMENT.proneHeight
    : player.stance === 'crouch' ? PLAYER_MOVEMENT.crouchHeight : PLAYER_MOVEMENT.height;
}

export function playerEyeHeight(player: PlayerState): number {
  return player.stance === 'prone' ? PLAYER_MOVEMENT.proneEyeHeight
    : player.stance === 'crouch' ? PLAYER_MOVEMENT.crouchEyeHeight : PLAYER_MOVEMENT.eyeHeight;
}

function canOccupy(player: PlayerState, height: number, boxes: readonly CollisionBox[]): boolean {
  return !boxes.some(box => player.position.x + PLAYER_MOVEMENT.radius > box.min.x
    && player.position.x - PLAYER_MOVEMENT.radius < box.max.x
    && player.position.z + PLAYER_MOVEMENT.radius > box.min.z
    && player.position.z - PLAYER_MOVEMENT.radius < box.max.z
    && player.position.y < box.max.y && player.position.y + height > box.min.y);
}

function floorBelow(x: number, z: number, feet: number, surfaces: readonly WalkSurface[]): number {
  let floor = 0;
  for (const surface of surfaces) {
    const height = walkSurfaceHeight(surface, x, z);
    if (height !== undefined && height <= feet + 0.45 && height > floor) floor = height;
  }
  return floor;
}

function tickSprintStamina(player: PlayerState): void {
  if (player.sprinting) {
    player.sprintTicks -= 1;
    player.sprintRechargeDelayTicks = SPRINT_RULES.rechargeDelayTicks;
  } else if (player.sprintRechargeDelayTicks > 0) {
    player.sprintRechargeDelayTicks -= 1;
  } else {
    player.sprintTicks = Math.min(SPRINT_RULES.maxTicks, player.sprintTicks + SPRINT_RULES.rechargePerTick);
  }
}

function exitNoclip(player: PlayerState, boxes: readonly CollisionBox[], surfaces: readonly WalkSurface[]): void {
  const candidate = { ...player.position };
  candidate.y = sampleWalkHeight(candidate.x, candidate.z, candidate.y, surfaces);
  const supported = surfaces.length === 0 || surfaces.some(surface =>
    candidate.x >= surface.minX && candidate.x <= surface.maxX
    && candidate.z >= surface.minZ && candidate.z <= surface.maxZ
    && Math.abs(sampleWalkHeight(candidate.x, candidate.z, Number.POSITIVE_INFINITY, [surface]) - candidate.y) < 1e-5);
  const blocked = boxes.some(box => candidate.x + PLAYER_MOVEMENT.radius > box.min.x
    && candidate.x - PLAYER_MOVEMENT.radius < box.max.x
    && candidate.z + PLAYER_MOVEMENT.radius > box.min.z && candidate.z - PLAYER_MOVEMENT.radius < box.max.z
    && candidate.y < box.max.y && candidate.y + playerHeight(player) > box.min.y);
  player.position = supported && !blocked ? candidate : { ...(player.noclipAnchor ?? candidate) };
  player.noclip = false; player.noclipAnchor = null;
  player.velocity = { x: 0, y: 0, z: 0 };
  player.grounded = true;
}

export function updatePlayerMovement(
  player: PlayerState,
  frame: InputFrame,
  deltaSeconds: number,
  collisionBoxes: readonly CollisionBox[],
  walkSurfaces: readonly WalkSurface[] = [],
  exitBlockers: readonly CollisionBox[] = collisionBoxes,
): void {
  if (frame.actions.toggleGodMode?.pressed) {
    player.godMode = !player.godMode;
    if (player.godMode) player.health = 100;
  }
  if (frame.actions.toggleNoclip?.pressed) {
    if (player.noclip) exitNoclip(player, exitBlockers, walkSurfaces);
    else {
      player.noclip = true; player.noclipAnchor = { ...player.position };
      player.velocity = { x: 0, y: 0, z: 0 };
    }
  }
  if (!player.noclip) {
    let target = player.stance;
    if (frame.actions.prone?.pressed) target = target === 'prone' ? 'crouch' : 'prone';
    else if (frame.actions.crouch?.pressed) target = target === 'crouch' ? 'stand' : 'crouch';
    if (frame.actions.jump?.pressed && player.grounded && target !== 'stand') target = 'stand';
    const height = target === 'stand' ? PLAYER_MOVEMENT.height
      : target === 'crouch' ? PLAYER_MOVEMENT.crouchHeight : PLAYER_MOVEMENT.proneHeight;
    if (height <= playerHeight(player) || canOccupy(player, height, collisionBoxes)) player.stance = target;
    if (frame.actions.jump?.pressed && player.grounded && player.stance === 'stand') {
      player.velocity.y = PLAYER_MOVEMENT.jumpSpeed;
      player.grounded = false;
    }
  }
  player.yaw += frame.look.yaw;
  player.pitch = Math.max(-PLAYER_MOVEMENT.maxPitch, Math.min(
    PLAYER_MOVEMENT.maxPitch,
    player.pitch + frame.look.pitch,
  ));

  const forwardInput = held(frame, 'moveForward') - held(frame, 'moveBackward');
  const rightInput = held(frame, 'moveRight') - held(frame, 'moveLeft');
  player.aiming = !player.noclip && held(frame, 'aim') > 0
    && player.weapon.reloadTicksRemaining === 0 && player.switchTicksRemaining === 0
    && player.meleeCooldownTicks === 0 && !frame.actions.reload?.pressed
    && !frame.actions.switchWeapon?.pressed && !frame.actions.melee?.pressed
    && !frame.actions.throwGrenade?.pressed && player.grenadeWindupTicks === 0;
  player.sprinting = !player.noclip && player.stance === 'stand' && held(frame, 'sprint') > 0 && forwardInput > 0
    && !player.aiming && !frame.actions.fire?.held && !frame.actions.fire?.pressed
    && !frame.actions.reload?.pressed && !frame.actions.switchWeapon?.pressed
    && !frame.actions.melee?.pressed && !frame.actions.throwGrenade?.pressed && player.grenadeWindupTicks === 0
    && player.weapon.reloadTicksRemaining === 0
    && player.switchTicksRemaining === 0 && player.meleeCooldownTicks === 0
    && player.sprintTicks >= (player.sprinting ? 1 : SPRINT_RULES.minStartTicks);
  tickSprintStamina(player);
  if (player.noclip) {
    const cp = Math.cos(player.pitch), sp = Math.sin(player.pitch);
    const sy = Math.sin(player.yaw), cy = Math.cos(player.yaw);
    const direction = {
      x: -sy * cp * forwardInput + cy * rightInput,
      y: sp * forwardInput + held(frame, 'flyUp') - held(frame, 'flyDown'),
      z: -cy * cp * forwardInput - sy * rightInput,
    };
    const scale = 6 / Math.max(1, Math.hypot(direction.x, direction.y, direction.z));
    player.velocity = { x: direction.x * scale, y: direction.y * scale, z: direction.z * scale };
    player.position = { x: player.position.x + player.velocity.x * deltaSeconds,
      y: player.position.y + player.velocity.y * deltaSeconds,
      z: player.position.z + player.velocity.z * deltaSeconds };
    return;
  }
  const magnitude = Math.hypot(forwardInput, rightInput);
  const normalizedForward = magnitude > 1 ? forwardInput / magnitude : forwardInput;
  const normalizedRight = magnitude > 1 ? rightInput / magnitude : rightInput;

  const sin = Math.sin(player.yaw);
  const cos = Math.cos(player.yaw);
  const speed = PLAYER_MOVEMENT.maxSpeed * (player.stance === 'prone' ? PLAYER_MOVEMENT.proneMultiplier
    : player.stance === 'crouch' ? PLAYER_MOVEMENT.crouchMultiplier
      : player.sprinting ? PLAYER_MOVEMENT.sprintMultiplier : player.aiming ? PLAYER_MOVEMENT.aimMultiplier : 1);
  const desiredX = (-sin * normalizedForward + cos * normalizedRight) * speed;
  const desiredZ = (-cos * normalizedForward - sin * normalizedRight) * speed;
  const moving = magnitude > 0;
  const rate = (moving ? PLAYER_MOVEMENT.acceleration : PLAYER_MOVEMENT.deceleration) * deltaSeconds;
  player.velocity.x = moveToward(player.velocity.x, desiredX, rate);
  player.velocity.z = moveToward(player.velocity.z, desiredZ, rate);

  const requested = {
    x: player.velocity.x * deltaSeconds,
    y: 0,
    z: player.velocity.z * deltaSeconds,
  };
  const next = moveWithCollision(
    player.position,
    requested,
    PLAYER_MOVEMENT.radius,
    playerHeight(player),
    collisionBoxes,
  );
  const floor = floorBelow(next.x, next.z, player.position.y, walkSurfaces);
  if (player.grounded && floor >= player.position.y - 0.46) next.y = floor;
  else {
    player.grounded = false;
    const previousTop = player.position.y + playerHeight(player);
    player.velocity.y -= PLAYER_MOVEMENT.gravity * deltaSeconds;
    next.y = player.position.y + player.velocity.y * deltaSeconds;
    if (player.velocity.y > 0 && collisionBoxes.some(box => next.x + PLAYER_MOVEMENT.radius > box.min.x
      && next.x - PLAYER_MOVEMENT.radius < box.max.x && next.z + PLAYER_MOVEMENT.radius > box.min.z
      && next.z - PLAYER_MOVEMENT.radius < box.max.z && previousTop <= box.min.y
      && next.y + playerHeight(player) > box.min.y)) {
      next.y = Math.min(next.y, Math.min(...collisionBoxes.filter(box => next.x + PLAYER_MOVEMENT.radius > box.min.x
        && next.x - PLAYER_MOVEMENT.radius < box.max.x && next.z + PLAYER_MOVEMENT.radius > box.min.z
        && next.z - PLAYER_MOVEMENT.radius < box.max.z && previousTop <= box.min.y).map(box => box.min.y)) - playerHeight(player));
      player.velocity.y = 0;
    }
    if (player.velocity.y <= 0 && next.y <= floor) { next.y = floor; player.velocity.y = 0; player.grounded = true; }
  }

  if (Math.abs((next.x - player.position.x) - requested.x) > 1e-7) player.velocity.x = 0;
  if (Math.abs((next.z - player.position.z) - requested.z) > 1e-7) player.velocity.z = 0;
  player.position = next;
}
