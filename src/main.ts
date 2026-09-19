/// <reference types="vite/client" />
import * as THREE from 'three';
import { buildGreybox } from './client/greybox.ts';
import { buildBunkerDetails } from './client/bunker.ts';
import { createZombieView, type ZombieView } from './client/zombieView.ts';
import { BrowserInput } from './client/input.ts';
import { CanvasHud, buildHudSnapshot } from './client/hud.ts';
import {
  FixedStepClock, GameSimulation, PLAYER_MOVEMENT, type EntityId, type ZombieState,
} from './core/index.ts';
import {
  NACHT_DOORS, NACHT_GREYBOX, NACHT_NAVIGATION, NACHT_PLAYER_SPAWN, NACHT_WALK_SURFACES, NACHT_ZOMBIE_SPAWNS, NACHT_WALL_WEAPONS, NACHT_MYSTERY_BOXES,
  greyboxCollisionBoxes, NACHT_SHOT_BLOCKERS, NACHT_BARRIERS,
} from './maps/nacht.ts';

const canvas = document.querySelector<HTMLCanvasElement>('#game');
if (!canvas) throw new Error('Missing #game canvas.');

const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
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
keyLight.shadow.mapSize.set(2048, 2048);
Object.assign(keyLight.shadow.camera, { left: -15, right: 15, top: 15, bottom: -15, far: 65 });
keyLight.shadow.bias = -0.0006;
scene.add(keyLight);
scene.add(buildGreybox(NACHT_GREYBOX));
const bunker = buildBunkerDetails(scene);

// Development-only inspection views for iterating on the map without a running wave.
const previewViews = {
  start: { position: { x: -3, y: 0, z: 4 }, yaw: -0.25 },
  help: { position: { x: 3, y: 0, z: -3.1 }, yaw: 0.73 },
  upstairs: { position: { x: 3, y: 3.4, z: 4 }, yaw: 0.5 },
  barrier: { position: { x: -5, y: 0, z: -4.9 }, yaw: 0 },
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
  ...(preview ? { roundConfig: { initialWaitTicks: previewName === 'barrier' ? 120 : 2147483647, intermissionTicks: 180 },
    economyConfig: { startingPoints: 10000, hitReward: 10, killBonus: 50 } } : {}),
});
const playerId = simulation.playerIds[0];
if (!simulation.getPlayer(playerId)) throw new Error('Simulation failed to create local player.');
if (preview) {
  simulation.getPlayer(playerId)!.yaw = preview.yaw;
  for (const door of simulation.state.doors) door.open = true;
  for (const item of simulation.interactables()) if (item.interactionType === 'door') item.enabled = false;
}

const zombieViews = new Map<EntityId, ZombieView>();

function zombies(): ZombieState[] {
  return simulation.zombies();
}
function syncZombieViews(): void {
  const liveIds = new Set<EntityId>();
  for (const zombie of zombies()) {
    liveIds.add(zombie.id);
    let view = zombieViews.get(zombie.id);
    if (!view) {
      view = createZombieView();
      zombieViews.set(zombie.id, view);
      scene.add(view.root);
    }
    view.update(zombie, simulation.state.world.tick,
      simulation.state.barriers.find(barrier => barrier.id === zombie.entry?.barrierId));
  }
  for (const [id, view] of zombieViews) {
    if (liveIds.has(id)) continue;
    scene.remove(view.root);
    zombieViews.delete(id);
  }
}

const clock = new FixedStepClock({ tickRate: 60 });
const input = new BrowserInput({ pointerElement: canvas, lookSensitivity: 0.0022 });
const hud = new CanvasHud(renderer);
let previousSeconds: number | undefined;

function simulate(dt: number): void {
  simulation.tick({ [playerId]: input.consume() }, dt);
}
function syncCamera(): void {
  const player = simulation.getPlayer(playerId);
  if (!player) return;
  camera.position.set(
    player.position.x,
    player.position.y + PLAYER_MOVEMENT.eyeHeight,
    player.position.z,
  );
  camera.rotation.x = player.pitch;
  camera.rotation.y = player.yaw;
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
  const nowSeconds = nowMs / 1000;
  if (previousSeconds === undefined) previousSeconds = nowSeconds;
  clock.advance(nowSeconds - previousSeconds, simulate);
  previousSeconds = nowSeconds;
  syncCamera();
  syncZombieViews();
  bunker.update(simulation.state);
  renderer.clear();
  renderer.render(scene, camera);
  const hudSnapshot = buildHudSnapshot(simulation, playerId);
  if (hudSnapshot) hud.render(hudSnapshot);
  requestAnimationFrame(frame);
}

addEventListener('resize', resize);
resize();
syncCamera();
requestAnimationFrame(frame);
