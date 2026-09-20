import * as THREE from 'three';
import type { GreyboxBox, GreyboxMaterial, GreyboxPrism } from '../maps/nacht.ts';

const COLORS: Record<GreyboxMaterial, number> = {
  wall: 0x55534d,
  floor: 0x282824,
  upperFloor: 0x33332f,
  stair: 0x494842,
  barrier: 0x5a4030,
  metal: 0x343b38,
};

// Generated masonry/wood textures keep the map self-contained and asset-free.
export function bunkerMaterial(kind: GreyboxMaterial): THREE.MeshStandardMaterial {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 512;
  const ctx = canvas.getContext('2d')!;
  let seed = 317;
  const random = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
  ctx.fillStyle = kind === 'barrier' ? '#6b5035' : kind === 'metal' ? '#434943' : '#878678';
  ctx.fillRect(0, 0, 512, 512);
  for (let i = 0; i < 20000; i++) {
    const tone = random() > 0.5 ? 255 : 0;
    ctx.fillStyle = `rgba(${tone},${tone},${tone},${random() * 0.13})`;
    ctx.fillRect(random() * 512, random() * 512, 1 + random() * 5, 1 + random() * 4);
  }
  if (kind === 'barrier') {
    for (let x = 0; x < 512; x += 64) {
      ctx.fillStyle = '#2a2119'; ctx.fillRect(x, 0, 4, 512);
      for (let i = 0; i < 28; i++) {
        ctx.strokeStyle = `rgba(25,17,10,${random() * 0.35})`;
        ctx.beginPath(); ctx.moveTo(x + random() * 64, 0);
        ctx.bezierCurveTo(x + random() * 64, 150, x + random() * 64, 360, x + random() * 64, 512); ctx.stroke();
      }
    }
  } else {
    // Uneven concrete formwork / masonry seams.
    ctx.strokeStyle = '#56574f'; ctx.lineWidth = 3;
    for (let y = 0; y < 512; y += 128) {
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(512, y); ctx.stroke();
      for (let x = (y / 128 % 2) * 128; x < 512; x += 256) {
        ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x, y + 128); ctx.stroke();
      }
    }
    for (let i = 0; i < 38; i++) {
      const x = random() * 512, y = random() * 512, r = 12 + random() * 64;
      const stain = ctx.createRadialGradient(x, y, 0, x, y, r);
      stain.addColorStop(0, 'rgba(24,28,19,0.23)'); stain.addColorStop(1, 'rgba(24,28,19,0)');
      ctx.fillStyle = stain; ctx.fillRect(x - r, y - r, r * 2, r * 2);
    }
    for (let i = 0; i < 7; i++) {
      let x = random() * 512, y = random() * 512;
      ctx.strokeStyle = 'rgba(25,24,20,0.5)'; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(x, y);
      for (let j = 0; j < 7; j++) { x += random() * 28 - 14; y += random() * 18; ctx.lineTo(x, y); }
      ctx.stroke();
    }
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.anisotropy = 4;
  return new THREE.MeshStandardMaterial({
    color: kind === 'wall' ? 0xc1bbaa : kind === 'barrier' ? 0xbba58a : COLORS[kind],
    map: texture,
    bumpMap: texture,
    bumpScale: kind === 'metal' ? 0.01 : 0.055,
    roughness: 0.95,
    metalness: kind === 'metal' ? 0.55 : 0.02,
  });
}

export function buildGreybox(boxes: readonly GreyboxBox[], prisms: readonly GreyboxPrism[] = []): THREE.Group {
  const group = new THREE.Group();
  group.name = 'nacht-greybox';
  const materials = new Map<GreyboxMaterial, THREE.MeshStandardMaterial>();

  for (const entry of boxes) {
    if (entry.visible === false) continue;
    const geometry = new THREE.BoxGeometry(entry.size.x, entry.size.y, entry.size.z);
    const positions = geometry.attributes.position;
    const normals = geometry.attributes.normal;
    const uv = geometry.attributes.uv;
    // World-sized texels rather than stretching one brick across an entire wall.
    for (let i = 0; i < positions.count; i++) {
      const x = positions.getX(i) + entry.center.x;
      const y = positions.getY(i) + entry.center.y;
      const z = positions.getZ(i) + entry.center.z;
      uv.setXY(i, (Math.abs(normals.getX(i)) > 0.5 ? z : x) / 3,
        (Math.abs(normals.getY(i)) > 0.5 ? z : y) / 3);
    }
    if (!materials.has(entry.material)) materials.set(entry.material, bunkerMaterial(entry.material));
    const mesh = new THREE.Mesh(geometry, materials.get(entry.material));
    mesh.position.set(entry.center.x, entry.center.y, entry.center.z);
    mesh.rotation.z = entry.rotationZ ?? 0;
    mesh.receiveShadow = true;
    mesh.castShadow = entry.material !== 'floor' && entry.material !== 'upperFloor';
    group.add(mesh);
  }

  for (const entry of prisms) {
    const shape = new THREE.Shape(entry.points.map(([x, z]) => new THREE.Vector2(x, -z)));
    const geometry = new THREE.ExtrudeGeometry(shape, { depth: entry.top - entry.bottom, bevelEnabled: false, steps: 1 });
    geometry.rotateX(-Math.PI / 2); geometry.translate(0, entry.bottom, 0);
    const position = geometry.attributes.position, normal = geometry.attributes.normal, uv = geometry.attributes.uv;
    for (let i = 0; i < position.count; i++) uv.setXY(i,
      (Math.abs(normal.getX(i)) > 0.5 ? position.getZ(i) : position.getX(i)) / 3,
      (Math.abs(normal.getY(i)) > 0.5 ? position.getZ(i) : position.getY(i)) / 3);
    if (!materials.has(entry.material)) materials.set(entry.material, bunkerMaterial(entry.material));
    const mesh = new THREE.Mesh(geometry, materials.get(entry.material));
    mesh.castShadow = true; mesh.receiveShadow = true; group.add(mesh);
  }
  return group;
}
