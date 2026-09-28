/// <reference types="vite/client" />
import * as THREE from 'three';
import { buildGreybox } from './client/greybox.ts';
import { buildMapDetails } from './client/mapDetails.ts';
import { createZombieView, type ZombieView } from './client/zombieView.ts';
import { BrowserInput } from './client/input.ts';
import { SoloPauseController } from './client/pause.ts';
import { PerformanceOverlay } from './client/performance.ts';
import { batchStaticMeshes } from './client/staticBatch.ts';
import { ActorBatch } from './client/actorBatch.ts';
import { interpolatePosition } from './client/interpolation.ts';
import { CanvasHud, buildHudSnapshot } from './client/hud.ts';
import { HudFeedback } from './client/feedback.ts';
import { GameAudio } from './client/audio.ts';
import { decodeAudioClips } from './client/audioClips.ts';
import { loadModel, loadZombieAsset, type ZombieAsset, type ZombieAssetId } from './client/runtimeAssets.ts';
import { SkinnedZombieView } from './client/skinnedZombieView.ts';
import { WeaponView, prepareWeaponModel } from './client/weaponView.ts';
import { PowerupView } from './client/powerupView.ts';
import { GrenadeView } from './client/grenadeView.ts';
import { readEnvironmentManifest, loadEnvironmentMaterials } from './client/environmentMaterials.ts';
import { buildEnvironmentProps, buildEnvironmentDecals, loadDecalTextures } from './client/environmentProps.ts';
import {
  FixedStepClock, GameSimulation, PLAYER_MOVEMENT, DEFAULT_POWERUP_CONFIG,
  createWeaponState, createZombieState, WEAPON_DEFINITIONS, allocateEntityId, addEntity, currentSpread,
  type EntityId, type ZombieState, type Vec3, DOWN_RULES, damagePlayer,
} from './core/index.ts';
import { MAPS, isMapId, type MapId } from './maps/index.ts';

import { DEFAULT_SETTINGS, type GameSettings } from './client/settings.ts';
// Re-exported so the start screen can preload through the same chunk it will run.
export { downloadAssets, gameAssetUrls, type DownloadProgress } from './client/preload.ts';

export interface GameSession {
  ready: Promise<void>;
  start(): void;
  resume(): void;
  restart(): void;
  updateSettings(settings: GameSettings): void;
  dispose(): void;
}
export interface GameHooks { onPauseChange?(paused: boolean): void }

/**
 * Start-screen warm-up after the download: decode every environment texture and parse the props, the
 * zombie rig and the starting pistol into the loaders' page-wide caches, so startGame finds them ready.
 * Failures are left for the game to report; it already falls back to placeholders.
 */
export async function prepareGameAssets(onProgress: (done: number, total: number) => void,
  zombie: ZombieAssetId = 'peter_d'): Promise<void> {
  // Warm every map's assets: the map is chosen after this, on the Solo screen.
  const allMaps = Object.values(MAPS);
  const manifest = await readEnvironmentManifest().catch(() => null);
  const tasks: Array<() => Promise<unknown> | null> = [
    ...(manifest ? [() => loadEnvironmentMaterials(manifest),
      ...[...new Set(allMaps.flatMap(map => map.decals.map(decal => decal.asset)))].map(id => () => loadDecalTextures(manifest, id))] : []),
    ...[...new Set(allMaps.flatMap(map => map.props.map(prop => prop.asset)))].map(asset => () => loadModel(`props/${asset}/model.glb`)),
    () => loadZombieAsset(zombie),
    () => prepareWeaponModel('starter-pistol'),
    // The chalk wall buys hang the real guns.
    ...[...new Set(allMaps.flatMap(map => map.wallWeapons.map(wall => wall.weaponId)))].map(id => () => prepareWeaponModel(id)),
    // Every sound, so the first shot and the first moan play on the first frame of the map.
    () => decodeAudioClips(),
  ];
  let done = 0;
  onProgress(done, tasks.length);
  for (const task of tasks) {
    try { await task(); } catch { /* reported in game */ }
    onProgress(++done, tasks.length);
  }
}

