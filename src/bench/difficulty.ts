import {
  GameSimulation, PLAYER_MOVEMENT, SPRINT_RULES, ZOMBIE_GAIT_SPEEDS, SeededRng, addEntity, allocateEntityId, createInputFrame,
  createZombieState, zombieGaitForRound, type ActionState, type GameAction, type InputFrame, type PlayerState, type Vec3,
  type ZombieGait, type ZombieState,
} from '../core/index.ts';

/**
 * Measurements of how the game feels to play against, for `npm run difficulty` and the tests that pin the feel
 * (`test/zombie-difficulty.test.ts`): a scripted player is chased by zombies, or dashes through a dense group of them,
 * on open ground. Everything is seeded and scripted, so two runs give the same numbers tick for tick.
 *
 * The player faces -z (the way a fresh player looks) and moves along it; zombies start on the +z side for a chase and on
 * the -z side for a dash.
 */

const HELD: ActionState = { held: true, pressed: false, released: false, value: 1 };

/** What the scripted player does: stands still, walks, or sprints whenever the stamina lets them. */
export type SprintPlan = 'stand' | 'walk' | 'sprint';

/** A match on flat, empty ground with one player (who cannot be killed) and no round to spawn anything. */
export function openGround(playerAt: Vec3): GameSimulation {
  const sim = new GameSimulation({ seed: 1, map: { collisionBoxes: [], walkSurfaces: [], zombieSpawns: [] }, playerSpawns: [playerAt],
    roundConfig: { initialWaitTicks: 2147483647, intermissionTicks: 2147483647 } });
  // Down or not, blows are counted; the run is about how many land, not the moment the player falls.
  sim.getPlayer(sim.playerIds[0])!.godMode = true;
  return sim;
}

/** An input frame with these actions held, and the player turning by `yaw`. */
export function frameFor(tick: number, actions: readonly GameAction[], yaw = 0): InputFrame {
  const frame = createInputFrame(tick);
  for (const action of actions) frame.actions[action] = { ...HELD };
  frame.look.yaw = yaw;
  return frame;
}

/** The turn (radians) that takes a player facing `yaw` round to face `heading`, clamped to `limit`. */
function turnToward(yaw: number, heading: number, limit: number): number {
  const difference = Math.atan2(Math.sin(heading - yaw), Math.cos(heading - yaw));
  return Math.max(-limit, Math.min(limit, difference));
}

/** The yaw at which a player moves along the direction (x, z). */
const yawOf = (x: number, z: number): number => Math.atan2(-x, -z);

// ---- chase --------------------------------------------------------------------------------------------------------

export interface ChaseOptions {
  /** The zombie's gait and speed (default: the gait's standard speed). */
  gait?: ZombieGait;
  speed?: number;
  plan: SprintPlan;
  /** Metres between the player and the zombie at the start (default 3). */
  startGap?: number;
  seconds?: number;
}

export interface ChaseResult {
  /** Metres between the zombie and the player at the end of each second. */
  gaps: number[];
  /** The second at which the zombie's first blow landed, if one did. */
  firstHitSecond: number | null;
  /** How many seconds the player was sprinting. */
  sprintSeconds: number;
}

/** A player runs in a straight line with a zombie on their heels: does the gap open, hold or close? */
export function runChase(options: ChaseOptions): ChaseResult {
  const sim = openGround({ x: 0, y: 0, z: 0 });
  const player = sim.getPlayer(sim.playerIds[0])!;
  const zombie = createZombieState(allocateEntityId(sim.state.world), { x: 0, y: 0, z: options.startGap ?? 3 }, 15, options.gait ?? 'sprint');
  if (options.speed !== undefined) zombie.moveSpeed = options.speed;
  zombie.yaw = Math.PI;
  addEntity(sim.state.world, zombie);
  const seconds = options.seconds ?? 20, gaps: number[] = [];
  let firstHitSecond: number | null = null, sprinting = 0;
  for (let tick = 0; tick < seconds * 60; tick++) {
    const events = sim.tick({ [player.id]: frameFor(tick, options.plan === 'sprint' ? ['moveForward', 'sprint'] : options.plan === 'walk' ? ['moveForward'] : []) });
    if (player.sprinting) sprinting += 1;
    if (firstHitSecond === null && events.some(event => event.type === 'zombieAttacked')) firstHitSecond = tick / 60;
    if (tick % 60 === 59) gaps.push(Math.hypot(zombie.position.x - player.position.x, zombie.position.z - player.position.z));
  }
  return { gaps, firstHitSecond, sprintSeconds: sprinting / 60 };
}

// ---- dash through a crowd -----------------------------------------------------------------------------------------

/** How the scripted player gets through: straight at the goal, or steering round the zombies near them. */
export type Approach = 'dash' | 'weave';

export interface CrowdOptions {
  zombies?: number;
  gait?: ZombieGait;
  approach: Approach;
  plan?: SprintPlan;
  /** Seeds the crowd's layout. */
  seed?: number;
  seconds?: number;
}

