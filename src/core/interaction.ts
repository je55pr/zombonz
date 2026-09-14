import type {
  EntityId,
  InteractableState,
  PlayerState,
  Vec3,
} from './types.ts';

export interface InteractableOptions {
  interactionType: string;
  actionId: string;
  prompt: string;
  interactionRange?: number;
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
  const minFacingDot = options.minFacingDot ?? 0.55;
  if (!Number.isFinite(interactionRange) || interactionRange <= 0) {
    throw new RangeError('Interaction range must be positive.');
  }
  if (!Number.isFinite(minFacingDot) || minFacingDot < -1 || minFacingDot > 1) {
    throw new RangeError('Minimum facing dot must be between -1 and 1.');
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

function playerForward(player: PlayerState): Vec3 {
  const cosPitch = Math.cos(player.pitch);
  return {
    x: -Math.sin(player.yaw) * cosPitch,
    y: Math.sin(player.pitch),
    z: -Math.cos(player.yaw) * cosPitch,
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
  const forward = playerForward(player);
  const facingDot = distance <= 1e-9
    ? 1
    : (forward.x * dx + forward.y * dy + forward.z * dz) / distance;
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
  candidates.sort((a, b) => {
    const facingDelta = b.facingDot - a.facingDot;
    if (Math.abs(facingDelta) > 1e-9) return facingDelta;
    const distanceDelta = a.distance - b.distance;
    if (Math.abs(distanceDelta) > 1e-9) return distanceDelta;
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
