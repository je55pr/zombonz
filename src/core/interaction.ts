import type {
  EntityId,
  InteractableState,
  PlayerState,
  Vec3,
} from './types.ts';

/**
 * Within this horizontal distance (metres) of an interactable's point the player counts as facing it, since
 * standing right against something puts its point behind or beside them.
 */
export const CLOSE_RANGE = 0.8;
/**
 * How much looking away costs a candidate when choosing between several: this many metres of distance for a
 * full turn away. A closer object wins unless another is much better centred.
 */
export const FACING_WEIGHT = 0.75;
/** For `minFacingDot`: being in range is enough, wherever the player looks. (A dot is never below -1.) */
export const ANY_FACING = -2;

export interface InteractableOptions {
  interactionType: string;
  actionId: string;
  prompt: string;
  interactionRange?: number;
  /**
   * How squarely the player must face it, as the cosine of the widest angle from their heading, in the
   * horizontal plane. `ANY_FACING` needs nothing: being in range is enough (barriers).
   * Defaults to 0.35, about 70 degrees either side.
   */
  minFacingDot?: number;
}

export interface InteractionCandidate {
  interactableId: EntityId;
  interactionType: string;
  actionId: string;
  prompt: string;
  distance: number;
  facingDot: number;
}

export interface InteractionEvent {
  type: 'interactionTriggered';
  playerId: EntityId;
  interactableId: EntityId;
  interactionType: string;
  actionId: string;
}

export function createInteractableState(
  id: EntityId,
  position: Vec3,
  options: InteractableOptions,
): InteractableState {
  const interactionRange = options.interactionRange ?? 2.25;
  const minFacingDot = options.minFacingDot ?? 0.35;
  if (!Number.isFinite(interactionRange) || interactionRange <= 0) {
    throw new RangeError('Interaction range must be positive.');
  }
  if (!Number.isFinite(minFacingDot) || minFacingDot < -2 || minFacingDot > 1) {
    throw new RangeError('Minimum facing dot must be between -2 and 1.');
  }
  return {
    id,
    kind: 'interactable',
    position: { ...position },
    alive: true,
    interactionType: options.interactionType,
    actionId: options.actionId,
    prompt: options.prompt,
    interactionRange,
    minFacingDot,
    enabled: true,
  };
}

function candidateFor(
  player: PlayerState,
  interactable: InteractableState,
): InteractionCandidate | null {
  if (!player.alive || !interactable.alive || !interactable.enabled) return null;
  const dx = interactable.position.x - player.position.x;
  const dy = interactable.position.y - player.position.y;
  const dz = interactable.position.z - player.position.z;
  const distance = Math.hypot(dx, dy, dz);
  if (distance > interactable.interactionRange) return null;
  // Facing is a matter of heading alone: an object at chest height is as ahead when you are close to it,
  // or looking a little up or down, as it is from across the room.
  const flat = Math.hypot(dx, dz);
  const facingDot = flat <= CLOSE_RANGE ? 1 : (-Math.sin(player.yaw) * dx - Math.cos(player.yaw) * dz) / flat;
  if (facingDot < interactable.minFacingDot) return null;
  return {
    interactableId: interactable.id,
    interactionType: interactable.interactionType,
    actionId: interactable.actionId,
    prompt: interactable.prompt,
    distance,
    facingDot,
  };
}
export function findInteractionCandidate(
  player: PlayerState,
  interactables: readonly InteractableState[],
): InteractionCandidate | null {
  const candidates = interactables
    .map((interactable) => candidateFor(player, interactable))
    .filter((candidate): candidate is InteractionCandidate => candidate !== null);
  // The nearest, best-centred one wins. The score moves smoothly as the player turns and walks, so the
  // choice does not flicker between two objects; ties fall to the id.
  const score = (candidate: InteractionCandidate) => candidate.distance + (1 - candidate.facingDot) * FACING_WEIGHT;
  candidates.sort((a, b) => {
    const delta = score(a) - score(b);
    if (Math.abs(delta) > 1e-9) return delta;
    return a.interactableId.localeCompare(b.interactableId);
  });
  return candidates[0] ?? null;
}

export function triggerInteraction(
  player: PlayerState,
  interactables: readonly InteractableState[],
  pressed: boolean,
): InteractionEvent[] {
  if (!pressed) return [];
  const candidate = findInteractionCandidate(player, interactables);
  if (!candidate) return [];
  return [{
    type: 'interactionTriggered',
    playerId: player.id,
    interactableId: candidate.interactableId,
    interactionType: candidate.interactionType,
    actionId: candidate.actionId,
  }];
}
