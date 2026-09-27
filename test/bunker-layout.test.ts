import { describe, expect, it } from 'vitest';
import { GameSimulation, createInputFrame, createPlayerState, createZombieState,
  updatePlayerMovement, updateZombiePursuit, tickZombieMelee, navigationWaypoint,
  closedDoorBlockers, createDoorState, hasWalkableConnection, resolveHitscan, createNavigationQuery,
} from '../src/core/index.ts';
import { BUNKER_DOORS, BUNKER_MYSTERY_BOXES, BUNKER_NAVIGATION, BUNKER_PLAYER_SPAWN,
  BUNKER_WALK_SURFACES, BUNKER_ZOMBIE_SPAWNS, BUNKER_STAIRS, BUNKER_SHOT_BLOCKERS,
  UPPER_HEIGHT, greyboxCollisionBoxes, BUNKER_BARRIERS, BUNKER_BOX_CENTER } from '../src/maps/bunker.ts';
import { ps, px, pz } from '../src/maps/bunkerPlan.ts';

// The HELP stair runs south from blockout z 3.1 to 6.65; place a point part way up it.
const helpStairAt = (z: number) => ({ x: (px(-7.8) + px(-6.3)) / 2, z: pz(3.1) + (z - 3.1) * (pz(6.65) - pz(3.1)) / 3.55 });

const map = { collisionBoxes: greyboxCollisionBoxes(), walkSurfaces: BUNKER_WALK_SURFACES,
  zombieSpawns: BUNKER_ZOMBIE_SPAWNS, navigationGraph: BUNKER_NAVIGATION,
  doors: BUNKER_DOORS, mysteryBoxes: BUNKER_MYSTERY_BOXES, shotBlockers: BUNKER_SHOT_BLOCKERS,
  barriers: BUNKER_BARRIERS };
