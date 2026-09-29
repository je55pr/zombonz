import { describe, expect, it } from 'vitest';
import {
  CRAWLER, GORE_RULES, GameSimulation, LEGS_MASK, LIMB, ZOMBIE_MELEE, addEntity, awardCombatPoints, createPlayerState,
  createWeaponState, createZombieEntry, createZombieState, detonate, dismember, firePlayerWeapon, inMeleeReach, meleeAttack,
  updateZombiePursuit, zombieBody, zombiePose, type BodyPart, type EntityId, type GoreEvent, type PlayerState, type Vec3, type ZombieState,
} from '../src/core/index.ts';
import { applySnapshot, captureSnapshot } from '../src/net/snapshot.ts';
import { aimedFire, rayThrough } from './aim.ts';

/** A shooter at the origin with a gun, aiming down the sights, and a zombie of a round 4 m ahead. */
function scene(weapon: string, round: number, id: EntityId = 'e:2') {
  const player = createPlayerState('e:1', { x: 0, y: 0, z: 0 });
  player.weapon = createWeaponState(weapon); player.aiming = true;
  const zombie = createZombieState(id, { x: 0, y: 0, z: -4 }, round);
  return { player, zombie };
}
/** The middle of one of a zombie's parts (the calf and forearm for a limb: the outer capsule). */
function centreOf(zombie: ZombieState, part: BodyPart): Vec3 {
  const volumes = zombieBody(zombie).volumes().filter(volume => volume.part === part);
  const volume = volumes[volumes.length - 1];
  return { x: (volume.a.x + volume.b.x) / 2, y: (volume.a.y + volume.b.y) / 2, z: (volume.a.z + volume.b.z) / 2 };
}
function shoot(player: PlayerState, zombie: ZombieState, part: BodyPart) {
  const eye = { x: 0, y: 1.62, z: 0 };
  player.weapon.cooldownTicks = 0;
  return firePlayerWeapon(player, rayThrough(eye, centreOf(zombie, part)), [zombie], []);
}
const goreOf = (events: readonly { type: string }[]) => events.filter((event): event is GoreEvent => event.type === 'zombieDismembered');