/**
 * Builds the chosen map, the simulation and every view on the given canvas, then runs the frame loop.
 * Loaded on demand (dynamic import) when Solo is chosen, so the menu never pays for the map.
 * Resolves once the map, props, zombie and starting gun are in place, textures are uploaded and shaders
 * compiled, so the caller can keep the canvas hidden until then and never show a half-loaded map.
 */
export function startGame(canvas: HTMLCanvasElement, initialSettings: GameSettings = DEFAULT_SETTINGS,
  mapId: MapId = 'bunker', hooks: GameHooks = {}): GameSession {
  let settings = { ...initialSettings };
  // Development previews (`?preview=`) pick their map with `&map=`.
  const previewMap = import.meta.env.DEV ? new URLSearchParams(location.search).get('map') : null;
  const map = MAPS[isMapId(previewMap) ? previewMap : mapId];

  const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 1));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.shadowMap.autoUpdate = false;
  renderer.autoClear = false;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.35;

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x1d2b30);
  scene.fog = new THREE.FogExp2(0x1d2b30, 0.027);

  const camera = new THREE.PerspectiveCamera(settings.fov, 1, 0.05, 80);
  camera.rotation.order = 'YXZ';
  scene.add(new THREE.HemisphereLight(0xaabfc9, 0x373026, 1.4));
  const keyLight = new THREE.DirectionalLight(0xb4ced7, 2.4);
  // Aimed at the middle of the building, with a shadow frustum that covers all of it.
  const { focus } = map;
  keyLight.position.set(focus.x - 12, 22, focus.z - 16); keyLight.target.position.set(focus.x, 0, focus.z); scene.add(keyLight.target);
  keyLight.castShadow = true;
  // A larger building spreads the same shadow map further, so give it more texels.
  const shadowSize = focus.radius > 24 ? 2048 : 1024;
  keyLight.shadow.mapSize.set(shadowSize, shadowSize);
  Object.assign(keyLight.shadow.camera, { left: -focus.radius, right: focus.radius, top: focus.radius, bottom: -focus.radius,
    far: 45 + focus.radius * 1.2 });
  keyLight.shadow.bias = -0.0006;
  scene.add(keyLight);
  scene.add(buildGreybox(map.greybox, map.prisms));
  const details = buildMapDetails(scene, map);
  batchStaticMeshes(scene);
  let environmentNotice: string | null = 'Loading map materials and props…';
  const environmentReady = (async () => {
    // Prop proxies/collision must stay visible even when the texture manifest fails.
    const props = buildEnvironmentProps(scene, map.props);
    const surfaces = readEnvironmentManifest().then(manifest =>
      Promise.all([loadEnvironmentMaterials(manifest), buildEnvironmentDecals(scene, manifest, map.decals)]))
      .catch(error => { console.warn('Environment manifest unavailable', error); return [1]; });
    const [propFailures, surfaceFailures] = await Promise.all([props, surfaces]);
    environmentNotice = propFailures > 0 || surfaceFailures.some(n => n > 0) ? 'Some environment assets failed to load; check console' : null;
    renderer.shadowMap.needsUpdate = true;
  })().catch(error => { environmentNotice = 'Environment pack unavailable; using plain fallback'; console.warn(error); });

  // Development-only inspection views for iterating on the map without a running wave.
  const previewViews: Record<string, { position: Vec3; yaw: number }> = {
    start: { position: map.playerSpawn, yaw: -0.35 },
    stress: { position: map.playerSpawn, yaw: -0.35 },
    assets: { position: map.playerSpawn, yaw: 0 },
    gameOver: { position: map.playerSpawn, yaw: -0.35 },
    overview: { position: { x: map.focus.x + map.focus.radius, y: map.focus.radius * 1.3, z: map.focus.z + map.focus.radius * 1.4 }, yaw: 0.65 },
    ...map.previews,
  };

  const previewName = new URLSearchParams(location.search).get('preview');
  const previewPowerup = new URLSearchParams(location.search).get('powerup');
  const forceAim = import.meta.env.DEV && new URLSearchParams(location.search).get('aim') === '1';
  const preview = import.meta.env.DEV && previewName && Object.hasOwn(previewViews, previewName)
    ? previewViews[previewName as keyof typeof previewViews] : null;

  const simulation = new GameSimulation({
    seed: 0x5a0b0a2,
    map: {
      collisionBoxes: [...map.collisionBoxes],
      shotBlockers: map.shotBlockers,
      walkSurfaces: map.walkSurfaces,
      zombieSpawns: preview && previewName === 'barrier' ? [map.zombieSpawns[0]] : map.zombieSpawns,
      barriers: map.barriers,
      navigationGraph: map.navigation,
      doors: map.doors,
      wallWeapons: map.wallWeapons,
      mysteryBoxes: map.mysteryBoxes,
      powerSwitch: map.powerSwitch,
      perkMachines: map.perkMachines,
      traps: map.traps,
    },
    playerSpawns: [preview?.position ?? map.playerSpawn],
    ...(previewName === 'stress' && preview ? { spawnConfig: {
      baseZombieCount: 24, additionalPerRound: 0, spawnIntervalTicks: 1, maxAlive: 24,
    } } : {}),
    ...(previewName === 'assets' && preview ? { powerupConfig: {
      ...DEFAULT_POWERUP_CONFIG, randomDropPercent: 100, maxDropsPerRound: 1_000_000,
      kinds: [previewPowerup === 'doublePoints' ? 'doublePoints'
        : previewPowerup === 'instaKill' ? 'instaKill'
          : previewPowerup === 'nuke' ? 'nuke' : 'maxAmmo'] as const,
    } } : {}),
    ...(preview ? { roundConfig: { initialWaitTicks: previewName === 'barrier' || previewName === 'stress' ? 120 : 2147483647, intermissionTicks: 180 },
      economyConfig: { startingPoints: 10000, hitReward: 10, killBonus: 50 } }
      : { roundConfig: { initialWaitTicks: 1, intermissionTicks: 600 } }),
  });
  const playerId = simulation.playerIds[0];
  if (!simulation.getPlayer(playerId)) throw new Error('Simulation failed to create local player.');
  if (preview) {
    simulation.getPlayer(playerId)!.yaw = preview.yaw;
    if (previewName === 'overview') {
      simulation.getPlayer(playerId)!.noclip = true;
      simulation.getPlayer(playerId)!.pitch = -0.85;
    }
    if (previewName === 'stress') simulation.getPlayer(playerId)!.godMode = true;
    // `&power=on` starts with the power on; `&traps=on` also sets every electric trap running.
    const previewParams = new URLSearchParams(location.search);
    if (previewParams.get('power') === 'on' || previewParams.get('traps') === 'on') {
      simulation.state.power.on = true;
      for (const door of simulation.state.doors) if (door.requiresPower) {
        door.open = true;
        const item = simulation.interactables().find(entry => entry.id === door.interactableId);
        if (item) item.enabled = false;
      }
    }
    if (previewParams.get('traps') === 'on') for (const trap of simulation.state.traps) {
      trap.activeTicks = 2147483647; trap.ownerId = playerId;
    }
    // `&down=on` shows last stand: with Quick Revive, so solo play gets back up rather than ending.
    if (previewParams.get('down') === 'on') {
      const player = simulation.getPlayer(playerId)!;
      player.perks = ['quick-revive']; player.health = 1;
      damagePlayer(player, 50);
    }
    // `&round=N` starts the wave at round N (after the usual intermission) to inspect later-round gaits.
    const previewRound = Number(new URLSearchParams(location.search).get('round'));
    if (Number.isInteger(previewRound) && previewRound > 1) {
      Object.assign(simulation.state.round, { round: previewRound - 1, phase: 'intermission', phaseTicks: 0 });
    }
    if (previewName === 'gameOver') {
      Object.assign(simulation.getPlayer(playerId)!, { points: 12345, kills: 42, headshots: 13 });
      Object.assign(simulation.state.round, { round: 9, phase: 'gameOver' });
    }
    for (const door of simulation.state.doors) door.open = true;
    for (const item of simulation.interactables()) if (item.interactionType === 'door') item.enabled = false;
    const testWeapon = new URLSearchParams(location.search).get('weapon');
    if (testWeapon && Object.hasOwn(WEAPON_DEFINITIONS, testWeapon)) {
      simulation.getPlayer(playerId)!.weapon = createWeaponState(testWeapon);
    }
    if (previewName === 'assets') {
      const target = createZombieState(allocateEntityId(simulation.state.world),
        { x: map.playerSpawn.x, y: 0, z: map.playerSpawn.z - 5 }, 1);
      target.moveSpeed = 0; addEntity(simulation.state.world, target);
    }
  }

  const zombieViews = new Map<EntityId, ZombieView>();
  const zombieBatch = new ActorBatch(scene);
  const previousPositions = new Map<EntityId, Vec3>();
  const skinnedViews = new Map<EntityId, SkinnedZombieView>();
  let zombieAsset: ZombieAsset | undefined;
  let zombieAssetNotice: string | null = 'Loading zombie model…';
  const zombieVariant = new URLSearchParams(location.search).get('zombie') === 'pxltiger' ? 'pxltiger' : 'peter_d';
  const zombieReady = loadZombieAsset(zombieVariant).then(asset => {
    zombieAsset = asset; zombieAssetNotice = null;
    zombieViews.clear(); zombieBatch.update([]);
  }).catch(error => {
    zombieAssetNotice = 'Zombie asset failed to load; using low-poly fallback';
    console.warn('Unable to load zombie asset', error);
  });
  const weaponView = new WeaponView();
  const powerupView = new PowerupView(scene);
  const grenadeView = new GrenadeView(scene);

  function zombies(): ZombieState[] {
    return simulation.zombies();
  }
  function syncZombieViews(alpha: number): void {
    if (zombieAsset) {
      const tick = simulation.state.world.tick - 1 + alpha;
      for (const [id, view] of skinnedViews) if (!simulation.state.world.entities[id]) {
        view.dispose(); skinnedViews.delete(id);
      }
      for (const entity of Object.values(simulation.state.world.entities)) {
        if (entity.kind !== 'zombie') continue;
        let view = skinnedViews.get(entity.id);
        if (!view) {
          if (!entity.alive) continue;
          view = new SkinnedZombieView(zombieAsset, Number(entity.id.slice(2)) * 0.37);
          skinnedViews.set(entity.id, view); scene.add(view.root);
        }
        view.update(entity, tick, simulation.state.barriers.find(barrier => barrier.id === entity.entry?.barrierId),
          previousPositions.get(entity.id), alpha);
        if (view.expired(tick)) { view.dispose(); skinnedViews.delete(entity.id); }
      }
      // Corpse presentation must not accumulate unbounded skeleton work over a match.
      const corpses = [...skinnedViews].filter(([id]) => !simulation.state.world.entities[id]?.alive);
      for (const [id, view] of corpses.slice(0, Math.max(0, corpses.length - 8))) { view.dispose(); skinnedViews.delete(id); }
      return;
    }
    const liveIds = new Set<EntityId>();
    for (const zombie of zombies()) {
      liveIds.add(zombie.id);
      let view = zombieViews.get(zombie.id);
      if (!view) {
        view = createZombieView();
        zombieViews.set(zombie.id, view);
      }
      view.update(zombie, simulation.state.world.tick - 1 + alpha,
        simulation.state.barriers.find(barrier => barrier.id === zombie.entry?.barrierId), previousPositions.get(zombie.id), alpha);
    }
    for (const id of zombieViews.keys()) {
      if (liveIds.has(id)) continue;
      zombieViews.delete(id);
    }
    zombieBatch.update(Array.from(zombieViews.values(), view => view.root));
  }

  const clock = new FixedStepClock({ tickRate: 60 });
  const input = new BrowserInput({ pointerElement: canvas, lookSensitivity: 0.0022 * settings.sensitivity, previewFireKey: !!preview });
  const audio = new GameAudio(canvas);
  audio.setPaused(!preview);
  if (!preview) audio.startFromGesture();
  audio.setVolume(settings.volume);
  const pause = new SoloPauseController(canvas, window, document, paused => {
    clock.reset(); previousPositions.clear();
    if (paused) input.clear();
    audio.setPaused(paused);
    hooks.onPauseChange?.(paused);
  }, !preview, () => !preview, !preview);
  const hud = new CanvasHud(renderer, map.name);
  const feedback = new HudFeedback();
  const performanceOverlay = new PerformanceOverlay();
  renderer.info.autoReset = false;
  let previousSeconds: number | undefined;
  let lastShadowTick = -Infinity;
  let disposed = false;
  let frameId = 0;

  function simulate(dt: number): void {
    previousPositions.clear();
    const world = simulation.state.world;
    for (const entity of Object.values(world.entities)) {
      if (entity.alive && (entity.kind === 'player' || entity.kind === 'zombie')) {
        previousPositions.set(entity.id, { ...entity.position });
      }
    }
    const inputFrame = input.consume();
    if (forceAim) inputFrame.actions.aim = { held: true, pressed: false, released: false, value: 1 };
    const events = simulation.tick({ [playerId]: inputFrame }, dt);
    weaponView.events(events, playerId, simulation.state.world.tick);
    grenadeView.events(events, simulation.state.world.tick);
    feedback.consume(events, playerId, simulation.state.world.tick);
    hud.events(events, playerId);
    audio.consume(events, playerId, simulation.state.world);
    if (simulation.state.world !== world) {
      previousPositions.clear();
      for (const view of skinnedViews.values()) view.dispose();
      skinnedViews.clear(); zombieViews.clear();
    }
  }
  function syncCamera(alpha = 1): void {
    const player = simulation.getPlayer(playerId);
    if (!player) return;
    const position = interpolatePosition(previousPositions.get(playerId), player.position, alpha);
    // In last stand the view drops to the floor and lists to one side.
    camera.position.set(position.x, position.y + (player.downed ? DOWN_RULES.eyeHeight : PLAYER_MOVEMENT.eyeHeight), position.z);
    const look = input.pendingLook();
    camera.rotation.x = Math.max(-PLAYER_MOVEMENT.maxPitch, Math.min(PLAYER_MOVEMENT.maxPitch, player.pitch + look.pitch));
    camera.rotation.y = player.yaw + look.yaw;
    camera.rotation.z = player.downed ? 0.22 : 0;
  }

  function resize(): void {
    const width = innerWidth;
    const height = innerHeight;
    renderer.setSize(width, height, false);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
  }

  let lastWarmFrame = 0;
  function warmUpcomingWeapons(): void {
    for (const box of simulation.state.mysteryBoxes) if (box.lastWeapon) prepareWeaponModel(box.lastWeapon);
    const candidate = simulation.interactionCandidate(playerId);
    const wall = simulation.state.wallWeapons.find(weapon => weapon.interactableId === candidate?.interactableId);
    if (wall) prepareWeaponModel(wall.weaponId);
    const holstered = simulation.getPlayer(playerId)?.holsteredWeapon;
    if (holstered) prepareWeaponModel(holstered.weaponId);
  }

  function frame(nowMs: number): void {
    if (disposed) return;
    const started = performance.now();
    if (++lastWarmFrame % 20 === 0) warmUpcomingWeapons();
    const nowSeconds = nowMs / 1000;
    if (previousSeconds === undefined) previousSeconds = nowSeconds;
    const interval = (nowSeconds - previousSeconds) * 1000;
    if (pause.paused) { input.clear(); clock.reset(); }
    else clock.advance(nowSeconds - previousSeconds, simulate);
    const simulationMs = performance.now() - started;
    previousSeconds = nowSeconds;
    const alpha = clock.interpolationAlpha();
    syncCamera(alpha);
    const playerForCamera = simulation.getPlayer(playerId);
    // Aiming narrows and sprinting widens the player's chosen field of view, as the defaults 54/67/71 did.
    const targetFov = playerForCamera?.aiming ? settings.fov - 13 : playerForCamera?.sprinting ? settings.fov + 4 : settings.fov;
    const fovBlend = 1 - Math.exp(-12 * Math.min(0.1, Math.max(0, interval / 1000)));
    const nextFov = camera.fov + (targetFov - camera.fov) * fovBlend;
    if (Math.abs(nextFov - camera.fov) > 0.001) { camera.fov = nextFov; camera.updateProjectionMatrix(); }
    syncZombieViews(alpha);
    powerupView.update(simulation.state.powerups.drops, simulation.state.world.tick - 1 + alpha);
    grenadeView.update(simulation.state.grenades.active, simulation.state.world.tick - 1 + alpha);
    details.update(simulation.state);
    renderer.clear();
    renderer.info.reset();
    // The moon/camera are independent: expensive skinned shadow passes only need
    // 15 Hz updates. Models and camera still render at the display's full rate.
    if (simulation.state.world.tick - lastShadowTick >= 4 || simulation.state.world.tick < lastShadowTick) {
      renderer.shadowMap.needsUpdate = true; lastShadowTick = simulation.state.world.tick;
    }
    renderer.render(scene, camera);
    const player = simulation.getPlayer(playerId);
    if (player) { weaponView.update(player, simulation.state.world.tick - 1 + alpha, interval / 1000); weaponView.render(renderer, camera.aspect); }
    const hudStarted = performance.now();
    const hudSnapshot = buildHudSnapshot(simulation, playerId);
    if (hudSnapshot) hud.render({ ...hudSnapshot, paused: pause.paused,
      feedback: feedback.snapshot(simulation.state.world.tick),
      assetNotice: zombieAssetNotice ?? weaponView.notice ?? environmentNotice }, performance.now(),
      player ? { spread: currentSpread(player), verticalFov: camera.fov } : undefined);
    performanceOverlay.sample(interval, performance.now() - started, simulationMs, performance.now() - hudStarted,
      renderer.info.render.calls, renderer.info.render.triangles, renderer.getPixelRatio());
    performanceOverlay.render(renderer);
    frameId = requestAnimationFrame(frame);
  }

  addEventListener('resize', resize);
  resize();
  syncCamera();
  frameId = requestAnimationFrame(frame);

  const startingWeapon = simulation.getPlayer(playerId)?.weapon.weaponId ?? 'starter-pistol';
  const ready = (async () => {
    await Promise.allSettled([environmentReady, zombieReady, details.ready, prepareWeaponModel(startingWeapon)]);
    // Upload every texture and compile every shader now, rather than stuttering on the first frames.
    await renderer.compileAsync(scene, camera);
    scene.traverse(object => {
      const materials = (object as THREE.Mesh).material;
      for (const material of Array.isArray(materials) ? materials : materials ? [materials] : []) {
        const standard = material as THREE.MeshStandardMaterial;
        for (const texture of [standard.map, standard.normalMap, standard.roughnessMap, standard.aoMap,
          standard.metalnessMap, standard.alphaMap, standard.emissiveMap]) if (texture) renderer.initTexture(texture);
      }
    });
    await weaponView.warm(renderer);
    // Let the frame loop draw twice with everything in place before the caller reveals the canvas.
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    // Then unpack the rest of the box's guns one at a time in the background, so the box's roll can
    // flick through real models without one long stall.
    void (async () => {
      for (const id of map.mysteryBoxes[0].weapons) {
        if (disposed) break;
        await prepareWeaponModel(id)?.catch(() => {});
        await new Promise(resolve => setTimeout(resolve, 60));
      }
    })();
  })();
  return {
    ready,
    start: () => {
      pause.resume();
      if (pause.paused) hooks.onPauseChange?.(true);
    },
    resume: () => pause.resume(),
    restart: () => {
      const event = simulation.restart();
      input.clear(); clock.reset(); previousPositions.clear(); previousSeconds = undefined; lastShadowTick = -Infinity;
      for (const view of skinnedViews.values()) view.dispose();
      skinnedViews.clear(); zombieViews.clear(); zombieBatch.update([]);
      grenadeView.events([event], simulation.state.world.tick);
      weaponView.events([event], playerId, simulation.state.world.tick);
      feedback.consume([event], playerId, simulation.state.world.tick);
      hud.reset();
      audio.consume([event], playerId, simulation.state.world);
      pause.resume();
    },
    updateSettings: next => {
      settings = { ...next };
      input.setSensitivity(0.0022 * settings.sensitivity);
      audio.setVolume(settings.volume);
    },
    dispose: () => {
      if (disposed) return;
      disposed = true;
      cancelAnimationFrame(frameId);
      removeEventListener('resize', resize);
      pause.dispose(); input.dispose(); audio.dispose(); hud.dispose();
      performanceOverlay.dispose(); powerupView.dispose(); zombieBatch.dispose();
      for (const view of skinnedViews.values()) view.dispose();
      skinnedViews.clear(); zombieViews.clear();
      renderer.dispose();
    },
  };
}
