import { PLAYER_MOVEMENT, createInputFrame, zombieChest, zombieHeadCentre, type HitscanRay, type InputFrame, type PlayerState, type Vec3, type ZombieState } from '../src/core/index.ts';

/** A ray from `from` through `to`. */
export function rayThrough(from: Vec3, to: Vec3): HitscanRay {
  const length = Math.hypot(to.x - from.x, to.y - from.y, to.z - from.z);
  return { origin: { ...from }, direction: { x: (to.x - from.x) / length, y: (to.y - from.y) / length, z: (to.z - from.z) / length } };
}

const eyeOf = (player: PlayerState): Vec3 => ({ x: player.position.x, y: player.position.y + PLAYER_MOVEMENT.eyeHeight, z: player.position.z });

/** The player's shot straight at the middle of a zombie's skull, wherever the zombie's head is drawn. */
export const headRay = (player: PlayerState, zombie: ZombieState): HitscanRay => rayThrough(eyeOf(player), zombieHeadCentre(zombie));

/** The player's shot straight at the middle of a zombie's chest. */
export const chestRay = (player: PlayerState, zombie: ZombieState): HitscanRay => rayThrough(eyeOf(player), zombieChest(zombie));

/** Turns a player to look straight at a point (yaw 0 looks toward -z). */
export function lookAt(player: PlayerState, at: Vec3): void {
  const eye = eyeOf(player);
  player.yaw = Math.atan2(-(at.x - eye.x), -(at.z - eye.z));
  player.pitch = Math.atan2(at.y - eye.y, Math.hypot(at.x - eye.x, at.z - eye.z));
}

/** An input frame that fires while looking down the sights at `at`, having turned the player to face it. */
export function aimedFire(player: PlayerState, at: Vec3): InputFrame {
  lookAt(player, at);
  const frame = createInputFrame(0);
  frame.actions.fire = { held: true, pressed: true, released: false, value: 1 };
  frame.actions.aim = { held: true, pressed: false, released: false, value: 1 };
  return frame;
}
