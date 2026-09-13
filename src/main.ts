import * as THREE from 'three';
import { FixedStepClock, createWorld } from './core/index.ts';
import { BrowserInput } from './client/input.ts';

const canvas = document.querySelector<HTMLCanvasElement>('#game');
if (!canvas) throw new Error('Missing #game canvas.');

const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x101316);

const camera = new THREE.PerspectiveCamera(60, 1, 0.1, 100);
camera.position.set(0, 2.5, 7);
scene.add(new THREE.HemisphereLight(0xbad7ff, 0x25301d, 2.2));

const floor = new THREE.Mesh(
  new THREE.PlaneGeometry(30, 30),
  new THREE.MeshStandardMaterial({ color: 0x25301d, roughness: 1 }),
);
floor.rotation.x = -Math.PI / 2;
scene.add(floor);

const zombieMaterial = new THREE.MeshStandardMaterial({ color: 0x74a84f, roughness: 0.9 });
for (let i = 0; i < 5; i += 1) {
  const zombie = new THREE.Mesh(new THREE.BoxGeometry(0.7, 1.7, 0.5), zombieMaterial);
  zombie.position.set((i - 2) * 1.3, 0.85, -0.5 - Math.abs(i - 2) * 0.35);
  scene.add(zombie);
}

const world = createWorld(0x5a0b0a2);
const clock = new FixedStepClock({ tickRate: 60 });
const input = new BrowserInput();
let previousSeconds = performance.now() / 1000;

function resize(): void {
  const width = innerWidth;
  const height = innerHeight;
  renderer.setSize(width, height, false);
  camera.aspect = width / height;
  camera.updateProjectionMatrix();
}

function frame(nowMs: number): void {
  const nowSeconds = nowMs / 1000;
  clock.advance(nowSeconds - previousSeconds, () => {
    input.consume();
    world.tick += 1;
  });
  previousSeconds = nowSeconds;
  scene.rotation.y = Math.sin(nowMs * 0.00025) * 0.08;
  renderer.render(scene, camera);
  requestAnimationFrame(frame);
}

addEventListener('resize', resize);
resize();
requestAnimationFrame(frame);
