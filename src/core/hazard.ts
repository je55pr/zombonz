import { blastReach, detonate, type BlastContext, type BlastEvent, type BlastRules } from './blast.ts';
import type { CollisionBox } from './collision.ts';
import type { EntityId, Vec3 } from './types.ts';

/**
 * What a map can leave lying about that explodes when shot: fuel barrels and vehicles. Everything a
 * hazard does is decided here from its kind, so a map only places `{ id, kind, position, yaw }`.
 *
 * A hazard that takes its health in damage catches fire (`burning`), then blows up `burnTicks` later: a
 * barrel almost at once, a car after a few seconds of burning. It goes off once. Its blast hurts zombies,
 * every player near it and other hazards, so a row of barrels goes up in turn.
 */
export interface HazardKindSpec {
  name: string;
  /** The model under `props/`, fitted inside `size`. */
  asset: string;
  /** Width (x), height and depth (z) of the solid body before it is turned by the placement's yaw. */
  size: Vec3;
  health: number;
  burnTicks: number;
  blast: BlastRules;
  /** Whether a burnt-out shell stays behind (solid, and stopping shots) or the hazard vanishes. */
  wreck: boolean;
}

export const HAZARD_KINDS = {
  barrel: {
    name: 'explosive barrel', asset: 'explosive-barrel', size: { x: 0.58, y: 0.9, z: 0.58 }, health: 120, burnTicks: 24,
    blast: { radius: 4.5, damage: 1500, playerDamage: 80 }, wreck: false,
  },
  jeep: {
    name: 'jeep', asset: 'vehicles/gaz-67', size: { x: 1.68, y: 1.56, z: 3.35 }, health: 500, burnTicks: 210,
    blast: { radius: 6, damage: 2500, playerDamage: 100 }, wreck: true,
  },
  truck: {
    name: 'truck', asset: 'vehicles/soviet-offroad', size: { x: 2.01, y: 2, z: 4.2 }, health: 650, burnTicks: 240,
    blast: { radius: 6.5, damage: 3000, playerDamage: 100 }, wreck: true,
  },
} as const satisfies Record<string, HazardKindSpec>;
export type HazardKind = keyof typeof HAZARD_KINDS;

/** Where a map puts one: `position` is the middle of its base on the floor, `yaw` turns it about y. */
export interface HazardDefinition {
  id: string;
  kind: HazardKind;
  position: Vec3;
  yaw: number;
}

export const HAZARD_PHASES = ['intact', 'burning', 'exploded'] as const;
export type HazardPhase = typeof HAZARD_PHASES[number];

export interface HazardState {
  id: string;
  health: number;
  phase: HazardPhase;
  /** Ticks until a burning hazard explodes. */
  burnTicks: number;
  /** The last player to hurt it, who is credited with what its blast kills. */
  attackerId: EntityId | null;
}

/** A hazard that can still be shot or caught in a blast: its definition, state and solid body. */
export interface HazardTarget {
  definition: HazardDefinition;
  state: HazardState;
  box: CollisionBox;
}

export type HazardEvent =
  | { type: 'hazardHit'; hazardId: string; kind: HazardKind; playerId: EntityId; damage: number; position: Vec3 }
  | { type: 'hazardIgnited'; hazardId: string; kind: HazardKind; position: Vec3 }
  | { type: 'hazardExploded'; hazardId: string; kind: HazardKind; playerId: EntityId | null; position: Vec3; radius: number };

export function hazardSpec(definition: Pick<HazardDefinition, 'kind'>): HazardKindSpec {
  const spec: HazardKindSpec | undefined = HAZARD_KINDS[definition.kind];
  if (!spec) throw new Error(`Unknown hazard kind: ${String(definition.kind)}`);
  return spec;
}

/** The axis-aligned box a turned body fills. */
export function hazardBox(definition: HazardDefinition): CollisionBox {
  const { size } = hazardSpec(definition), c = Math.abs(Math.cos(definition.yaw)), s = Math.abs(Math.sin(definition.yaw));
  const halfX = (size.x * c + size.z * s) / 2, halfZ = (size.x * s + size.z * c) / 2;
  const { position } = definition;
  return { min: { x: position.x - halfX, y: position.y, z: position.z - halfZ },
    max: { x: position.x + halfX, y: position.y + size.y, z: position.z + halfZ } };
}