export interface CrowdResult {
  /** Blows that landed on the player before they reached the far side (or the time ran out). */
  hits: number;
  /** Seconds the player took to get 6 m past the crowd's far edge, or null if they never did. */
  seconds: number | null;
  /** The nearest a zombie's middle came to the player's (a body is 0.66 across, so under that, they overlapped). */
  closest: number;
  /** Seconds the player spent overlapping some zombie by more than a fifth of a body. */
  overlapSeconds: number;
}

/** The crowd's zombies, in a jittered grid four metres wide, starting six metres in front of the player. */
function crowdPositions(count: number, seed: number): Vec3[] {
  const rng = new SeededRng(seed), columns = 4;
  return Array.from({ length: count }, (_, index) => ({
    x: (index % columns - (columns - 1) / 2) * 1.1 + rng.next() * 0.4 - 0.2,
    y: 0,
    z: -6 - Math.floor(index / columns) * 1.1 + rng.next() * 0.4 - 0.2,
  }));
}

/** A player runs at a dense group coming the other way and tries to get past it. */
export function runCrowd(options: CrowdOptions): CrowdResult {
  const sim = openGround({ x: 0, y: 0, z: 0 });
  const player = sim.getPlayer(sim.playerIds[0])!;
  const count = options.zombies ?? 12;
  const crowd: ZombieState[] = crowdPositions(count, options.seed ?? 1).map(position => {
    const zombie = createZombieState(allocateEntityId(sim.state.world), position, 15, options.gait ?? 'run');
    addEntity(sim.state.world, zombie);
    return zombie;
  });
  const farEdge = Math.min(...crowd.map(zombie => zombie.position.z));
  const goal = { x: 0, z: farEdge - 6 }, seconds = options.seconds ?? 12, actions: GameAction[] = ['moveForward'];
  if ((options.plan ?? 'sprint') === 'sprint') actions.push('sprint');
  let hits = 0, reached: number | null = null, closest = Infinity, overlapping = 0;
  for (let tick = 0; tick < seconds * 60; tick++) {
    let heading = yawOf(goal.x - player.position.x, goal.z - player.position.z);
    if (options.approach === 'weave') heading = weave(player, crowd, goal);
    const events = sim.tick({ [player.id]: frameFor(tick, actions, turnToward(player.yaw, heading, 0.3)) });
    hits += events.filter(event => event.type === 'zombieAttacked').length;
    const nearest = Math.min(...crowd.filter(zombie => zombie.alive).map(zombie =>
      Math.hypot(zombie.position.x - player.position.x, zombie.position.z - player.position.z)));
    closest = Math.min(closest, nearest);
    if (nearest < PLAYER_MOVEMENT.radius + 0.32 - 0.13) overlapping += 1;
    if (reached === null && player.position.z <= goal.z) { reached = tick / 60; break; }
  }
  return { hits, seconds: reached, closest, overlapSeconds: overlapping / 60 };
}

// ---- run up to a zombie and away again ----------------------------------------------------------------------------

export interface RunUpOptions {
  gait?: ZombieGait;
  /** How near the player gets before they turn and run: a body is 0.66 across, so under that they are touching it. */
  turnAt: number;
  plan?: SprintPlan;
  /** Entity ids to use up first, so that each run has a zombie with its own tempo. */
  variant?: number;
}

export interface RunUpResult {
  /** Blows that landed, from the start of the run until the player was seconds clear. */
  hits: number;
  /** How far the zombie was from the player's middle when it began its first swing, or null if it never swung. */
  swingBeganAt: number | null;
}

/**
 * The way zombies are trained: the player runs at one that is coming for them, turns at `turnAt` metres and runs away
 * again. Does it swing early enough for the blow to land as they arrive, or do they get in and out untouched?
 */
export function runRunUp(options: RunUpOptions): RunUpResult {
  const sim = openGround({ x: 0, y: 0, z: 0 });
  const player = sim.getPlayer(sim.playerIds[0])!;
  for (let i = 0; i < (options.variant ?? 0); i++) allocateEntityId(sim.state.world);
  const zombie = createZombieState(allocateEntityId(sim.state.world), { x: 0, y: 0, z: -7 }, 15, options.gait ?? 'sprint');
  addEntity(sim.state.world, zombie);
  const actions: GameAction[] = (options.plan ?? 'walk') === 'sprint' ? ['moveForward', 'sprint'] : ['moveForward'];
  let hits = 0, swingBeganAt: number | null = null, turned = -1;
  for (let tick = 0; tick < 12 * 60; tick++) {
    const distance = Math.hypot(zombie.position.x - player.position.x, zombie.position.z - player.position.z);
    const turn = turned < 0 && distance <= options.turnAt;
    if (turn) turned = tick;
    const events = sim.tick({ [player.id]: frameFor(tick, actions, turn ? Math.PI : 0) });
    hits += events.filter(event => event.type === 'zombieAttacked').length;
    if (swingBeganAt === null && events.some(event => event.type === 'zombieSwung')) swingBeganAt = distance;
    if (turned >= 0 && tick - turned > 5 * 60) break;
  }
  return { hits, swingBeganAt };
}