describe('what takes a limb off', () => {
  it('needs a hit worth a tenth of the zombie’s health: a rifle round takes an arm in round one, but not in round ten', () => {
    const early = scene('kar98k', 1);
    const [gore] = goreOf(shoot(early.player, early.zombie, 'armL'));
    expect(gore).toMatchObject({ zombieId: early.zombie.id, lost: ['armL'], part: 'armL', source: 'bullet', lethal: false, crawler: false });
    expect(early.zombie.limbs).toBe(LIMB.armL);
    const late = scene('kar98k', 10);
    expect(100 / late.zombie.health).toBeLessThan(GORE_RULES.minShare);
    expect(goreOf(shoot(late.player, late.zombie, 'armL'))).toEqual([]);
    expect(late.zombie.limbs).toBe(0);
  });

  it('never takes one with the starting pistol, as no pistol but the .357 does in WaW; the magnum does', () => {
    const pistol = scene('starter-pistol', 1);
    for (const part of ['armL', 'legL', 'torso'] as const) {
      pistol.zombie.health = 150;
      expect(goreOf(shoot(pistol.player, pistol.zombie, part)), part).toEqual([]);
    }
    expect(pistol.zombie.limbs).toBe(0);
    const magnum = scene('magnum-357', 2);
    expect(goreOf(shoot(magnum.player, magnum.zombie, 'armR'))).toHaveLength(1);
  });

  it('takes the head only with the shot that kills', () => {
    const wounded = scene('kar98k', 5);
    expect(goreOf(shoot(wounded.player, wounded.zombie, 'head'))).toEqual([]);
    expect(wounded.zombie.alive).toBe(true);
    const doomed = scene('kar98k', 1);
    const [gore] = goreOf(shoot(doomed.player, doomed.zombie, 'head'));
    expect(doomed.zombie.alive).toBe(false);
    expect(gore).toMatchObject({ lost: ['head'], part: 'head', lethal: true });
    expect(doomed.zombie.limbs & LIMB.head).toBe(LIMB.head);
  });

  it('does not take limbs off with a knife, or off a gun that chains lightning', () => {
    const player = createPlayerState('e:1', { x: 0, y: 0, z: 0 });
    const close = createZombieState('e:2', { x: 0, y: 0, z: -1 }, 1);
    expect(goreOf(meleeAttack(player, [close], []))).toEqual([]);
    expect(close.limbs).toBe(0);
    const zap = scene('molniya', 1);
    expect(goreOf(shoot(zap.player, zap.zombie, 'armL'))).toEqual([]);
  });

  it('takes what a hit on the torso opens up or an arm, about half each, and always the same for the same shot', () => {
    let guts = 0, arms = 0;
    for (let id = 2; id < 202; id++) {
      const { player, zombie } = scene('kar98k', 1, `e:${id}` as EntityId);
      const [gore] = goreOf(shoot(player, zombie, 'torso'));
      expect(gore).toBeDefined();
      if (gore.gutted) { guts++; expect(gore.lost).toEqual([]); } else { arms++; expect(gore.lost).toHaveLength(1); expect(gore.lost[0]).toMatch(/^arm/); }
    }
    expect(guts).toBeGreaterThan(60); expect(guts).toBeLessThan(140);
    const again = scene('kar98k', 1, 'e:7'), first = goreOf(shoot(again.player, again.zombie, 'torso'));
    const repeat = scene('kar98k', 1, 'e:7');
    expect(goreOf(shoot(repeat.player, repeat.zombie, 'torso'))).toEqual(first);
  });

  it('cannot take what is already gone', () => {
    const { player, zombie } = scene('bar', 1);
    zombie.health = 5000; zombie.limbs = LIMB.armL;
    // With an arm gone its capsules are gone too, so a torso hit takes the other arm or opens the torso, never the same one twice.
    for (let shot = 0; shot < 20; shot++) for (const gore of goreOf(shoot(player, zombie, 'torso'))) expect(gore.lost).not.toContain('armL');
  });
});

describe('a crawler is made by losing a leg and surviving', () => {
  it('takes a leg from a hit strong enough, leaves the zombie alive, and says it is a crawler now', () => {
    const { player, zombie } = scene('kar98k', 2);
    const [gore] = goreOf(shoot(player, zombie, 'legL'));
    expect(zombie.alive).toBe(true);
    expect(gore).toMatchObject({ lost: expect.arrayContaining(['legL']), crawler: true, lethal: false });
    expect(zombie.limbs & LEGS_MASK).not.toBe(0);
    expect(zombiePose(zombie)).toBe('crawl');
    // Its next leg wound is not news: it is a crawler already.
    const second = goreOf(shoot(player, zombie, zombie.limbs & LIMB.legR ? 'legL' : 'legR'));
    for (const event of second) expect(event.crawler).toBe(false);
  });

  it('needs a real blow to lose a leg it can live without: a fifth of its health', () => {
    const weak = scene('thompson', 5);
    expect(65 / weak.zombie.health).toBeGreaterThanOrEqual(GORE_RULES.minShare);
    expect(65 / weak.zombie.health).toBeLessThan(GORE_RULES.legShare);
    expect(goreOf(shoot(weak.player, weak.zombie, 'legL'))).toEqual([]);
    expect(weak.zombie.limbs).toBe(0);
  });

  it('loses both legs a quarter of the time', () => {
    let both = 0;
    for (let id = 2; id < 302; id++) {
      const { player, zombie } = scene('kar98k', 1, `e:${id}` as EntityId);
      zombie.health = 400;
      shoot(player, zombie, 'legR');
      if ((zombie.limbs & LEGS_MASK) === LEGS_MASK) both++;
    }
    expect(both).toBeGreaterThan(30); expect(both).toBeLessThan(120);
  });

  it('is a blast’s doing as well: a grenade at its feet makes crawlers of those it does not kill', () => {
    const near = createZombieState('e:2', { x: 0.4, y: 0, z: 0 }, 5), far = createZombieState('e:3', { x: 2.6, y: 0, z: 0 }, 5);
    const events = detonate({ x: 0, y: 0.1, z: 0 }, { radius: 4, damage: 350, playerDamage: 100 }, 'e:1', 'owner',
      { zombies: [near, far], players: [], boxes: [], instaKill: false });
    const gore = goreOf(events);
    expect(near.alive && far.alive).toBe(true);
    expect(gore.length).toBeGreaterThan(0);
    for (const event of gore) expect(event).toMatchObject({ part: null, source: 'explosion', playerId: 'e:1' });
    expect([near, far].some(zombie => zombie.limbs & LEGS_MASK)).toBe(true);
  });
});

