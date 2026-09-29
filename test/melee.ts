import { beginMelee, tickMelee, MELEE_RULES, type CollisionBox, type PlayerState, type WeaponEvent, type ZombieState } from '../src/core/index.ts';

/**
 * A whole knife swing, in one call: starts it, then runs it to the tick its blow lands. Returns every event, the
 * swing's own first (as \`beginMelee\` gives it) and the blow's after; an empty list if a swing could not start.
 */
export function swing(player: PlayerState, zombies: readonly ZombieState[], boxes: readonly CollisionBox[] = [], instaKill = false): WeaponEvent[] {
  const events = beginMelee(player);
  if (!events.length) return events;
  for (let tick = 0; tick < MELEE_RULES.strikeTicks; tick++) events.push(...tickMelee(player, zombies, boxes, instaKill));
  return events;
}
