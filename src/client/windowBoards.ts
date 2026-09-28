import * as THREE from 'three';
import { projectWorldUvs } from './environmentMaterials.ts';

// Six planks fill the frame between the sill and lintel at slightly uneven angles.
const PLANK_TILT = [0.05, -0.09, 0.07, -0.04, 0.1, -0.03] as const;
const plankHeight = (index: number): number => 1.02 + index * 0.27;

/** Two cullable draws per window, while each board can still fall and be repaired independently. */
export class WindowBoards {
  readonly planks: THREE.InstancedMesh;
  readonly nails: THREE.InstancedMesh;
  private readonly board = new THREE.Object3D();
  private readonly nailMatrix = new THREE.Matrix4();
  private readonly nailOffsets: readonly THREE.Matrix4[];
  private lastBoards = -1;
  private lastFall = -1;

  constructor(frame: THREE.Group, width: number, maxBoards: number,
    boardsMaterial: THREE.Material, nailMaterial: THREE.Material, nailGeometry: THREE.BufferGeometry) {
    const boardGeometry = new THREE.BoxGeometry(width + 0.14, 0.17, 0.025);
    projectWorldUvs(boardGeometry);
    this.planks = new THREE.InstancedMesh(boardGeometry, boardsMaterial, maxBoards);
    this.nails = new THREE.InstancedMesh(nailGeometry, nailMaterial, maxBoards * 2);
    this.planks.name = 'window-planks'; this.nails.name = 'window-nails';
    this.planks.userData.dynamic = this.nails.userData.dynamic = true;
    this.planks.castShadow = true; this.planks.receiveShadow = true;
    // The old nail heads were small unshadowed meshes; retain that cheap appearance.
    const nailRotation = new THREE.Matrix4().makeRotationX(Math.PI / 2);
    this.nailOffsets = [-1, 1].map(end => new THREE.Matrix4()
      .makeTranslation(end * (width / 2 + 0.01), 0, 0.015).multiply(nailRotation));
    // A fixed local bound covers the whole frame and a board's brief fall below its sill.
    const bounds = new THREE.Sphere(new THREE.Vector3(0, 0.6, 0), Math.hypot(width / 2 + 0.2, 3.2));
    this.planks.boundingSphere = bounds.clone(); this.nails.boundingSphere = bounds.clone();
    frame.add(this.planks, this.nails);
    this.setState(maxBoards, null);
  }

  /** `fallElapsed` is null outside the 0.8-second falling animation. */
  setState(boards: number, fallElapsed: number | null): void {
    const count = Math.max(0, Math.min(this.planks.instanceMatrix.count, boards));
    const fall = count < this.planks.instanceMatrix.count && fallElapsed !== null
      && fallElapsed >= 0 && fallElapsed < 0.8 ? fallElapsed : null;
    if (count === this.lastBoards && (fall ?? -1) === this.lastFall) return;
    this.lastBoards = count; this.lastFall = fall ?? -1;
    const visible = count + (fall === null ? 0 : 1);
    this.planks.count = visible; this.nails.count = visible * 2;
    for (let i = 0; i < visible; i++) {
      const falling = i === count ? fall : null;
      this.board.position.set(0, plankHeight(i) - (falling === null ? 0 : falling * falling * 4), 0.03);
      this.board.rotation.set(falling === null ? 0 : falling * 1.5, 0,
        PLANK_TILT[i % PLANK_TILT.length] + (falling === null ? 0 : falling * 2));
      this.board.updateMatrix();
      this.planks.setMatrixAt(i, this.board.matrix);
      for (let end = 0; end < 2; end++) {
        this.nailMatrix.multiplyMatrices(this.board.matrix, this.nailOffsets[end]);
        this.nails.setMatrixAt(i * 2 + end, this.nailMatrix);
      }
    }
    this.planks.instanceMatrix.needsUpdate = true;
    this.nails.instanceMatrix.needsUpdate = true;
  }
}
