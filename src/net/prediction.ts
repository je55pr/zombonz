import type { CollisionBox, WalkSurface } from '../core/collision.ts';
import { DOWN_RULES } from '../core/downs.ts';
import { tickPlayerRecovery } from '../core/health.ts';
import type { InputFrame } from '../core/input.ts';
import { PLAYER_MOVEMENT, playerEyeHeight, updatePlayerMovement } from '../core/player.ts';
import { blockPlayerByZombies } from '../core/zombie.ts';
import { GRENADE_RULES } from '../core/grenade.ts';
import type { SimulationEvent } from '../core/simulation.ts';
import type { PlayerState, ZombieState } from '../core/types.ts';
import {
  beginMelee, beginReload, firePlayerWeapon, rayFromPlayer, switchWeapon, tickMelee, tickWeaponState, wantsToFire,
} from '../core/weapon.ts';

export interface PredictionWorld {
  /** Solid geometry right now, closed doors and the box included. */
  collision(): CollisionBox[];
  walkSurfaces: readonly WalkSurface[];
  shotBlockers: readonly CollisionBox[];
  /**
   * The zombies as this client sees them (the host's word, a moment old), which the player's own movement is stopped by
   * as on the host. Left out, the predicted player walks through them and is pulled back.
   */
  zombies?(): readonly ZombieState[];
}

/**
 * The events a client makes for itself, straight away, from its own predicted player. The host's
 * copies of these for that player are dropped, so a shot is heard once and without delay.
 */
export const PREDICTED_EVENTS: ReadonlySet<SimulationEvent['type']> = new Set([
  'weaponFired', 'weaponReloadStarted', 'weaponReloadCompleted', 'weaponSwitched', 'meleeSwung',
]);

/**
 * One tick of a single player, as `GameSimulation.tick` runs it, minus everything only the host can
 * decide: nothing is hit, bought, thrown or opened. What remains (moving, looking, sprint stamina, gun
 * timing and ammo) is what makes a client's own controls feel immediate.
 */
export function predictPlayerTick(player: PlayerState, frame: InputFrame, world: PredictionWorld, seed: number,
  deltaSeconds = 1 / 60): SimulationEvent[] {
  if (!player.alive) return [];
  const events: SimulationEvent[] = [...tickPlayerRecovery(player)];
  if (player.meleeCooldownTicks > 0) player.meleeCooldownTicks -= 1;
  const collision = world.collision();
  const blockers = [...collision, ...world.shotBlockers];
  if (player.downed) {
    player.yaw += frame.look.yaw;
    player.pitch = Math.max(-PLAYER_MOVEMENT.maxPitch, Math.min(PLAYER_MOVEMENT.maxPitch, player.pitch + frame.look.pitch));
    events.push(...tickWeaponState(player));
    if (frame.actions.reload?.pressed) events.push(...beginReload(player));
  } else {
    const from = { ...player.position };
    updatePlayerMovement(player, frame, deltaSeconds, collision, world.walkSurfaces, blockers);
    if (world.zombies) blockPlayerByZombies(player, from, world.zombies(), collision);
    events.push(...tickWeaponState(player));
    if (frame.actions.switchWeapon?.pressed) events.push(...switchWeapon(player));
    if (frame.actions.reload?.pressed) events.push(...beginReload(player));
    // The swing's timing runs here as on the host; only the host knows what the blow hits.
    tickMelee(player, [], blockers, false);
    if (frame.actions.melee?.pressed) events.push(...beginMelee(player));
    if (frame.actions.switchWeapon?.pressed || frame.actions.melee?.pressed || frame.actions.reload?.pressed
      || frame.actions.cancelGrenade?.pressed || player.noclip) player.grenadeWindupTicks = 0;
    else if (frame.actions.throwGrenade?.pressed && player.grenadeWindupTicks === 0
      && player.grenadeCharges > 0 && player.switchTicksRemaining === 0 && player.meleeCooldownTicks === 0) player.grenadeWindupTicks = GRENADE_RULES.windupTicks;
    if (player.grenadeWindupTicks > 0) player.grenadeWindupTicks -= 1;
  }
  const fire = frame.actions.fire;
  if (player.grenadeWindupTicks === 0 && wantsToFire(player, fire?.pressed ?? false, fire?.held ?? false)) {
    events.push(...firePlayerWeapon(player, rayFromPlayer(player, player.downed ? DOWN_RULES.eyeHeight : playerEyeHeight(player)),
      [], blockers, false, seed));
  }
  return events.filter(event => PREDICTED_EVENTS.has(event.type));
}