export function hazardCentre(definition: HazardDefinition): Vec3 {
  return { x: definition.position.x, y: definition.position.y + hazardSpec(definition).size.y / 2, z: definition.position.z };
}

export function createHazard(definition: HazardDefinition): HazardState {
  return { id: definition.id, health: hazardSpec(definition).health, phase: 'intact', burnTicks: 0, attackerId: null };
}

/** The hazards that can still be shot or hurt: everything that has not yet gone off. */
export function hazardTargets(definitions: readonly HazardDefinition[], states: readonly HazardState[]): HazardTarget[] {
  return definitions.flatMap((definition, index) => states[index]?.phase === 'exploded' ? []
    : [{ definition, state: states[index], box: hazardBox(definition) }]);
}

/** Every hazard's solid body for walking into: whole ones, and the shells that stay behind. */
export function hazardSolids(definitions: readonly HazardDefinition[], states: readonly HazardState[]): CollisionBox[] {
  return definitions.flatMap((definition, index) => states[index]?.phase !== 'exploded' || hazardSpec(definition).wreck
    ? [hazardBox(definition)] : []);
}

/** Just the burnt-out shells, which stop shots and blasts as any wall does. */
export function hazardWrecks(definitions: readonly HazardDefinition[], states: readonly HazardState[]): CollisionBox[] {
  return definitions.flatMap((definition, index) => states[index]?.phase === 'exploded' && hazardSpec(definition).wreck
    ? [hazardBox(definition)] : []);
}

/**
 * Hurts a hazard. Only a whole one takes damage: once it burns it can neither be finished off sooner nor
 * set off twice. Taking the last of its health sets it burning.
 */
export function damageHazard(target: HazardTarget, amount: number, attackerId: EntityId): HazardEvent[] {
  const { state, definition } = target;
  if (state.phase !== 'intact' || !(amount > 0)) return [];
  const spec = hazardSpec(definition);
  state.health = Math.max(0, state.health - Math.round(amount));
  state.attackerId = attackerId;
  if (state.health > 0) return [];
  state.phase = 'burning'; state.burnTicks = spec.burnTicks;
  return [{ type: 'hazardIgnited', hazardId: state.id, kind: definition.kind, position: hazardCentre(definition) }];
}

/** A blast's damage to the hazards in reach of it, other than `except` (the one that made it). */
export function blastHazards(centre: Vec3, rules: BlastRules, credit: EntityId, targets: readonly HazardTarget[],
  boxes: readonly CollisionBox[], except?: string): HazardEvent[] {
  const events: HazardEvent[] = [];
  const candidates = targets.filter(target => target.state.id !== except && target.state.phase === 'intact');
  for (const { target, scale } of blastReach(centre, rules.radius, candidates, target => hazardCentre(target.definition), boxes)) {
    events.push(...damageHazard(target, rules.damage * scale, credit));
  }
  return events;
}

/**
 * One tick for every burning hazard. A burning hazard counts down and goes off once: its blast is the
 * kind's, credited to whoever last hurt it. `context.boxes` are the walls; a hazard's own body is not one.
 */
export function tickHazards(definitions: readonly HazardDefinition[], states: readonly HazardState[],
  context: BlastContext): Array<HazardEvent | BlastEvent> {
  const events: Array<HazardEvent | BlastEvent> = [];
  states.forEach((state, index) => {
    if (state.phase !== 'burning') return;
    state.burnTicks -= 1;
    if (state.burnTicks > 0) return;
    const definition = definitions[index], spec = hazardSpec(definition), centre = hazardCentre(definition);
    state.phase = 'exploded'; state.burnTicks = 0;
    events.push({ type: 'hazardExploded', hazardId: state.id, kind: definition.kind, playerId: state.attackerId,
      position: centre, radius: spec.blast.radius });
    if (!state.attackerId) return;
    events.push(...detonate(centre, spec.blast, state.attackerId, 'all', context),
      ...blastHazards(centre, spec.blast, state.attackerId, hazardTargets(definitions, states), context.boxes, state.id));
  });
  return events;
}
