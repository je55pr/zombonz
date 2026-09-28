import type { CollisionBox, WalkSurface } from './collision.ts';
import { moveWithCollision, sampleWalkHeight } from './collision.ts';
import type { InputFrame } from './input.ts';
import type { EntityId, PlayerState, Vec3 } from './types.ts';
import { GRENADE_RULES } from './grenade.ts';
import { createStarterWeaponState } from './weapon.ts';

export const PLAYER_MOVEMENT = {
  maxSpeed: 4.2,
  sprintMultiplier: 1.5,
  aimMultiplier: 0.65,
  acceleration: 22,
  deceleration: 28,
  radius: 0.34,
  height: 1.78,
  eyeHeight: 1.62,
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
    sprintTicks: SPRINT_RULES.maxTicks,
    sprintRechargeDelayTicks: 0,
    aiming: false,
    spreadBloom: 0,
    health: 100,
    recoveryDelayTicks: 0,
    meleeCooldownTicks: 0,
    grenadeCharges: GRENADE_RULES.starting,
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
    && candidate.y < box.max.y && candidate.y + PLAYER_MOVEMENT.height > box.min.y);
  player.position = supported && !blocked ? candidate : { ...(player.noclipAnchor ?? candidate) };
  player.noclip = false; player.noclipAnchor = null;
  player.velocity = { x: 0, y: 0, z: 0 };
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
    && !frame.actions.throwGrenade?.pressed;
  player.sprinting = !player.noclip && held(frame, 'sprint') > 0 && forwardInput > 0
    && !player.aiming && !frame.actions.fire?.held && !frame.actions.fire?.pressed
    && !frame.actions.reload?.pressed && !frame.actions.switchWeapon?.pressed
    && !frame.actions.melee?.pressed && !frame.actions.throwGrenade?.pressed
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
  const speed = PLAYER_MOVEMENT.maxSpeed * (player.sprinting
    ? PLAYER_MOVEMENT.sprintMultiplier : player.aiming ? PLAYER_MOVEMENT.aimMultiplier : 1);
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
    PLAYER_MOVEMENT.height,
    collisionBoxes,
  );
  next.y = sampleWalkHeight(next.x, next.z, player.position.y, walkSurfaces);

  if (Math.abs((next.x - player.position.x) - requested.x) > 1e-7) player.velocity.x = 0;
  if (Math.abs((next.z - player.position.z) - requested.z) > 1e-7) player.velocity.z = 0;
  player.position = next;
}