describe('explosions tear zombies apart', () => {
  const blast = { radius: 4, damage: 2000, playerDamage: 100 };
  const context = (zombies: ZombieState[]) => ({ zombies, players: [], boxes: [], instaKill: false });

  it('kills close in leave less of the zombie than kills far out, and take the head from one that dies under it', () => {
    const under = createZombieState('e:2', { x: 0.2, y: 0, z: 0 }, 1), edge = createZombieState('e:3', { x: 0, y: 0, z: -3.7 }, 1);
    edge.health = 150;
    detonate({ x: 0, y: 0.9, z: 0 }, blast, 'e:1', 'owner', context([under, edge]));
    expect(under.alive).toBe(false);
    const count = (limbs: number) => [LIMB.head, LIMB.armL, LIMB.armR, LIMB.legL, LIMB.legR].filter(bit => limbs & bit).length;
    expect(count(under.limbs)).toBeGreaterThanOrEqual(3);
    expect(under.limbs & LIMB.head).toBe(LIMB.head);
    expect(count(under.limbs)).toBeGreaterThan(count(edge.limbs));
  });

  it('takes the limbs nearest the blast first', () => {
    const zombie = createZombieState('e:2', { x: 0, y: 0, z: 0 }, 1);
    zombie.health = 2000;
    // Centre left of the zombie, at hand height: its left arm goes before anything else.
    const left = zombieBody(zombie).volumes().find(volume => volume.part === 'armL')!;
    zombie.health = 150;
    const events = detonate({ x: left.b.x + 0.1, y: left.b.y, z: left.b.z }, { radius: 4, damage: 30, playerDamage: 1 }, 'e:1', 'owner', context([zombie]));
    // A blast this close takes a second limb as well (the other arm is next nearest), but never a leg from so weak a hit.
    expect(goreOf(events)[0].lost[0]).toBe('armL');
    expect(zombie.limbs & LEGS_MASK).toBe(0);
  });

  it('is weaker for a far, weak blast: no limbs under a tenth of the zombie’s health', () => {
    const zombie = createZombieState('e:2', { x: 3.5, y: 0, z: 0 }, 10);
    detonate({ x: 0, y: 0.9, z: 0 }, { radius: 4, damage: 350, playerDamage: 100 }, 'e:1', 'owner', context([zombie]));
    expect(zombie.limbs).toBe(0);
  });

  it('never dismembers on a blow that does no damage', () => {
    const zombie = createZombieState('e:2', { x: 0, y: 0, z: 0 }, 1);
    expect(dismember(zombie, { source: 'explosion', credit: 'e:1', damage: 0, healthBefore: 150, point: { x: 0, y: 0, z: 0 }, scale: 1, gibs: true })).toEqual([]);
  });
});

