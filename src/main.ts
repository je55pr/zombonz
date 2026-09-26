/// <reference types="vite/client" />
import * as THREE from 'three';
import { buildGreybox } from './client/greybox.ts';
import { buildBunkerDetails } from './client/bunker.ts';
import { createZombieView, type ZombieView } from './client/zombieView.ts';
import { BrowserInput } from './client/input.ts';
import { SoloPauseController } from './client/pause.ts';
import { PerformanceOverlay } from './client/performance.ts';
import { batchStaticMeshes } from './client/staticBatch.ts';
import { ActorBatch } from './client/actorBatch.ts';
import { interpolatePosition } from './client/interpolation.ts';
import { CanvasHud, buildHudSnapshot } from './client/hud.ts';
import { HudFeedback } from './client/feedback.ts';
import { GameAudio } from './client/audio.ts';
import { loadZombieAsset, type ZombieAsset } from './client/runtimeAssets.ts';
import { SkinnedZombieView } from './client/skinnedZombieView.ts';
import { WeaponView } from './client/weaponView.ts';
import { PowerupView } from './client/powerupView.ts';
import { GrenadeView } from './client/grenadeView.ts';
import { readEnvironmentManifest, loadEnvironmentMaterials } from './client/environmentMaterials.ts';
import { buildEnvironmentProps, buildEnvironmentDecals } from './client/environmentProps.ts';
import {
  FixedStepClock, GameSimulation, PLAYER_MOVEMENT, DEFAULT_POWERUP_CONFIG,
  createWeaponState, createZombieState, allocateEntityId, addEntity,
  type EntityId, type ZombieState, type Vec3,
} from './core/index.ts';
import {
  NACHT_DOORS, NACHT_GREYBOX, NACHT_NAVIGATION, NACHT_PLAYER_SPAWN, NACHT_WALK_SURFACES, NACHT_ZOMBIE_SPAWNS, NACHT_WALL_WEAPONS, NACHT_MYSTERY_BOXES,
  greyboxCollisionBoxes, NACHT_SHOT_BLOCKERS, NACHT_BARRIERS, NACHT_PRISMS,
} from './maps/nacht.ts';

const canvas = document.querySelector<HTMLCanvasElement>('#game');
if (!canvas) throw new Error('Missing #game canvas.');

const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(devicePixelRatio, 1));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.shadowMap.autoUpdate = false;
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
scene.add(buildGreybox(NACHT_GREYBOX, NACHT_PRISMS));
const bunker = buildBunkerDetails(scene);
batchStaticMeshes(scene);
let environmentNotice: string | null = 'Loading bunker materials and props…';
void (async () => {
  // Prop proxies/collision must stay visible even when the texture manifest fails.
  const props = buildEnvironmentProps(scene);
  const surfaces = readEnvironmentManifest().then(manifest =>
    Promise.all([loadEnvironmentMaterials(manifest), buildEnvironmentDecals(scene, manifest)]))
    .catch(error => { console.warn('Environment manifest unavailable', error); return [1]; });
  const [propFailures, surfaceFailures] = await Promise.all([props, surfaces]);
  environmentNotice = propFailures > 0 || surfaceFailures.some(n => n > 0) ? 'Some environment assets failed to load; check console' : null;
  renderer.shadowMap.needsUpdate = true;
})().catch(error => { environmentNotice = 'Environment pack unavailable; using plain fallback'; console.warn(error); });

