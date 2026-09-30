import type { EntityId } from '../core/types.ts';
import type { GameSimulation } from '../core/simulation.ts';

/** Standing, connected teammates that a bled-out player may watch, in stable player-slot order. */
export function spectateTargets(simulation: GameSimulation, viewerId: EntityId): EntityId[] {
  const left = new Set(simulation.state.leftPlayers);
  return simulation.playerIds.filter(id => {
    if (id === viewerId || left.has(id)) return false;
    const player = simulation.getPlayer(id);
    return !!player?.alive && !player.downed;
  });
}

/**
 * Keeps a valid target when possible, or cycles through the standing teammates.
 * Positive direction moves forward, negative moves backward, and zero only repairs an invalid target.
 */
export function selectSpectateTarget(
  simulation: GameSimulation,
  viewerId: EntityId,
  current: EntityId | null,
  direction = 0,
): EntityId | null {
  const targets = spectateTargets(simulation, viewerId);
  if (!targets.length) return null;

  const index = current === null ? -1 : targets.indexOf(current);
  if (index >= 0 && direction === 0) return current;
  if (index < 0) return direction < 0 ? targets[targets.length - 1] : targets[0];

  const step = direction < 0 ? -1 : 1;
  return targets[(index + step + targets.length) % targets.length];
}
