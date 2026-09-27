import { describe, expect, it } from 'vitest';
import { BARRIER_RULES, GameSimulation, createInputFrame, createNavigationQuery, createZombieState,
  createZombieEntry, createBarrier, prepareBarriers, updateZombieEntry, syncBarrierInteractables,
  tickZombieMelee, firePlayerWeapon, type SimulationEvent } from '../src/core/index.ts';
import { NACHT_BARRIERS, NACHT_DOORS, NACHT_NAVIGATION, NACHT_PLAYER_SPAWN, NACHT_WINDOW_BOARDS,
  NACHT_SHOT_BLOCKERS, NACHT_WALK_SURFACES, NACHT_ZOMBIE_SPAWNS, greyboxCollisionBoxes } from '../src/maps/nacht.ts';

const map = { collisionBoxes: greyboxCollisionBoxes(), walkSurfaces: NACHT_WALK_SURFACES,
  shotBlockers: NACHT_SHOT_BLOCKERS, zombieSpawns: NACHT_ZOMBIE_SPAWNS,
  barriers: NACHT_BARRIERS, doors: NACHT_DOORS, navigationGraph: NACHT_NAVIGATION };
function makeSimulation(index = 0, count = 1, initialWaitTicks = 1) {
  return new GameSimulation({ seed: 4848,
    map: { ...map, zombieSpawns: [NACHT_ZOMBIE_SPAWNS[index]] }, playerSpawns: [NACHT_PLAYER_SPAWN],
    roundConfig: { initialWaitTicks, intermissionTicks: 9999 },
    spawnConfig: { baseZombieCount: count, additionalPerRound: 0, spawnIntervalTicks: 20, maxAlive: count } });
}

