/// <reference types="vite/client" />
import * as THREE from 'three';
import { buildGreybox } from './client/greybox.ts';
import { buildBunkerDetails } from './client/bunker.ts';
import { createZombieView, type ZombieView } from './client/zombieView.ts';
import { BrowserInput } from './client/input.ts';
import { PerformanceOverlay } from './client/performance.ts';
import { batchStaticMeshes } from './client/staticBatch.ts';
import { ActorBatch } from './client/actorBatch.ts';
import { interpolatePosition } from './client/interpolation.ts';
import { CanvasHud, buildHudSnapshot } from './client/hud.ts';
import {
  FixedStepClock, GameSimulation, PLAYER_MOVEMENT, type EntityId, type ZombieState, type Vec3,
} from './core/index.ts';
import {
  NACHT_DOORS, NACHT_GREYBOX, NACHT_NAVIGATION, NACHT_PLAYER_SPAWN, NACHT_WALK_SURFACES, NACHT_ZOMBIE_SPAWNS, NACHT_WALL_WEAPONS, NACHT_MYSTERY_BOXES,
  greyboxCollisionBoxes, NACHT_SHOT_BLOCKERS, NACHT_BARRIERS,
} from './maps/nacht.ts';

const canvas = document.querySelector<HTMLCanvasElement>('#game');
if (!canvas) throw new Error('Missing #game canvas.');

const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(devicePixelRatio, 1));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.autoClear = false;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.35;

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x1d2b30);
scene.fog = new THREE.FogExp2(0x1d2b30, 0.027);

const camera = new THREE.PerspectiveCamera(67, 1, 0.05, 80);
camera.rotation.order = 'YXZ';
scene.add(new THREE.HemisphereLight(0xaabfc9, 0x373026, 1.4));
const keyLight = new THREE.DirectionalLight(0xb4ced7, 2.4);
keyLight.position.set(-12, 22, -16);
keyLight.castShadow = true;
keyLight.shadow.mapSize.set(1024, 1024);
Object.assign(keyLight.shadow.camera, { left: -15, right: 15, top: 15, bottom: -15, far: 65 });
keyLight.shadow.bias = -0.0006;
scene.add(keyLight);
scene.add(buildGreybox(NACHT_GREYBOX));
const bunker = buildBunkerDetails(scene);
batchStaticMeshes(scene);

// Development-only inspection views for iterating on the map without a running wave.
const previewViews = {
  start: { position: { x: -3, y: 0, z: 4 }, yaw: -0.25 },
  help: { position: { x: 3, y: 0, z: -3.1 }, yaw: 0.73 },
  upstairs: { position: { x: 3, y: 3.4, z: 4 }, yaw: 0.5 },
  barrier: { position: { x: -5, y: 0, z: -4.9 }, yaw: 0 },
  stress: { position: { x: -3, y: 0, z: 4 }, yaw: -0.25 },
};
const previewName = new URLSearchParams(location.search).get('preview');
const preview = import.meta.env.DEV && previewName && Object.hasOwn(previewViews, previewName)
  ? previewViews[previewName as keyof typeof previewViews] : null;

const simulation = new GameSimulation({
  seed: 0x5a0b0a2,
  map: {
    collisionBoxes: greyboxCollisionBoxes(),
    shotBlockers: NACHT_SHOT_BLOCKERS,
    walkSurfaces: NACHT_WALK_SURFACES,
    zombieSpawns: preview && previewName === 'barrier' ? [NACHT_ZOMBIE_SPAWNS[0]] : NACHT_ZOMBIE_SPAWNS,
    barriers: NACHT_BARRIERS,
    navigationGraph: NACHT_NAVIGATION,
    doors: NACHT_DOORS,
    wallWeapons: NACHT_WALL_WEAPONS,
    mysteryBoxes: NACHT_MYSTERY_BOXES,
  },
  playerSpawns: [preview?.position ?? NACHT_PLAYER_SPAWN],
  ...(previewName === 'stress' && preview ? { spawnConfig: {
    baseZombieCount: 24, additionalPerRound: 0, spawnIntervalTicks: 1, maxAlive: 24,
  } } : {}),
  ...(preview ? { roundConfig: { initialWaitTicks: previewName === 'barrier' || previewName === 'stress' ? 120 : 2147483647, intermissionTicks: 180 },
    economyConfig: { startingPoints: 10000, hitReward: 10, killBonus: 50 } } : {}),
});
const playerId = simulation.playerIds[0];
if (!simulation.getPlayer(playerId)) throw new Error('Simulation failed to create local player.');
if (preview) {
  simulation.getPlayer(playerId)!.yaw = preview.yaw;
  if (previewName === 'stress') simulation.getPlayer(playerId)!.godMode = true;
  for (const door of simulation.state.doors) door.open = true;
  for (const item of simulation.interactables()) if (item.interactionType === 'door') item.enabled = false;
}

