import type { CollisionBox, WalkSurface } from './collision.ts';
import { moveWithCollision, sampleWalkHeight } from './collision.ts';
import type { InputFrame } from './input.ts';
import type { EntityId, PlayerState, Vec3 } from './types.ts';
import { createStarterWeaponState } from './weapon.ts';

export const PLAYER_MOVEMENT = {
  maxSpeed: 4.2,
  acceleration: 22,
  deceleration: 28,
  radius: 0.34,
  height: 1.78,
  eyeHeight: 1.62,
  maxPitch: Math.PI * 0.47,
} as const;

export function createPlayerState(id: EntityId, position: Vec3): PlayerState {
  return {
    id,
    kind: 'player',
    position: { ...position },
    velocity: { x: 0, y: 0, z: 0 },
    yaw: 0,
    pitch: 0,
    health: 100,
    points: 500,
    weapon: createStarterWeaponState(),
    alive: true,
  };
}

function moveToward(current: number, target: number, maxDelta: number): number {
  if (current < target) return Math.min(current + maxDelta, target);
  if (current > target) return Math.max(current - maxDelta, target);
  return target;
}

function held(frame: InputFrame, action: keyof InputFrame['actions']): number {
  return frame.actions[action]?.held ? 1 : 0;
}

export function updatePlayerMovement(
  player: PlayerState,
  frame: InputFrame,
  deltaSeconds: number,
  collisionBoxes: readonly CollisionBox[],
  walkSurfaces: readonly WalkSurface[] = [],
): void {
  player.yaw += frame.look.yaw;
  player.pitch = Math.max(-PLAYER_MOVEMENT.maxPitch, Math.min(
    PLAYER_MOVEMENT.maxPitch,
    player.pitch + frame.look.pitch,
  ));

  const forwardInput = held(frame, 'moveForward') - held(frame, 'moveBackward');
  const rightInput = held(frame, 'moveRight') - held(frame, 'moveLeft');
  const magnitude = Math.hypot(forwardInput, rightInput);
  const normalizedForward = magnitude > 1 ? forwardInput / magnitude : forwardInput;
  const normalizedRight = magnitude > 1 ? rightInput / magnitude : rightInput;

  const sin = Math.sin(player.yaw);
  const cos = Math.cos(player.yaw);
  const desiredX = (-sin * normalizedForward + cos * normalizedRight) * PLAYER_MOVEMENT.maxSpeed;
  const desiredZ = (-cos * normalizedForward - sin * normalizedRight) * PLAYER_MOVEMENT.maxSpeed;
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