describe('exterior entry routes', () => {
  it('spawns outside, approaches, tears boards individually, vaults, then pursues', () => {
    const sim = makeSimulation();
    sim.getPlayer(sim.playerIds[0])!.health = 1000;
    sim.tick(); const events = sim.tick();
    const zombie = sim.zombies()[0];
    expect(events.find(event => event.type === 'zombieSpawned')).toMatchObject({ spawnIndex: 0, barrierId: NACHT_BARRIERS[0].id });
    expect(zombie.position.z).toBeLessThan(NACHT_BARRIERS[0].position.z - 4);
    expect(zombie.entry?.phase).toBe('approach');
    expect(sim.state.barriers[0].boards).toBe(NACHT_WINDOW_BOARDS);
    let firstTear = -1, vaultStarted = -1, entered = -1;
    const tears: number[] = [];
    for (let tick = 0; tick < 2000; tick++) {
      const previous = { ...zombie.position };
      const frameEvents = sim.tick();
      for (const event of frameEvents) {
        if (event.type === 'barrierBoardRemoved') { tears.push(event.boards); if (firstTear < 0) firstTear = tick; }
        if (event.type === 'zombieVaultStarted') { vaultStarted = tick; expect(sim.state.barriers[0].boards).toBe(0); }
        if (event.type === 'zombieEntered') entered = tick;
      }
      // The entry is continuous, not a jump from the exterior to the room.
      expect(Math.hypot(zombie.position.x - previous.x, zombie.position.y - previous.y,
        zombie.position.z - previous.z)).toBeLessThan(0.08);
      if (sim.state.barriers[0].boards > 0) expect(zombie.position.z).toBeLessThan(NACHT_BARRIERS[0].position.z - 0.5);
      if (entered >= 0) break;
    }
    expect(tears).toEqual([5, 4, 3, 2, 1, 0]);
    expect(firstTear).toBeGreaterThan(BARRIER_RULES.tearTicks);
    expect(entered - vaultStarted).toBe(BARRIER_RULES.vaultTicks);
    expect(zombie.entry).toBeNull();
    expect(zombie.position).toEqual(NACHT_BARRIERS[0].insidePoint);
    for (let i = 0; i < 1200; i++) sim.tick();
    expect(zombie.targetId).toBe(sim.playerIds[0]);
    expect(sim.getPlayer(sim.playerIds[0])!.health).toBeLessThan(1000);
  });

  it.each(NACHT_BARRIERS.map((barrier, index) => ({ id: barrier.id, index })))
   ('completes exterior entry and interior pursuit from $id', ({ index }) => {
      const sim = makeSimulation(index);
      sim.state.doors.forEach(door => { door.open = true; });
      const player = sim.getPlayer(sim.playerIds[0])!;
      player.health = 100000;
      let entered = false;
      for (let tick = 0; tick < 3400; tick++) {
        if (sim.tick().some(event => event.type === 'zombieEntered')) entered = true;
      }
      const zombie = sim.zombies()[0];
      expect(entered).toBe(true);
      expect(zombie.entry).toBeNull();
      expect(Math.hypot(zombie.position.x - player.position.x, zombie.position.y - player.position.y,
        zombie.position.z - player.position.z)).toBeLessThan(1.1);
    });

  it('queues a group through a broken window without overlapping vaults', () => {
    const sim = makeSimulation(0, 3);
    sim.getPlayer(sim.playerIds[0])!.health = 100000;
    let crossings = 0, entered = 0;
    for (let tick = 0; tick < 1700; tick++) {
      const events = sim.tick();
      crossings += events.filter(event => event.type === 'zombieVaultStarted').length;
      entered += events.filter(event => event.type === 'zombieEntered').length;
      expect(sim.zombies().filter(zombie => zombie.entry?.phase === 'vaulting')).toHaveLength(crossings - entered);
      expect(crossings - entered).toBeLessThanOrEqual(1);
    }
    expect(entered).toBe(3);
  });

  it('does not melee players outside or during a vault', () => {
    const sim = makeSimulation(); sim.tick(); sim.tick();
    const zombie = sim.zombies()[0], player = sim.getPlayer(sim.playerIds[0])!;
    player.position = { ...zombie.position };
    zombie.targetId = player.id;
    expect(tickZombieMelee(zombie, [player])).toEqual([]);
    zombie.entry!.phase = 'vaulting';
    expect(tickZombieMelee(zombie, [player])).toEqual([]);
    expect(player.health).toBe(100);
  });

  it('allows shooting an attacker through the window and releases a killed vault occupant', () => {
    const sim = makeSimulation(0, 2);
    const player = sim.getPlayer(sim.playerIds[0])!;
    player.health = 100000;
    for (let tick = 0; tick < 1200 && sim.state.barriers[0].vaultingZombieId === null; tick++) sim.tick();
    const victim = sim.zombies().find(zombie => zombie.id === sim.state.barriers[0].vaultingZombieId)!;
    expect(victim).toBeDefined();
    const target = { x: victim.position.x, y: victim.position.y + 1.25, z: victim.position.z };
    const eye = { x: victim.position.x, y: 1.62, z: NACHT_BARRIERS[0].position.z + 1.5 };
    const direction = { x: target.x - eye.x, y: target.y - eye.y, z: target.z - eye.z };
    const length = Math.hypot(direction.x, direction.y, direction.z);
    direction.x /= length; direction.y /= length; direction.z /= length;
    for (let i = 0; i < 3; i++) {
      player.weapon.cooldownTicks = 0;
      firePlayerWeapon(player, { origin: eye, direction }, [victim], sim.collisionBoxes());
    }
    expect(victim.alive).toBe(false);
    let entered = false;
    for (let tick = 0; tick < 400; tick++) {
      if (sim.tick().some(event => event.type === 'zombieEntered')) entered = true;
    }
    expect(entered).toBe(true);
    expect(sim.state.barriers[0].vaultingZombieId).toBeNull();
  });

  it('keeps original spawn indexes after filtering out locked rooms', () => {
    const sim = new GameSimulation({ seed: 11, map, playerSpawns: [NACHT_PLAYER_SPAWN],
      roundConfig: { initialWaitTicks: 1, intermissionTicks: 9999 },
      spawnConfig: { baseZombieCount: 12, additionalPerRound: 0, spawnIntervalTicks: 0, maxAlive: 12 } });
    const events: SimulationEvent[] = [];
    for (let tick = 0; tick < 15; tick++) events.push(...sim.tick());
    const spawns = events.filter(event => event.type === 'zombieSpawned');
    expect(spawns).toHaveLength(12);
    for (const event of spawns) {
      expect(event.barrierId).toBe(NACHT_ZOMBIE_SPAWNS[event.spawnIndex].barrierId);
      expect(NACHT_BARRIERS.find(barrier => barrier.id === event.barrierId)!.insidePoint.x).toBeGreaterThan(0);
    }
  });
});