const zombieViews = new Map<EntityId, ZombieView>();
const zombieBatch = new ActorBatch(scene);
const previousPositions = new Map<EntityId, Vec3>();

function zombies(): ZombieState[] {
  return simulation.zombies();
}
function syncZombieViews(alpha: number): void {
  const liveIds = new Set<EntityId>();
  for (const zombie of zombies()) {
    liveIds.add(zombie.id);
    let view = zombieViews.get(zombie.id);
    if (!view) {
      view = createZombieView();
      zombieViews.set(zombie.id, view);
    }
    view.update(zombie, simulation.state.world.tick - 1 + alpha,
      simulation.state.barriers.find(barrier => barrier.id === zombie.entry?.barrierId), previousPositions.get(zombie.id), alpha);
  }
  for (const id of zombieViews.keys()) {
    if (liveIds.has(id)) continue;
    zombieViews.delete(id);
  }
  zombieBatch.update(Array.from(zombieViews.values(), view => view.root));
}

const clock = new FixedStepClock({ tickRate: 60 });
const input = new BrowserInput({ pointerElement: canvas, lookSensitivity: 0.0022 });
const hud = new CanvasHud(renderer);
const performanceOverlay = new PerformanceOverlay();
renderer.info.autoReset = false;
let previousSeconds: number | undefined;

function simulate(dt: number): void {
  previousPositions.clear();
  const world = simulation.state.world;
  for (const entity of Object.values(world.entities)) {
    if (entity.alive && (entity.kind === 'player' || entity.kind === 'zombie')) {
      previousPositions.set(entity.id, { ...entity.position });
    }
  }
  simulation.tick({ [playerId]: input.consume() }, dt);
  if (simulation.state.world !== world) previousPositions.clear();
}
function syncCamera(alpha = 1): void {
  const player = simulation.getPlayer(playerId);
  if (!player) return;
  const position = interpolatePosition(previousPositions.get(playerId), player.position, alpha);
  camera.position.set(position.x, position.y + PLAYER_MOVEMENT.eyeHeight, position.z);
  const look = input.pendingLook();
  camera.rotation.x = Math.max(-PLAYER_MOVEMENT.maxPitch, Math.min(PLAYER_MOVEMENT.maxPitch, player.pitch + look.pitch));
  camera.rotation.y = player.yaw + look.yaw;
  camera.rotation.z = 0;
}

function resize(): void {
  const width = innerWidth;
  const height = innerHeight;
  renderer.setSize(width, height, false);
  camera.aspect = width / height;
  camera.updateProjectionMatrix();
}

function frame(nowMs: number): void {
  const started = performance.now();
  const nowSeconds = nowMs / 1000;
  if (previousSeconds === undefined) previousSeconds = nowSeconds;
  const interval = (nowSeconds - previousSeconds) * 1000;
  clock.advance(nowSeconds - previousSeconds, simulate);
  const simulationMs = performance.now() - started;
  previousSeconds = nowSeconds;
  const alpha = clock.interpolationAlpha();
  syncCamera(alpha);
  syncZombieViews(alpha);
  bunker.update(simulation.state);
  renderer.clear();
  renderer.info.reset();
  renderer.render(scene, camera);
  const hudStarted = performance.now();
  const hudSnapshot = buildHudSnapshot(simulation, playerId);
  if (hudSnapshot) hud.render(hudSnapshot);
  performanceOverlay.sample(interval, performance.now() - started, simulationMs, performance.now() - hudStarted,
    renderer.info.render.calls, renderer.info.render.triangles, renderer.getPixelRatio());
  performanceOverlay.render(renderer);
  requestAnimationFrame(frame);
}

addEventListener('resize', resize);
resize();
syncCamera();
requestAnimationFrame(frame);