// Development-only inspection views for iterating on the map without a running wave.
const previewViews = {
  start: { position: NACHT_PLAYER_SPAWN, yaw: -0.35 },
  help: { position: { x: -1.8, y: 0, z: -7.8 }, yaw: Math.PI - 0.12 },
  upstairs: { position: { x: 2, y: 3.4, z: 3.8 }, yaw: -0.5 },
  barrier: { position: { x: 12, y: 0, z: -0.8 }, yaw: 0 },
  stress: { position: NACHT_PLAYER_SPAWN, yaw: -0.35 },
  assets: { position: NACHT_PLAYER_SPAWN, yaw: 0 },
  gameOver: { position: NACHT_PLAYER_SPAWN, yaw: -0.35 },
  overview: { position: { x: 23, y: 25, z: 28 }, yaw: 0.65 },
  doorway: { position: { x: 1.2, y: 0, z: 1.6 }, yaw: -Math.PI / 2 },
  props: { position: { x: -2, y: 0, z: 4.3 }, yaw: Math.PI + 0.15 },
};
const previewName = new URLSearchParams(location.search).get('preview');
const previewPowerup = new URLSearchParams(location.search).get('powerup');
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
  ...(previewName === 'assets' && preview ? { powerupConfig: {
    ...DEFAULT_POWERUP_CONFIG, dropChanceDenominator: 1, minimumTicksBetweenDrops: 0,
    kinds: [previewPowerup === 'doublePoints' ? 'doublePoints'
      : previewPowerup === 'instaKill' ? 'instaKill'
        : previewPowerup === 'nuke' ? 'nuke' : 'maxAmmo'] as const,
  } } : {}),
  ...(preview ? { roundConfig: { initialWaitTicks: previewName === 'barrier' || previewName === 'stress' ? 120 : 2147483647, intermissionTicks: 180 },
    economyConfig: { startingPoints: 10000, hitReward: 10, killBonus: 50 } } : {}),
});
const playerId = simulation.playerIds[0];
if (!simulation.getPlayer(playerId)) throw new Error('Simulation failed to create local player.');
if (preview) {
  simulation.getPlayer(playerId)!.yaw = preview.yaw;
  if (previewName === 'overview') {
    simulation.getPlayer(playerId)!.noclip = true;
    simulation.getPlayer(playerId)!.pitch = -0.85;
  }
  if (previewName === 'stress') simulation.getPlayer(playerId)!.godMode = true;
  if (previewName === 'gameOver') {
    Object.assign(simulation.getPlayer(playerId)!, { points: 12345, kills: 42, headshots: 13 });
    Object.assign(simulation.state.round, { round: 9, phase: 'gameOver' });
  }
  for (const door of simulation.state.doors) door.open = true;
  for (const item of simulation.interactables()) if (item.interactionType === 'door') item.enabled = false;
  const testWeapon = new URLSearchParams(location.search).get('weapon');
  if (testWeapon && ['starter-pistol', 'kar98k', 'bar', 'thompson', 'mp40'].includes(testWeapon)) {
    simulation.getPlayer(playerId)!.weapon = createWeaponState(testWeapon);
  }
  if (previewName === 'assets') {
    const target = createZombieState(allocateEntityId(simulation.state.world), { x: 5.2, y: 0, z: 0 }, 1);
    target.moveSpeed = 0; addEntity(simulation.state.world, target);
  }
}

const zombieViews = new Map<EntityId, ZombieView>();
const zombieBatch = new ActorBatch(scene);
const previousPositions = new Map<EntityId, Vec3>();
const skinnedViews = new Map<EntityId, SkinnedZombieView>();
let zombieAsset: ZombieAsset | undefined;
let zombieAssetNotice: string | null = 'Loading zombie model…';
const zombieVariant = new URLSearchParams(location.search).get('zombie') === 'pxltiger' ? 'pxltiger' : 'peter_d';
void loadZombieAsset(zombieVariant).then(asset => {
  zombieAsset = asset; zombieAssetNotice = null;
  zombieViews.clear(); zombieBatch.update([]);
}).catch(error => {
  zombieAssetNotice = 'Zombie asset failed to load; using low-poly fallback';
  console.warn('Unable to load zombie asset', error);
});
const weaponView = new WeaponView();
const powerupView = new PowerupView(scene);
const grenadeView = new GrenadeView(scene);