describe('barrier persistence and rebuilding', () => {
  it('requires holding E, resets progress on release, and rebuilds one board per second', () => {
    const sim = makeSimulation(0, 1, 9999);
    const player = sim.getPlayer(sim.playerIds[0])!;
    player.position = { ...NACHT_BARRIERS[0].insidePoint }; player.yaw = 0;
    const barrier = sim.state.barriers[0]; barrier.boards = 0;
    syncBarrierInteractables(sim.state.barriers, sim.interactables());
    const hold = createInputFrame(0);
    hold.actions.interact = { pressed: true, held: true, released: false, value: 1 };
    for (let i = 0; i < 30; i++) sim.tick({ [player.id]: hold });
    expect(barrier.boards).toBe(0);
    sim.tick(); expect(barrier.repairTicks).toBe(0);
    for (let i = 0; i < 59; i++) sim.tick({ [player.id]: hold });
    expect(barrier.boards).toBe(0);
    expect(sim.tick({ [player.id]: hold }).some(event => event.type === 'barrierBoardRepaired')).toBe(true);
    expect(barrier.boards).toBe(1);
    for (let i = 0; i < 60 * (NACHT_WINDOW_BOARDS - 1); i++) sim.tick({ [player.id]: hold });
    expect(barrier.boards).toBe(NACHT_WINDOW_BOARDS);
    expect(sim.interactionCandidate(player.id)).toBeNull();
    // Round-one repair earnings stop at the 40-point cap.
    expect(player.points).toBe(540);
  });

  it('never repairs into a zombie currently crossing the sill', () => {
    const sim = makeSimulation();
    const player = sim.getPlayer(sim.playerIds[0])!; player.health = 100000;
    for (let i = 0; i < 1200 && sim.state.barriers[0].vaultingZombieId === null; i++) sim.tick();
    player.position = { ...NACHT_BARRIERS[0].insidePoint }; player.yaw = 0;
    const hold = createInputFrame(0);
    hold.actions.interact = { pressed: true, held: true, released: false, value: 1 };
    for (let i = 0; i < 65; i++) sim.tick({ [player.id]: hold });
    expect(sim.state.barriers[0].boards).toBe(0);
  });

  it('replays entry state deterministically, including restore midway through a vault', () => {
    const a = makeSimulation(0, 3), b = makeSimulation(0, 3);
    a.getPlayer(a.playerIds[0])!.health = b.getPlayer(b.playerIds[0])!.health = 100000;
    for (let i = 0; i < 1900 && a.state.barriers[0].vaultingZombieId === null; i++) {
      expect(a.tick()).toEqual(b.tick());
    }
    expect(a.state.barriers[0].vaultingZombieId).not.toBeNull();
    b.state = JSON.parse(JSON.stringify(a.state));
    for (let i = 0; i < 200; i++) expect(a.tick()).toEqual(b.tick());
    expect(a.state).toEqual(b.state);
    a.restart(4848);
    expect(a.state.barriers.every(barrier => barrier.boards === NACHT_WINDOW_BOARDS && barrier.vaultingZombieId === null)).toBe(true);
    expect(a.zombies()).toEqual([]);
  });

  it('a group still needs the full tear interval for each board', () => {
    const barrier = createBarrier(NACHT_BARRIERS[0], 'e:10').state;
    const zombies = [0, 1, 2].map(i => {
      const zombie = createZombieState(`e:${i + 1}`, barrier.approachPath.at(-1)!, 1);
      zombie.entry = createZombieEntry(barrier.id, i); zombie.entry.phase = 'breaking';
      return zombie;
    });
    for (let tick = 0; tick < BARRIER_RULES.tearTicks - 1; tick++) {
      prepareBarriers([barrier], zombies);
      for (const zombie of zombies) updateZombieEntry(zombie, barrier, zombies, 1 / 60, [], tick);
    }
    expect(barrier.boards).toBe(NACHT_WINDOW_BOARDS);
    for (const zombie of zombies) updateZombieEntry(zombie, barrier, zombies, 1 / 60, [], 74);
    expect(barrier.boards).toBe(NACHT_WINDOW_BOARDS - 1);
  });

  it('makes the next attacker break rebuilt boards before entering', () => {
    const barrier = createBarrier(NACHT_BARRIERS[0], 'e:10').state;
    barrier.boards = 1;
    const zombie = createZombieState('e:2', barrier.approachPath.at(-1)!, 1);
    zombie.entry = createZombieEntry(barrier.id, 0); zombie.entry.phase = 'breaking';
    for (let tick = 0; tick < 74; tick++) updateZombieEntry(zombie, barrier, [zombie], 1 / 60, [], tick);
    expect(zombie.entry.phase).toBe('breaking');
    expect(barrier.boards).toBe(1);
    updateZombieEntry(zombie, barrier, [zombie], 1 / 60, [], 74);
    expect(barrier.boards).toBe(0);
    expect(updateZombieEntry(zombie, barrier, [zombie], 1 / 60, [], 75)[0]?.type).toBe('zombieVaultStarted');
  });

  it('counts zombies killed outside toward round completion', () => {
    const sim = makeSimulation(); sim.tick(); sim.tick();
    const zombie = sim.zombies()[0];
    expect(zombie.entry?.phase).toBe('approach');
    zombie.alive = false; zombie.health = 0;
    sim.tick(); sim.tick();
    expect(sim.state.round.phase).toBe('intermission');
    expect(sim.state.barriers[0].boards).toBe(NACHT_WINDOW_BOARDS);
  });

  it('all active inside landings have a path to the starting room with doors open', () => {
    const query = createNavigationQuery(NACHT_NAVIGATION, map.collisionBoxes, 0.32, map.walkSurfaces);
    for (const barrier of NACHT_BARRIERS) {
      expect(query(barrier.insidePoint, NACHT_PLAYER_SPAWN), barrier.id).not.toBe(barrier.insidePoint);
    }
  });
});
