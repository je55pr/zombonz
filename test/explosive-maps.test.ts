import { describe, expect, it } from 'vitest';
import {
  GameSimulation, HAZARD_KINDS, MINE_RULES, EQUIPMENT_ITEMS, createInputFrame, createZombieState, addEntity, damageHazard,
  hazardBox, hazardCentre, sampleWalkHeight, type CollisionBox, type HazardDefinition, type SimulationEvent,
} from '../src/core/index.ts';
import { MAPS } from '../src/maps/index.ts';
import { createMatch } from '../src/maps/match.ts';
import type { GameMap } from '../src/maps/gameMap.ts';

const overlaps = (a: CollisionBox, b: CollisionBox, margin = 0) =>
  a.min.x < b.max.x - margin && a.max.x > b.min.x + margin && a.min.z < b.max.z - margin && a.max.z > b.min.z + margin
  && a.min.y < b.max.y - margin && a.max.y > b.min.y + margin;
/** Distance across the floor from a point to a line segment. */
function distanceToSegment(p: { x: number; z: number }, a: { x: number; z: number }, b: { x: number; z: number }): number {
  const dx = b.x - a.x, dz = b.z - a.z, length = dx * dx + dz * dz;
  const t = length === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.z - a.z) * dz) / length));
  return Math.hypot(p.x - (a.x + t * dx), p.z - (a.z + t * dz));
}
const reach = (definition: HazardDefinition) => {
  const box = hazardBox(definition);
  return Math.hypot(box.max.x - box.min.x, box.max.z - box.min.z) / 2;
};
function press(sim: GameSimulation, ...actions: Array<'interact' | 'placeMine' | 'fire'>): SimulationEvent[] {
  const frame = createInputFrame(sim.state.world.tick);
  for (const action of actions) frame.actions[action] = { pressed: true, held: true, released: false, value: 1 };
  return sim.tick({ [sim.playerIds[0]]: frame });
}

describe.each(Object.values(MAPS) as GameMap[])('$name’s barrels and vehicles', map => {
  const hazards = map.hazards ?? [];

  it('places at least a barrel and, somewhere in the game, a vehicle', () => {
    expect(hazards.filter(hazard => hazard.kind === 'barrel').length).toBeGreaterThan(0);
    expect(new Set(hazards.map(hazard => hazard.id)).size).toBe(hazards.length);
    for (const hazard of hazards) expect(HAZARD_KINDS[hazard.kind], hazard.id).toBeDefined();
  });

  it('keeps every body clear of the walls and of each other', () => {
    for (const hazard of hazards) {
      const box = hazardBox(hazard);
      const hit = map.collisionBoxes.find(wall => overlaps(box, wall, 0.02));
      expect(hit, `${hazard.id} is inside a wall`).toBeUndefined();
    }
    hazards.forEach((a, i) => hazards.slice(i + 1).forEach(b => {
      expect(overlaps(hazardBox(a), hazardBox(b), 0.01), `${a.id} overlaps ${b.id}`).toBe(false);
    }));
  });

  it('stands on the floor wherever the map has floor', () => {
    for (const hazard of hazards) {
      const { x, z } = hazard.position;
      const floor = map.walkSurfaces.some(surface => x > surface.minX && x < surface.maxX && z > surface.minZ && z < surface.maxZ);
      if (floor) expect(sampleWalkHeight(x, z, hazard.position.y, map.walkSurfaces), hazard.id).toBeCloseTo(hazard.position.y);
    }
  });

  it('is off the zombies’ lanes, the player’s spawn and the way to the boxes', () => {
    for (const hazard of hazards) {
      const margin = reach(hazard) + 0.55;
      for (const barrier of map.barriers) {
        const path = [...barrier.approachPath, barrier.insidePoint];
        for (let i = 0; i < path.length - 1; i++) {
          expect(distanceToSegment(hazard.position, path[i], path[i + 1]), `${hazard.id} blocks ${barrier.id}`).toBeGreaterThan(margin);
        }
      }
      expect(Math.hypot(hazard.position.x - map.playerSpawn.x, hazard.position.z - map.playerSpawn.z), hazard.id).toBeGreaterThan(2);
    }
  });

  it('is shootable, burns and goes off in a real match, and a barrel takes its collision with it', () => {
    for (const hazard of hazards) {
      const sim = createMatch(map, 1, 5);
      const index = sim.state.hazards.findIndex(state => state.id === hazard.id);
      const boxes = sim.collisionBoxes().length;
      const target = sim.hazardTargets()[index];
      const events: SimulationEvent[] = [...damageHazard(target, 99999, sim.playerIds[0])];
      for (let i = 0; i < HAZARD_KINDS[hazard.kind].burnTicks + 5; i++) events.push(...sim.tick());
      expect(events.filter(event => event.type === 'hazardExploded'), hazard.id).toHaveLength(1);
      // The rest of the match carries on as it was, minus the barrel's body.
      expect(sim.collisionBoxes().length, hazard.id).toBe(HAZARD_KINDS[hazard.kind].wreck ? boxes : boxes - 1);
      expect(hazardCentre(hazard).y).toBeGreaterThan(hazard.position.y);
    }
  });
});

