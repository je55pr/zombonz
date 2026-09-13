import type { EntityId, EntityState, WorldState } from './types.ts';

export function createWorld(seed: number): WorldState {
  return {
    tick: 0,
    seed: seed >>> 0,
    nextEntityNumber: 1,
    entities: {},
  };
}

export function allocateEntityId(world: WorldState): EntityId {
  const id = `e:${world.nextEntityNumber}` as EntityId;
  world.nextEntityNumber += 1;
  return id;
}

export function addEntity(world: WorldState, entity: EntityState): void {
  if (world.entities[entity.id]) {
    throw new Error(`Entity already exists: ${entity.id}`);
  }
  world.entities[entity.id] = entity;
}

export function removeEntity(world: WorldState, id: EntityId): boolean {
  if (!world.entities[id]) return false;
  delete world.entities[id];
  return true;
}
