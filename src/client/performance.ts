import * as THREE from 'three';

// One small texture, uploaded once a second; keep all visible UI in the game canvas.
export class PerformanceOverlay {
  private visible = new URLSearchParams(location.search).has('perf');
  private readonly canvas = document.createElement('canvas');
  private readonly context: CanvasRenderingContext2D;
  private readonly texture: THREE.CanvasTexture;
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.OrthographicCamera(0, 1, 1, 0, 0, 2);
  private readonly quad: THREE.Mesh;
  private readonly size = new THREE.Vector2();
  private frames = 0;
  private elapsed = 0;
  private cpu = 0;
  private simulation = 0;
  private hud = 0;
  private intervals: number[] = [];
  private readonly onKeyDown = (event: KeyboardEvent) => {
    if (event.code === 'F3' && !event.repeat) {
      event.preventDefault(); this.visible = !this.visible;
    }
  };

  constructor() {
    this.canvas.width = 512; this.canvas.height = 150;
    this.context = this.canvas.getContext('2d')!;
    this.texture = new THREE.CanvasTexture(this.canvas);
    this.texture.colorSpace = THREE.SRGBColorSpace;
    this.texture.generateMipmaps = false; this.texture.minFilter = THREE.LinearFilter;
    this.quad = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({
      map: this.texture, transparent: true, depthTest: false, depthWrite: false,
    }));
    this.scene.add(this.quad); this.camera.position.z = 1;
    addEventListener('keydown', this.onKeyDown);
  }

  sample(interval: number, cpu: number, simulation: number, hud: number, calls: number, triangles: number, scale: number): void {
    if (interval <= 0 || interval > 250) return;
    this.frames++; this.elapsed += interval; this.cpu += cpu;
    this.simulation += simulation; this.hud += hud; this.intervals.push(interval);
    if (this.elapsed < 1000) return;
    this.intervals.sort((a, b) => a - b);
    const text = `${Math.round(this.frames * 1000 / this.elapsed)} FPS | target 144\n`
      + `frame ${(this.elapsed / this.frames).toFixed(1)} ms | p95 ${this.intervals[Math.floor(this.frames * 0.95)].toFixed(1)} ms\n`
      + `CPU ${(this.cpu / this.frames).toFixed(2)} ms | sim ${(this.simulation / this.frames).toFixed(2)} | HUD ${(this.hud / this.frames).toFixed(2)}\n`
      + `${calls} draws | ${triangles} triangles | scale ${scale.toFixed(2)}\nF3: hide/show`;
    this.context.clearRect(0, 0, 512, 150);
    this.context.fillStyle = '#000b'; this.context.fillRect(0, 0, 512, 150);
    this.context.fillStyle = '#fff'; this.context.font = '18px monospace';
    text.split('\n').forEach((line, index) => this.context.fillText(line, 12, 25 + index * 27));
    this.texture.needsUpdate = true;
    this.frames = this.elapsed = this.cpu = this.simulation = this.hud = 0;
    this.intervals.length = 0;
  }

  render(renderer: THREE.WebGLRenderer): void {
    if (!this.visible) return;
    renderer.getSize(this.size);
    if (this.camera.right !== this.size.x || this.camera.top !== this.size.y) {
      this.camera.right = this.size.x; this.camera.top = this.size.y;
      this.camera.updateProjectionMatrix();
      const width = Math.min(384, this.size.x - 24), height = width * 150 / 512;
      this.quad.scale.set(width, height, 1);
      this.quad.position.set(this.size.x - width / 2 - 12, this.size.y - height / 2 - 12, 0);
    }
    renderer.render(this.scene, this.camera);
  }

  dispose(): void {
    removeEventListener('keydown', this.onKeyDown);
    this.quad.geometry.dispose();
    (this.quad.material as THREE.Material).dispose();
    this.texture.dispose();
  }
}
