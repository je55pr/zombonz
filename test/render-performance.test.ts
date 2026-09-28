import { describe, expect, it, vi, afterEach } from 'vitest';
import * as THREE from 'three';
import { batchStaticMeshes } from '../src/client/staticBatch.ts';
import { ActorBatch } from '../src/client/actorBatch.ts';
import { createZombieView } from '../src/client/zombieView.ts';
import { interpolatePosition } from '../src/client/interpolation.ts';
import { CanvasHud, type HudSnapshot } from '../src/client/hud.ts';
import { FixedStepClock } from '../src/core/clock.ts';
import { FrameProfiler, type FrameProfile } from '../src/client/performance.ts';

afterEach(() => vi.unstubAllGlobals());

describe('render performance contracts', () => {
  it('summarizes stage costs and separates shadow-update frames', () => {
    const profiler = new FrameProfiler();
    const frame: FrameProfile = {
      intervalMs: 100, cpuMs: 8, simulationMs: 1, networkMs: 0.5,
      actorsMs: 1.5, detailsMs: 0.5, sceneMs: 2, weaponMs: 0.5,
      hudMs: 1, overlayMs: 0.5, shadowFrame: false,
      ticks: 6, calls: 90, triangles: 120_000, rigs: 24, scale: 1,
    };
    expect(profiler.add({ ...frame, intervalMs: 0 })).toBeNull();
    expect(profiler.add({ ...frame, intervalMs: 6000 })).toBeNull();
    for (let i = 0; i < 9; i++) expect(profiler.add({ ...frame, shadowFrame: i === 0,
      sceneMs: i === 0 ? 4 : 2, cpuMs: i === 0 ? 10 : 8 })).toBeNull();
    const report = profiler.add(frame)!;
    expect(report.fps).toBe(10);
    expect(report.frameP95Ms).toBe(100);
    expect(report.cpuP95Ms).toBe(10);
    expect(report.stages.scene).toBeCloseTo(2.2);
    expect(report.stages.other).toBeCloseTo(0.5);
    expect(report.shadowSceneMs).toBe(4);
    expect(report.regularSceneMs).toBe(2);
    expect(report.rigs).toBe(24);
    expect(profiler.add(frame)).toBeNull();
  });

  it('batches static geometry without changing world bounds or animated objects', () => {
    const scene = new THREE.Scene(), group = new THREE.Group(); scene.add(group);
    group.position.set(1, 2, 3); group.rotation.y = 0.2;
    const material = new THREE.MeshStandardMaterial();
    for (let i = 0; i < 10; i++) {
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(), material);
      mesh.position.x = i * 0.1; mesh.castShadow = true; group.add(mesh);
    }
    const animated = new THREE.Group(); animated.userData.dynamic = true; group.add(animated);
    const plank = new THREE.Mesh(new THREE.BoxGeometry(), material); animated.add(plank);
    const before = new THREE.Box3().setFromObject(scene);
    batchStaticMeshes(scene);
    const after = new THREE.Box3().setFromObject(scene);
    expect(before.min.distanceTo(after.min)).toBeLessThan(1e-6);
    expect(before.max.distanceTo(after.max)).toBeLessThan(1e-6);
    expect(plank.parent).toBe(animated);
    const meshes: THREE.Object3D[] = []; scene.traverse(object => { if (object instanceof THREE.Mesh) meshes.push(object); });
    expect(meshes).toHaveLength(2);
    expect((meshes.find(mesh => mesh !== plank) as THREE.Mesh).castShadow).toBe(true);
  });

  it('draws 24 animated zombies in four material batches and removes dead instances', () => {
    const scene = new THREE.Scene(), batch = new ActorBatch(scene);
    const views = Array.from({ length: 24 }, () => createZombieView());
    views.forEach((view, index) => { view.root.position.x = index; });
    batch.update(views.map(view => view.root));
    const meshes = scene.children as THREE.InstancedMesh[];
    expect(meshes).toHaveLength(4);
    expect(meshes.reduce((sum, mesh) => sum + mesh.count, 0)).toBe(288);
    batch.update([views[0].root]);
    expect(meshes.reduce((sum, mesh) => sum + mesh.count, 0)).toBe(12);
    batch.update([]);
    expect(meshes.every(mesh => mesh.count === 0)).toBe(true);
  });

  it('updates instance transforms when an actor animates', () => {
    const scene = new THREE.Scene(), batch = new ActorBatch(scene), view = createZombieView();
    batch.update([view.root]);
    const first = scene.children[0] as THREE.InstancedMesh, before = new THREE.Matrix4(), after = new THREE.Matrix4();
    first.getMatrixAt(0, before);
    view.root.position.x = 7; batch.update([view.root]); first.getMatrixAt(0, after);
    expect(after.elements[12] - before.elements[12]).toBeCloseTo(7);
  });

  it('renders distinct movement samples at 144 Hz while the world ticks at 60 Hz', () => {
    const clock = new FixedStepClock();
    let previous = { x: 0, y: 0, z: 0 }, current = { ...previous }, ticks = 0;
    const rendered: number[] = [];
    for (let frame = 0; frame < 144; frame++) {
      clock.advance(1 / 144, () => { previous = current; current = { ...current, x: current.x + 1 }; ticks++; });
      rendered.push(interpolatePosition(previous, current, clock.interpolationAlpha()).x);
    }
    expect(ticks).toBe(60);
    expect(new Set(rendered).size).toBeGreaterThan(140);
    expect(current.x).toBe(60);
  });

  it('snaps teleports rather than drawing a camera path through walls', () => {
    const current = { x: 10, y: 0, z: 0 };
    expect(interpolatePosition({ x: 0, y: 0, z: 0 }, current, 0.5)).toBe(current);
    expect(interpolatePosition(undefined, current, 0)).toBe(current);
  });

  it('redraws and uploads the HUD only when its displayed state changes', () => {
    // Each canvas gets its own mock context; any other drawing call is a no-op and gradients accept stops.
    const contexts: { clearRect: ReturnType<typeof vi.fn> }[] = [];
    vi.stubGlobal('document', { createElement: () => {
      const calls: Record<string | symbol, unknown> = { clearRect: vi.fn(), measureText: () => ({ width: 100 }) };
      const context = new Proxy(calls, { get: (target, key) => target[key]
        ?? (target[key] = vi.fn(() => ({ addColorStop: vi.fn() }))) }) as { clearRect: ReturnType<typeof vi.fn> };
      contexts.push(context);
      return { width: 0, height: 0, getContext: () => context };
    } });
    const renderer = { clearDepth: vi.fn(), render: vi.fn() };
    const hud = new CanvasHud(renderer as unknown as THREE.WebGLRenderer);
    // The HUD's own full-screen canvas is the first one it creates; animated pieces have their own.
    const context = contexts[0];
    const state: HudSnapshot = { health: 100, maxHealth: 100, perks: '', lastStand: null, reviveProgress: 0, team: '', pingMs: null, canRestart: true, points: 500, kills: 0, headshots: 0,
      round: 1, weapon: 'starter-pistol',
      magazineAmmo: 8, reserveAmmo: 32, holsteredWeapon: null, reloading: false,
      grenadeCharges: 2,
      roundPhase: 'waiting', interactionPrompt: null, nearbyPowerup: null, bonusStatus: null, instaKillStatus: null,
      gameOver: false, paused: false, godMode: false, noclip: false,
      sprinting: false, aiming: false };
    for (let i = 0; i < 144; i++) hud.render({ ...state,
      feedback: { message: null, hitMarker: null, damageVignette: false } });
    expect(context.clearRect).toHaveBeenCalledTimes(1);
    expect(renderer.render).toHaveBeenCalledTimes(144);
    hud.render({ ...state, godMode: true });
    hud.render({ ...state, godMode: true, interactionPrompt: 'Hold E to repair' });
    expect(context.clearRect).toHaveBeenCalledTimes(3);
    // A reload repaints once when it starts and once when it ends, not on every tick in between.
    for (let tick = 0; tick < 90; tick++) hud.render({ ...state, godMode: true, interactionPrompt: 'Hold E to repair', reloading: true });
    hud.render({ ...state, godMode: true, interactionPrompt: 'Hold E to repair' });
    expect(context.clearRect).toHaveBeenCalledTimes(5);
    hud.render({ ...state, godMode: true, interactionPrompt: 'Hold E to repair',
      feedback: { message: 'HEADSHOT', hitMarker: 'kill', damageVignette: false } });
    expect(context.clearRect).toHaveBeenCalledTimes(6);
    // Score popups and a round change animate on their own quads without repainting the HUD canvas.
    const frame = { ...state, godMode: true, interactionPrompt: 'Hold E to repair',
      feedback: { message: 'HEADSHOT', hitMarker: 'kill', damageVignette: false } } as HudSnapshot;
    hud.events([{ type: 'pointsAwarded', playerId: 'e:1', amount: 50, reason: 'kill', balance: 550 },
      { type: 'pointsSpent', playerId: 'e:1', amount: 950, reason: 'box', balance: 0 },
      { type: 'pointsAwarded', playerId: 'e:2', amount: 10, reason: 'hit', balance: 10 }], 'e:1', 0);
    for (let ms = 0; ms < 3000; ms += 16) hud.render({ ...frame, round: ms < 1500 ? 1 : 2 }, ms);
    // Only the round change itself repaints the canvas, once.
    expect(context.clearRect).toHaveBeenCalledTimes(7);
    hud.dispose();
  });
});