function makeSimulation(points = 500, spawn = BUNKER_PLAYER_SPAWN) {
  return new GameSimulation({ seed: 42, map, playerSpawns: [spawn],
    economyConfig: { startingPoints: points, hitReward: 10, killBonus: 50 },
    roundConfig: { initialWaitTicks: 9999, intermissionTicks: 9999 } });
}
function interact(sim: GameSimulation) {
  const frame = createInputFrame(0);
  frame.actions.interact = { pressed: true, held: true, released: false, value: 1 };
  return sim.tick({ [sim.playerIds[0]]: frame });
}
describe('Bunker room routes', () => {
  it.each([
    { id: 'help-room', position: { x: 1.4, y: 0, z: 0 }, yaw: Math.PI / 2 },
    { id: 'start-stairs', position: { x: ps(7.2) + 0.1, y: 2.1, z: ps(-0.975) }, yaw: Math.PI / 2 },
    { id: 'start-stairs', position: { x: ps(4.8) - 0.3, y: 3.4, z: ps(-0.975) }, yaw: -Math.PI / 2 },
    { id: 'help-stairs', position: { ...helpStairAt(3.85), y: 0.7 }, yaw: Math.PI },
    { id: 'help-stairs', position: { ...helpStairAt(5.9), y: 2.7 }, yaw: 0 },
  ])('purchases $id from an accessible approach', approach => {
    const sim = makeSimulation(2000, approach.position);
    sim.getPlayer(sim.playerIds[0])!.yaw = approach.yaw;
    expect(interact(sim).filter(event => event.type === 'doorOpened')).toEqual([
      { type: 'doorOpened', doorId: approach.id, playerId: sim.playerIds[0] },
    ]);
    expect(sim.getPlayer(sim.playerIds[0])!.points).toBe(1000);
  });
  it.each(BUNKER_STAIRS)('walks up and down $id without clipping the landing', stair => {
    const forward = createInputFrame(0);
    forward.actions.moveForward = { pressed: true, held: true, released: false, value: 1 };
    const player = createPlayerState('e:1', stair.route[0]);
    function walkRoute(route: readonly { x: number; y: number; z: number }[]) {
      for (const point of route) {
        let ticks = 0;
        while (Math.hypot(player.position.x - point.x, player.position.z - point.z) > 0.06 && ticks++ < 180) {
          player.yaw = Math.atan2(player.position.x - point.x, player.position.z - point.z);
          updatePlayerMovement(player, forward, 1 / 60, map.collisionBoxes, map.walkSurfaces);
        }
        expect(ticks, `${stair.id}: ${JSON.stringify(point)} from ${JSON.stringify(player.position)}`).toBeLessThan(180);
      }
    }
    walkRoute(stair.route);
    expect(player.position.y).toBeCloseTo(UPPER_HEIGHT);
    walkRoute([...stair.route].reverse());
    expect(player.position.y).toBeCloseTo(0);
  });
  it('blocks both stairways and the HELP route until purchased', () => {
    const sim = makeSimulation();
    for (const goal of [{ x: -1.5, y: 0, z: 0 }, { x: -2, y: UPPER_HEIGHT, z: 0 }]) {
      const start = BUNKER_PLAYER_SPAWN;
      expect(navigationWaypoint(BUNKER_NAVIGATION, start, goal, sim.collisionBoxes(), 0.32, map.walkSurfaces)).toBe(start);
    }
  });
  it.each(['walk', 'run', 'sprint'] as const)('lets a %s zombie reach the HELP room through both stairs while its door stays shut', (gait) => {
    const doors = BUNKER_DOORS.map((definition, index) => createDoorState(definition, `e:${index + 10}`));
    doors.filter(door => door.id !== 'help-room').forEach(door => { door.open = true; });
    const blockers = [...map.collisionBoxes, ...closedDoorBlockers(doors)];
    const zombie = createZombieState('e:2', BUNKER_PLAYER_SPAWN, 1, gait);
    const player = createPlayerState('e:1', { x: -1.5, y: 0, z: 0 });
    const query = createNavigationQuery(BUNKER_NAVIGATION, blockers, 0.32, map.walkSurfaces);
    // Up the main stair, across the upper floor and down the HELP stair: walkers need a few minutes.
    for (let i = 0; i < (gait === 'walk' ? 12000 : 5400); i++) updateZombiePursuit(zombie, [player], 1 / 60, blockers, map.walkSurfaces, BUNKER_NAVIGATION, query);
    expect(Math.hypot(zombie.position.x - player.position.x, zombie.position.y,
      zombie.position.z - player.position.z)).toBeLessThan(1.1);
  });
  it('has supported navigation edges rather than floating cross-floor shortcuts', () => {
    for (const node of BUNKER_NAVIGATION.nodes) for (const id of node.neighbors) {
      const target = BUNKER_NAVIGATION.nodes.find(node => node.id === id)!;
      expect(hasWalkableConnection(node.position, target.position, map.walkSurfaces), `${node.id} -> ${id}`).toBe(true);
    }
  });
  it('does not spawn inaccessible enemies in locked rooms', () => {
    const sim = new GameSimulation({ seed: 42, map, playerSpawns: [BUNKER_PLAYER_SPAWN],
      roundConfig: { initialWaitTicks: 1, intermissionTicks: 10 },
      spawnConfig: { baseZombieCount: 12, additionalPerRound: 0, maxAlive: 12, spawnIntervalTicks: 0 } });
    for (let i = 0; i < 15; i++) sim.tick();
    expect(sim.zombies()).toHaveLength(12);
    expect(sim.zombies().every(zombie => {
      const barrier = sim.state.barriers.find(barrier => barrier.id === zombie.entry?.barrierId);
      return barrier && barrier.insidePoint.x > 0 && zombie.position.y === 0;
    })).toBe(true);
  });
  it('prevents melee and bullets through the upper floor', () => {
    const player = createPlayerState('e:1', { x: -3, y: UPPER_HEIGHT, z: 0 });
    const zombie = createZombieState('e:2', { x: -3, y: 0, z: 0 }, 1);
    expect(tickZombieMelee(zombie, [player], map.collisionBoxes)).toEqual([]);
    expect(player.health).toBe(100);
    const upstairsZombie = createZombieState('e:3', player.position, 1);
    expect(resolveHitscan({ origin: { x: -3, y: 1.62, z: 0 }, direction: { x: 0, y: 1, z: 0 } },
      [upstairsZombie], BUNKER_SHOT_BLOCKERS, 60).kind).toBe('world');
  });
});
describe('single fixed mystery box', () => {
  const front = { x: BUNKER_BOX_CENTER.x, y: 0, z: BUNKER_BOX_CENTER.z - 1.62 };
  it('charges 950 once, rolls before claiming, and respects its cooldown', () => {
    const sim = makeSimulation(3000, front);
    const player = sim.getPlayer(sim.playerIds[0])!; player.yaw = Math.PI;
    expect(sim.state.mysteryBoxes).toHaveLength(1);
    expect(interact(sim).some(event => event.type === 'mysteryBoxUsed')).toBe(true);
    expect(player.points).toBe(2050);
    expect(player.weapon.weaponId).toBe('starter-pistol');
    expect(interact(sim).some(event => event.type === 'mysteryBoxUsed')).toBe(false);
    for (let i = 0; i < 180; i++) sim.tick();
    expect(interact(sim).some(event => event.type === 'mysteryBoxClaimed')).toBe(true);
    expect(player.weapon.magazineAmmo).toBeGreaterThan(0);
    expect(BUNKER_MYSTERY_BOXES[0].weapons).toContain(player.weapon.weaponId);
    expect(interact(sim).some(event => event.type === 'mysteryBoxUsed')).toBe(false);
    expect(player.points).toBe(2050);
    for (let i = 0; i < 120; i++) sim.tick();
    expect(interact(sim).some(event => event.type === 'mysteryBoxUsed')).toBe(true);
    expect(player.points).toBe(1100);
  });
  it('rejects insufficient funds and interactions through the room wall', () => {
    const poor = makeSimulation(500, front); poor.getPlayer(poor.playerIds[0])!.yaw = Math.PI;
    expect(interact(poor).some(event => event.type === 'pointsSpendRejected')).toBe(true);
    expect(poor.state.mysteryBoxes[0].rolls).toBe(0);
    const throughWall = makeSimulation(3000, { x: 0.5, y: 0, z: BUNKER_MYSTERY_BOXES[0].position.z });
    throughWall.getPlayer(throughWall.playerIds[0])!.yaw = Math.PI / 2;
    expect(interact(throughWall).some(event => event.type === 'mysteryBoxUsed')).toBe(false);
  });
  it('replays box rewards deterministically and resets purchases on restart', () => {
    const run = () => {
      const sim = makeSimulation(3000, front); sim.getPlayer(sim.playerIds[0])!.yaw = Math.PI;
      interact(sim); return sim;
    };
    const a = run(), b = run(); expect(a.state).toEqual(b.state);
    a.restart(42);
    expect(a.state.mysteryBoxes[0]).toMatchObject({ rolls: 0, cooldownTicks: 0, lastWeapon: null });
    expect(a.state.doors.every(door => !door.open)).toBe(true);
  });
});
