import * as THREE from 'three';
import { BrowserInput } from './client/input.ts';
import { buildGreybox } from './client/greybox.ts';
import {
  FixedStepClock,
  PLAYER_MOVEMENT,
  addEntity,
  allocateEntityId,
  createPlayerState,
  createWorld,
  updatePlayerMovement,
} from './core/index.ts';
import {
  NACHT_GREYBOX,
  NACHT_PLAYER_SPAWN,
  NACHT_WALK_SURFACES,
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

const world = createWorld(0x5a0b0a2);
const playerId = allocateEntityId(world);
const player = createPlayerState(playerId, NACHT_PLAYER_SPAWN);
addEntity(world, player);

const collisionBoxes = greyboxCollisionBoxes();
const clock = new FixedStepClock({ tickRate: 60 });
const input = new BrowserInput({ pointerElement: canvas, lookSensitivity: 0.0022 });
let previousSeconds: number | undefined;
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
  clock.advance(nowSeconds - previousSeconds, (dt) => {
    updatePlayerMovement(player, input.consume(), dt, collisionBoxes, NACHT_WALK_SURFACES);
    world.tick += 1;
  });
  previousSeconds = nowSeconds;
  syncCamera();
  renderer.render(scene, camera);
  requestAnimationFrame(frame);
}
addEventListener('resize', resize);
resize();
syncCamera();
requestAnimationFrame(frame);