describe('crawling', () => {
  const crawlerAfter = (gait: 'walk' | 'run' | 'sprint', ticks: number) => {
    const zombie = createZombieState('e:2', { x: 0, y: 0, z: 0 }, 1, gait);
    zombie.limbs = LIMB.legL;
    const player = createPlayerState('e:1', { x: 40, y: 0, z: 0 });
    for (let tick = 0; tick < ticks; tick++) updateZombiePursuit(zombie, [player], 1 / 60, [], []);
    return zombie.position.x;
  };

  it('is slower than a runner or a sprinter, and no slower than a walker', () => {
    expect(crawlerAfter('sprint', 60)).toBeCloseTo(CRAWLER.speed, 1);
    expect(crawlerAfter('run', 60)).toBeCloseTo(CRAWLER.speed, 1);
    expect(crawlerAfter('walk', 60)).toBeCloseTo(0.8, 1);
  });

  it('fits under what a standing zombie cannot pass: a beam a metre up blocks one and not the other', () => {
    const beam = [{ min: { x: 2, y: 0.9, z: -3 }, max: { x: 2.3, y: 1.4, z: 3 } }];
    const walk = (crawl: boolean) => {
      const zombie = createZombieState('e:2', { x: 0, y: 0, z: 0 }, 1, 'run');
      if (crawl) zombie.limbs = LIMB.legR;
      const player = createPlayerState('e:1', { x: 10, y: 0, z: 0 });
      for (let tick = 0; tick < 600; tick++) updateZombiePursuit(zombie, [player], 1 / 60, beam, []);
      return zombie.position.x;
    };
    expect(walk(false)).toBeLessThan(2);
    expect(walk(true)).toBeGreaterThan(8);
  });

  it('reaches less far: a swing that a standing zombie starts from 1 m, a crawler starts from under 0.9 m', () => {
    const player = createPlayerState('e:1', { x: 0, y: 0, z: 0 });
    const at = (crawl: boolean, distance: number) => {
      const zombie = createZombieState('e:2', { x: 0, y: 0, z: distance }, 1);
      if (crawl) zombie.limbs = LIMB.legL;
      return inMeleeReach(zombie, player, [], (crawl ? ZOMBIE_MELEE.crawlerReach : ZOMBIE_MELEE.reach).startRange);
    };
    expect(at(false, 1.0)).toBe(true);
    expect(at(true, 1.0)).toBe(false);
    expect(at(true, 0.85)).toBe(true);
  });

  it('still hunts, still hits, and can still be killed, for the usual points', () => {
    const sim = new GameSimulation({ seed: 3, playerSpawns: [{ x: 0, y: 0, z: 0 }], roundConfig: { initialWaitTicks: 999999, intermissionTicks: 999999 },
      map: { collisionBoxes: [], walkSurfaces: [], zombieSpawns: [] } });
    const player = sim.players()[0];
    const crawler = createZombieState('e:20', { x: 0, y: 0, z: -6 }, 1);
    crawler.limbs = LIMB.legL | LIMB.legR;
    addEntity(sim.state.world, crawler);
    let hits = 0;
    for (let tick = 0; tick < 700 && !player.downed; tick++) for (const event of sim.tick()) if (event.type === 'zombieAttacked') hits++;
    // Two blows put a player down, and alone with no Quick Revive that is the end of them.
    expect(hits).toBe(2);
    expect(player.alive).toBe(false);
    // And shot, it dies as any zombie does, and pays.
    const shooter = createPlayerState('e:1', { x: 0, y: 0, z: 0 });
    shooter.aiming = true;
    const target = createZombieState('e:30', { x: 0, y: 0, z: -4 }, 1);
    target.limbs = LIMB.legL | LIMB.legR;
    const events = shoot(shooter, target, 'head');
    events.push(...shoot(shooter, target, 'head'));
    expect(target.alive).toBe(false);
    expect(awardCombatPoints(shooter, events).map(award => award.amount)).toContain(90);
  });

  it('is network-safe: the limbs survive a snapshot and a round trip through JSON, and replay identically', () => {
    const run = () => {
      const sim = new GameSimulation({ seed: 9, playerSpawns: [{ x: 0, y: 0, z: 0 }], roundConfig: { initialWaitTicks: 999999, intermissionTicks: 999999 },
        map: { collisionBoxes: [], walkSurfaces: [], zombieSpawns: [] } });
      const zombie = createZombieState('e:20', { x: 0, y: 0, z: -4 }, 2);
      addEntity(sim.state.world, zombie);
      const player = sim.players()[0];
      player.weapon = createWeaponState('kar98k'); player.aiming = true;
      shoot(player, zombie, 'legL');
      for (let tick = 0; tick < 120; tick++) sim.tick();
      return { sim, zombie };
    };
    const { sim, zombie } = run();
    expect(zombie.limbs & LEGS_MASK).not.toBe(0);
    const copy = new GameSimulation({ seed: 9, playerSpawns: [{ x: 0, y: 0, z: 0 }], roundConfig: { initialWaitTicks: 999999, intermissionTicks: 999999 },
      map: { collisionBoxes: [], walkSurfaces: [], zombieSpawns: [] } });
    applySnapshot(copy, JSON.parse(JSON.stringify(captureSnapshot(sim))));
    const mirrored = copy.state.world.entities[zombie.id] as ZombieState;
    expect(mirrored.limbs).toBe(zombie.limbs);
    expect(mirrored.position).toEqual(zombie.position);
    expect(JSON.stringify(run().sim.state)).toBe(JSON.stringify(sim.state));
  });
});

