import { GameSimulation, createZombieState, allocateEntityId, addEntity } from '../src/core/index.ts';
import { NACHT_DOORS, NACHT_NAVIGATION, NACHT_WALK_SURFACES, NACHT_BARRIERS,
  NACHT_ZOMBIE_SPAWNS, NACHT_SHOT_BLOCKERS, greyboxCollisionBoxes } from '../src/maps/nacht.ts';

const sim = new GameSimulation({ seed: 1, map: {
  collisionBoxes: greyboxCollisionBoxes(), shotBlockers: NACHT_SHOT_BLOCKERS,
  walkSurfaces: NACHT_WALK_SURFACES, navigationGraph: NACHT_NAVIGATION,
  barriers: NACHT_BARRIERS, zombieSpawns: NACHT_ZOMBIE_SPAWNS, doors: NACHT_DOORS,
}, playerSpawns: [{ x: 5.2, y: 0, z: 4.2 }],
roundConfig: { initialWaitTicks: 999999, intermissionTicks: 999999 } });
sim.getPlayer(sim.playerIds[0])!.godMode = true;
sim.state.doors.filter(door => door.id !== 'help-room').forEach(door => { door.open = true; });
for (let i = 0; i < 24; i++) {
  addEntity(sim.state.world, createZombieState(allocateEntityId(sim.state.world),
    { x: -6 + (i % 4) * 0.3, y: 0, z: -4 + Math.floor(i / 4) * 0.3 }, 1));
}
const samples: number[] = [];
for (let tick = 0; tick < 900; tick++) {
  const start = performance.now(); sim.tick();
  if (tick >= 60) samples.push(performance.now() - start);
}
samples.sort((a, b) => a - b);
console.log(JSON.stringify({ scenario: '24 zombies, HELP door shut, both stairs open',
  meanTickMs: samples.reduce((sum, value) => sum + value, 0) / samples.length,
  p95TickMs: samples[Math.floor(samples.length * 0.95)], maxTickMs: samples.at(-1) }, null, 2));
