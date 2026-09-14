import * as THREE from 'three';
import { buildGreybox } from './client/greybox.ts';
import { BrowserInput } from './client/input.ts';
import {
  FixedStepClock, GameSimulation, PLAYER_MOVEMENT, type EntityId, type ZombieState,
} from './core/index.ts';
import {
  NACHT_DOORS, NACHT_GREYBOX, NACHT_NAVIGATION, NACHT_PLAYER_SPAWN, NACHT_WALK_SURFACES, NACHT_ZOMBIE_SPAWNS,
  greyboxCollisionBoxes,
} from './maps/nacht.ts';

const canvas = document.querySelector<HTMLCanvasElement>('#game');
if (!canvas) throw new Error('Missing #game canvas.');

const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x151513);
scene.fog = new THREE.Fog(0x151513, 12, 34);

const camera = new THREE.PerspectiveCamera(67, 1, 0.05, 80);
camera.rotation.order = 'YXZ';
scene.add(new THREE.HemisphereLight(0xb8c0c8, 0x17150f, 1.1));
const keyLight = new THREE.DirectionalLight(0xe4d7b7, 2.2);
keyLight.position.set(-4, 9, 2);
keyLight.castShadow = true;
scene.add(keyLight);
scene.add(buildGreybox(NACHT_GREYBOX));
const helpDoorMesh = new THREE.Mesh(
  new THREE.BoxGeometry(0.36, 3, 3),
  new THREE.MeshStandardMaterial({ color: 0x4b4438, roughness: 0.95 }),
);
helpDoorMesh.position.set(0, 1.5, 0);
helpDoorMesh.castShadow = true;
helpDoorMesh.receiveShadow = true;
scene.add(helpDoorMesh);

const simulation = new GameSimulation({
  seed: 0x5a0b0a2,
  map: {
    collisionBoxes: greyboxCollisionBoxes(),
    walkSurfaces: NACHT_WALK_SURFACES,
    zombieSpawns: NACHT_ZOMBIE_SPAWNS,
    navigationGraph: NACHT_NAVIGATION,
    doors: NACHT_DOORS,
  },
  playerSpawns: [NACHT_PLAYER_SPAWN],
});
const playerId = simulation.playerIds[0];
const maybePlayer = simulation.getPlayer(playerId);
if (!maybePlayer) throw new Error('Simulation failed to create local player.');
const player = maybePlayer;

const zombieViews = new Map<EntityId, THREE.Mesh>();
const zombieMaterial = new THREE.MeshStandardMaterial({ color: 0x65704f, roughness: 0.9 });
const zombieGeometry = new THREE.BoxGeometry(0.62, 1.72, 0.5);

function zombies(): ZombieState[] {
  return simulation.zombies();
}
function syncZombieViews(): void {
  const liveIds = new Set<EntityId>();
  for (const zombie of zombies()) {
    liveIds.add(zombie.id);
    let mesh = zombieViews.get(zombie.id);
    if (!mesh) {
      mesh = new THREE.Mesh(zombieGeometry, zombieMaterial);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      zombieViews.set(zombie.id, mesh);
      scene.add(mesh);
    }
    mesh.position.set(zombie.position.x, zombie.position.y + 0.86, zombie.position.z);
  }
  for (const [id, mesh] of zombieViews) {
    if (liveIds.has(id)) continue;
    scene.remove(mesh);
    zombieViews.delete(id);
  }
}

const clock = new FixedStepClock({ tickRate: 60 });
const input = new BrowserInput({ pointerElement: canvas, lookSensitivity: 0.0022 });
let previousSeconds: number | undefined;

function simulate(dt: number): void {
  simulation.tick({ [playerId]: input.consume() }, dt);
}
function syncCamera(): void {
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
  helpDoorMesh.visible = !simulation.state.doors[0]?.open;
  renderer.render(scene, camera);
  requestAnimationFrame(frame);
}

addEventListener('resize', resize);
resize();
syncCamera();
requestAnimationFrame(frame);
