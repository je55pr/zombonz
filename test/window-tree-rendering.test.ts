import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { WindowBoards } from '../src/client/windowBoards.ts';
import { deadTreeGeometry, scatterTreeSectors } from '../src/client/treeline.ts';
import { BUNKER_MAP } from '../src/maps/bunker.ts';
import { ASYLUM_MAP } from '../src/maps/asylum.ts';

describe('window and treeline batching', () => {
  it.each([BUNKER_MAP, ASYLUM_MAP])('keeps %s boards independently repairable in two draws per window', map => {
    const frame = new THREE.Group();
    const material = new THREE.MeshStandardMaterial();
    const view = new WindowBoards(frame, map.windows[0].width, map.windowBoards, material, material,
      new THREE.CylinderGeometry(0.011, 0.011, 0.012, 6));
    expect(frame.children).toEqual([view.planks, view.nails]);
    expect(view.planks.count).toBe(map.windowBoards);
    expect(view.nails.count).toBe(map.windowBoards * 2);
    expect(view.planks.castShadow).toBe(true);

    // setState reports when a board moves, so the moon's shadow map is redrawn only then.
    expect(view.setState(3, null)).toBe(true);
    expect(view.setState(3, null)).toBe(false);
    expect(view.planks.count).toBe(3);
    expect(view.nails.count).toBe(6);
    expect(view.setState(2, 0.4)).toBe(true);
    expect(view.setState(2, 0.4)).toBe(false);
    expect(view.planks.count).toBe(3); // one torn board remains visible while it falls
    expect(view.nails.count).toBe(6);
    const falling = new THREE.Matrix4(), intact = new THREE.Matrix4();
    view.planks.getMatrixAt(2, falling); view.planks.getMatrixAt(1, intact);
    expect(falling.elements[13]).toBeLessThan(intact.elements[13]);
    view.setState(map.windowBoards, null);
    expect(view.planks.count).toBe(map.windowBoards);
    expect(view.nails.count).toBe(map.windowBoards * 2);
  });

  it('splits the forest into independently frustum-cullable sectors', () => {
    const group = new THREE.Group();
    const geometry = new THREE.BoxGeometry(1, 4, 1), material = new THREE.MeshStandardMaterial();
    const placements = [[-20, -20], [-20, 20], [20, -20], [20, 20]].map(([x, z]) =>
      new THREE.Matrix4().makeTranslation(x, 0, z));
    scatterTreeSectors(group, geometry, material, placements, { x: 0, z: 0 });
    expect(group.children).toHaveLength(4);
    expect(group.children.every(child => child instanceof THREE.InstancedMesh && child.count === 1)).toBe(true);
    const camera = new THREE.PerspectiveCamera(35, 1, 0.1, 100);
    camera.position.set(0, 2, 0); camera.lookAt(20, 0, 20); camera.updateMatrixWorld();
    const frustum = new THREE.Frustum().setFromProjectionMatrix(
      new THREE.Matrix4().multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse));
    group.updateMatrixWorld(true);
    expect(group.children.filter(child => frustum.intersectsObject(child))).toHaveLength(1);
  });

  it('uses materially less geometry for the distant trees', () => {
    const close = deadTreeGeometry(() => 0.5);
    const distant = deadTreeGeometry(() => 0.5, 5, 2, 2);
    expect(distant.index!.count).toBeLessThan(close.index!.count * 0.35);
    close.computeBoundingBox(); distant.computeBoundingBox();
    expect(distant.boundingBox!.max.y).toBeGreaterThan(close.boundingBox!.max.y * 0.7);
    close.dispose(); distant.dispose();
  });
});