/** The way a player steering round zombies would face: for the goal, bent away from every zombie within 2.5 m. */
function weave(player: PlayerState, crowd: readonly ZombieState[], goal: { x: number; z: number }): number {
  let hx = goal.x - player.position.x, hz = goal.z - player.position.z;
  const length = Math.hypot(hx, hz) || 1;
  hx /= length; hz /= length;
  for (const zombie of crowd) {
    if (!zombie.alive) continue;
    const dx = player.position.x - zombie.position.x, dz = player.position.z - zombie.position.z, distance = Math.hypot(dx, dz);
    if (distance > 2.5 || distance < 1e-6) continue;
    const push = (2.5 - distance) / 2.5 * 2.2 / distance;
    hx += dx * push; hz += dz * push;
  }
  return yawOf(hx, hz);
}

// ---- report -------------------------------------------------------------------------------------------------------

/** Each round's mix of gaits, from the gait roll (the same one the spawner uses). */
export function gaitMix(round: number, samples = 4000): Record<ZombieGait, number> {
  const counts = { walk: 0, run: 0, sprint: 0 };
  for (let i = 0; i < samples; i++) counts[zombieGaitForRound(round, new SeededRng(i * 7919 + 1))] += 1;
  return { walk: counts.walk / samples, run: counts.run / samples, sprint: counts.sprint / samples };
}

/** Group sizes the report crosses. */
const CROWD_SIZES = [1, 2, 3, 6, 12] as const;
/** How near the player gets before turning away, in the run-up rows. */
const TURN_DISTANCES = [0.7, 2.5, 4] as const;

/** The measurements as text, for the console. */
export function formatDifficulty(): string {
  const lines: string[] = [];
  const speeds = ZOMBIE_GAIT_SPEEDS;
  lines.push(`Speeds (m/s): player walks ${PLAYER_MOVEMENT.maxSpeed}, sprints ${(PLAYER_MOVEMENT.maxSpeed * PLAYER_MOVEMENT.sprintMultiplier).toFixed(1)} for ${SPRINT_RULES.maxTicks / 60} s;`
    + ` zombies walk ${speeds.walk}, run ${speeds.run}, sprint ${speeds.sprint} (a sprinter is ${Math.round(speeds.sprint / PLAYER_MOVEMENT.maxSpeed * 100)}% of the player's walk)`);
  lines.push('', 'Gait mix by round (walk / run / sprint, %):');
  for (const round of [1, 2, 3, 5, 6, 8, 10, 15, 30]) {
    const mix = gaitMix(round);
    lines.push(`  round ${String(round).padStart(2)}: ${[mix.walk, mix.run, mix.sprint].map(share => String(Math.round(share * 100)).padStart(3)).join(' / ')}`);
  }
  lines.push('', `Chase: a sprinter 3 m behind a player on open ground; the gap in metres after 1, 5, 10 and 20 s`);
  for (const plan of ['walk', 'sprint'] as const) {
    const chase = runChase({ gait: 'sprint', plan });
    lines.push(`  player ${plan === 'walk' ? 'walking' : 'sprinting when they can'}: ${[0, 4, 9, 19].map(i => chase.gaps[i].toFixed(1).padStart(5)).join(' ')}`
      + `${chase.firstHitSecond === null ? '  never hit' : `  first hit at ${chase.firstHitSecond.toFixed(1)} s`}`);
  }
  lines.push('', 'Crossing a group of running zombies coming the other way, sprinting (blows taken / layouts got through, of 6):');
  lines.push(`  zombies in the group:  ${CROWD_SIZES.map(size => String(size).padStart(8)).join('')}`);
  for (const approach of ['dash', 'weave'] as const) {
    const cells = CROWD_SIZES.map(zombies => {
      const results = [1, 2, 3, 4, 5, 6].map(seed => runCrowd({ approach, seed, zombies, seconds: 8 }));
      const hits = results.reduce((sum, result) => sum + result.hits, 0) / results.length;
      return `${hits.toFixed(1)}/${results.filter(result => result.seconds !== null).length}`.padStart(8);
    });
    lines.push(`  ${approach === 'dash' ? 'straight through' : 'steering round '}:      ${cells.join('')}`);
  }
  lines.push('', 'Running up to a sprinter and away again: blows taken per run (mean of 6 tempos) / how far off it began its swing, m');
  lines.push(`  the player turns at:   ${TURN_DISTANCES.map(metres => `${metres} m`.padStart(12)).join('')}`);
  for (const plan of ['walk', 'sprint'] as const) {
    const cells = TURN_DISTANCES.map(turnAt => {
      const results = [0, 1, 2, 3, 4, 5].map(variant => runRunUp({ turnAt, plan, variant }));
      const hits = results.reduce((sum, result) => sum + result.hits, 0) / results.length;
      const began = results.flatMap(result => result.swingBeganAt === null ? [] : [result.swingBeganAt]);
      const at = began.length ? (began.reduce((sum, value) => sum + value, 0) / began.length).toFixed(1) : '-';
      return `${hits.toFixed(1)} / ${at}`.padStart(12);
    });
    lines.push(`  ${plan === 'walk' ? 'walking' : 'sprinting'}:            ${cells.join('')}`);
  }
  return lines.join('\n');
}