describe('a climber that loses its legs falls', () => {
  const climb = [{ x: 0, y: 0, z: -12 }, { x: 0, y: 0, z: -6 }, { x: 0, y: 3.4, z: -6 }, { x: 0, y: 3.4, z: -5 }];
  const simWith = (path: Vec3[], height: number) => {
    const sim = new GameSimulation({ seed: 9, playerSpawns: [{ x: 0, y: 0, z: 0 }], roundConfig: { initialWaitTicks: 999999, intermissionTicks: 999999 },
      map: { collisionBoxes: [], walkSurfaces: [], zombieSpawns: [], barriers: [{ id: 'w', position: { x: 0, y: 3.4, z: -4.5 }, outward: { x: 0, y: 0, z: -1 },
        width: 1.2, maxBoards: 3, approachPath: path, insidePoint: { x: 0, y: 3.4, z: -2 } }] } });
    const zombie = createZombieState('e:20', { x: 0, y: height, z: -6 }, 2);
    zombie.entry = createZombieEntry('w', 0); zombie.entry.waypointIndex = 2;
    addEntity(sim.state.world, zombie);
    const player = sim.players()[0];
    player.weapon = createWeaponState('kar98k');
    return { sim, zombie, player };
  };

  it('is shot off a wall and dies for the shooter, scored as a kill, rather than clinging on as a crawler', () => {
    const { sim, zombie, player } = simWith(climb, 1.7);
    const events = sim.tick({ [player.id]: aimedFire(player, centreOf(zombie, 'legL')) });
    expect(goreOf(events)[0]?.crawler).toBe(true);
    expect(events).toContainEqual(expect.objectContaining({ type: 'zombieDied', zombieId: zombie.id, method: 'fall', playerId: player.id }));
    expect(events).toContainEqual(expect.objectContaining({ type: 'pointsAwarded', reason: 'kill' }));
    expect(zombie.alive).toBe(false);
    expect(zombie.position.y).toBe(0);
    expect(player.kills).toBe(1);
  });

  it('keeps its life at a ground-floor window, where nothing is climbed, and crawls on', () => {
    const { sim, zombie, player } = simWith([{ x: 0, y: 0, z: -12 }, { x: 0, y: 0, z: -6 }, { x: 0, y: 0, z: -5 }], 0);
    const events = sim.tick({ [player.id]: aimedFire(player, centreOf(zombie, 'legL')) });
    expect(goreOf(events)[0]?.crawler).toBe(true);
    expect(events.filter(event => event.type === 'zombieDied')).toEqual([]);
    expect(zombie.alive).toBe(true);
    expect(zombiePose(zombie)).toBe('crawl');
  });
});
