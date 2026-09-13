import * as THREE from 'three';

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x101316);
const camera = new THREE.PerspectiveCamera(60, innerWidth / innerHeight, 0.1, 100);
camera.position.set(0, 2.5, 7);

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight);
document.body.append(renderer.domElement);

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
  zombie.rotation.y = (i - 2) * -0.12;
  scene.add(zombie);
}

function resize() {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
}
addEventListener('resize', resize);

function frame(time) {
  scene.rotation.y = Math.sin(time * 0.00025) * 0.08;
  renderer.render(scene, camera);
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