describe('vehicles in the maps', () => {
  it('leave a car or truck in the game for players to blow up, and the same kind of thing in each map', () => {
    const vehicles = Object.values(MAPS).flatMap(map => (map.hazards ?? []).filter(hazard => hazard.kind !== 'barrel'));
    expect(vehicles.length).toBeGreaterThanOrEqual(2);
    for (const vehicle of vehicles) expect(HAZARD_KINDS[vehicle.kind].wreck).toBe(true);
  });
});

describe.each(Object.values(MAPS) as GameMap[])('$name’s Bouncing Betties', map => {
  const buys = map.equipment ?? [];

  it('sells them from the wall', () => {
    expect(buys.length).toBeGreaterThan(0);
    for (const buy of buys) {
      expect(buy.item).toBe('bouncing-betty');
      expect(map.equipmentFacing?.[buy.id], buy.id).toBeDefined();
      expect(buy.refillCost).toBeLessThan(buy.cost);
    }
  });

  it('can be bought from real floor in front of the shelf, then set down', () => {
    for (const buy of buys) {
      const facing = map.equipmentFacing![buy.id];
      const stand = { x: buy.position.x + Math.sin(facing) * 1.2, y: buy.position.y - 1, z: buy.position.z + Math.cos(facing) * 1.2 };
      const sim = new GameSimulation({ seed: 1, playerSpawns: [stand],
        map: { collisionBoxes: [...map.collisionBoxes], shotBlockers: map.shotBlockers, walkSurfaces: map.walkSurfaces, zombieSpawns: [], equipment: [buy] },
        roundConfig: { initialWaitTicks: 9999, intermissionTicks: 1 },
        economyConfig: { startingPoints: buy.cost + 200, hitReward: 10, killBonus: 50 } });
      const player = sim.getPlayer(sim.playerIds[0])!;
      player.yaw = facing;
      sim.tick();
      expect(player.position.y, buy.id).toBeCloseTo(stand.y);
      expect(sim.interactionCandidate(player.id)?.prompt, buy.id).toContain(`[${buy.cost}]`);
      const bought = press(sim, 'interact');
      expect(bought.map(event => event.type), buy.id).toContain('equipmentPurchased');
      expect(player.bouncingBettyOwned).toBe(true);
      expect(player.mineCharges).toBe(EQUIPMENT_ITEMS['bouncing-betty'].perPurchase);
      expect(player.points).toBe(200);
      // A full pair is not sold to again.
      expect(press(sim, 'interact').map(event => event.type)).toContain('equipmentFull');
      expect(player.points).toBe(200);
      const [placed] = press(sim, 'placeMine').filter(event => event.type === 'minePlaced');
      expect(placed, buy.id).toBeDefined();
      expect(sim.state.grenades.mines[0].position.y).toBeCloseTo(stand.y);
    }
  });

  it('are topped up for the refill price, and refused without the points', () => {
    const buy = buys[0], facing = map.equipmentFacing![buy.id];
    const stand = { x: buy.position.x + Math.sin(facing) * 1.2, y: buy.position.y - 1, z: buy.position.z + Math.cos(facing) * 1.2 };
    const sim = new GameSimulation({ seed: 1, playerSpawns: [stand],
      map: { collisionBoxes: [...map.collisionBoxes], shotBlockers: map.shotBlockers, walkSurfaces: map.walkSurfaces, zombieSpawns: [], equipment: [buy] },
      roundConfig: { initialWaitTicks: 9999, intermissionTicks: 1 },
      economyConfig: { startingPoints: buy.cost - 1, hitReward: 10, killBonus: 50 } });
    const player = sim.getPlayer(sim.playerIds[0])!;
    player.yaw = facing;
    sim.tick();
    expect(press(sim, 'interact').map(event => event.type)).toContain('pointsSpendRejected');
    expect(player.mineCharges).toBe(0);
    player.points = buy.cost + buy.refillCost; player.mineCharges = 1;
    press(sim, 'interact');
    expect(player.mineCharges).toBe(MINE_RULES.maximum);
    expect(player.points).toBe(buy.cost);
  });

  it('spring under zombies in a real match of this map', () => {
    const sim = createMatch(map, 1, 3, { roundConfig: { initialWaitTicks: 999999, intermissionTicks: 999999 } });
    const [player] = sim.players();
    player.mineCharges = 1; player.godMode = true;
    press(sim, 'placeMine');
    const [mine] = sim.state.grenades.mines;
    for (let i = 0; i < MINE_RULES.armTicks + 2; i++) sim.tick();
    const zombie = createZombieState('e:9999', { x: mine.position.x + 0.6, y: mine.position.y, z: mine.position.z }, 1);
    zombie.moveSpeed = 0;
    addEntity(sim.state.world, zombie);
    for (let i = 0; i < MINE_RULES.popTicks + 3; i++) sim.tick();
    expect(zombie.alive).toBe(false);
    expect(sim.state.grenades.mines).toEqual([]);
  });
});