function zombies(): ZombieState[] {
  return simulation.zombies();
}
function syncZombieViews(alpha: number): void {
  if (zombieAsset) {
    const tick = simulation.state.world.tick - 1 + alpha;
    for (const [id, view] of skinnedViews) if (!simulation.state.world.entities[id]) {
      view.dispose(); skinnedViews.delete(id);
    }
    for (const entity of Object.values(simulation.state.world.entities)) {
      if (entity.kind !== 'zombie') continue;
      let view = skinnedViews.get(entity.id);
      if (!view) {
        if (!entity.alive) continue;
        view = new SkinnedZombieView(zombieAsset, Number(entity.id.slice(2)) * 0.37);
        skinnedViews.set(entity.id, view); scene.add(view.root);
      }
      view.update(entity, tick, simulation.state.barriers.find(barrier => barrier.id === entity.entry?.barrierId),
        previousPositions.get(entity.id), alpha);
      if (view.expired(tick)) { view.dispose(); skinnedViews.delete(entity.id); }
    }
    // Corpse presentation must not accumulate unbounded skeleton work over a match.
    const corpses = [...skinnedViews].filter(([id]) => !simulation.state.world.entities[id]?.alive);
    for (const [id, view] of corpses.slice(0, Math.max(0, corpses.length - 8))) { view.dispose(); skinnedViews.delete(id); }
    return;
  }
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
const input = new BrowserInput({ pointerElement: canvas, lookSensitivity: 0.0022, previewFireKey: !!preview });
const audio = new GameAudio(canvas);
const pause = new SoloPauseController(canvas, window, document, paused => {
  clock.reset(); previousPositions.clear();
  if (paused) input.clear();
  audio.setPaused(paused);
}, !preview, () => simulation.state.round.phase !== 'gameOver');
const hud = new CanvasHud(renderer);
const feedback = new HudFeedback();
const performanceOverlay = new PerformanceOverlay();
renderer.info.autoReset = false;
let previousSeconds: number | undefined;
let lastShadowTick = -Infinity;

function simulate(dt: number): void {
  previousPositions.clear();
  const world = simulation.state.world;
  for (const entity of Object.values(world.entities)) {
    if (entity.alive && (entity.kind === 'player' || entity.kind === 'zombie')) {
      previousPositions.set(entity.id, { ...entity.position });
    }
  }
  const events = simulation.tick({ [playerId]: input.consume() }, dt);
  weaponView.events(events, playerId, simulation.state.world.tick);
  grenadeView.events(events, simulation.state.world.tick);
  feedback.consume(events, playerId, simulation.state.world.tick);
  audio.consume(events, playerId);
  if (simulation.state.world !== world) {
    previousPositions.clear();
    for (const view of skinnedViews.values()) view.dispose();
    skinnedViews.clear(); zombieViews.clear();
  }
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
  if (pause.paused) { input.clear(); clock.reset(); }
  else clock.advance(nowSeconds - previousSeconds, simulate);
  const simulationMs = performance.now() - started;
  previousSeconds = nowSeconds;
  const alpha = clock.interpolationAlpha();
  syncCamera(alpha);
  const playerForCamera = simulation.getPlayer(playerId);
  const targetFov = playerForCamera?.aiming ? 54 : playerForCamera?.sprinting ? 71 : 67;
  const fovBlend = 1 - Math.exp(-12 * Math.min(0.1, Math.max(0, interval / 1000)));
  const nextFov = camera.fov + (targetFov - camera.fov) * fovBlend;
  if (Math.abs(nextFov - camera.fov) > 0.001) { camera.fov = nextFov; camera.updateProjectionMatrix(); }
  syncZombieViews(alpha);
  powerupView.update(simulation.state.powerups.drops, simulation.state.world.tick - 1 + alpha);
  grenadeView.update(simulation.state.grenades.active, simulation.state.world.tick - 1 + alpha);
  bunker.update(simulation.state);
  renderer.clear();
  renderer.info.reset();
  // The moon/camera are independent: expensive skinned shadow passes only need
  // 15 Hz updates. Models and camera still render at the display's full rate.
  if (simulation.state.world.tick - lastShadowTick >= 4 || simulation.state.world.tick < lastShadowTick) {
    renderer.shadowMap.needsUpdate = true; lastShadowTick = simulation.state.world.tick;
  }
  renderer.render(scene, camera);
  const player = simulation.getPlayer(playerId);
  if (player) { weaponView.update(player, simulation.state.world.tick - 1 + alpha, interval / 1000); weaponView.render(renderer, camera.aspect); }
  const hudStarted = performance.now();
  const hudSnapshot = buildHudSnapshot(simulation, playerId);
  if (hudSnapshot) hud.render({ ...hudSnapshot, paused: pause.paused,
    feedback: feedback.snapshot(simulation.state.world.tick),
    assetNotice: zombieAssetNotice ?? weaponView.notice ?? environmentNotice });
  performanceOverlay.sample(interval, performance.now() - started, simulationMs, performance.now() - hudStarted,
    renderer.info.render.calls, renderer.info.render.triangles, renderer.getPixelRatio());
  performanceOverlay.render(renderer);
  requestAnimationFrame(frame);
}

addEventListener('resize', resize);
resize();
syncCamera();
requestAnimationFrame(frame);
