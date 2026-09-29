/// <reference types="vite/client" />
import * as THREE from 'three';
import { buildGreybox } from './client/greybox.ts';
import { VENDING_MODEL, buildMapDetails } from './client/mapDetails.ts';
import { LightPool } from './client/lightPool.ts';
import { fitShadowCamera, placeMoon } from './client/shadowFit.ts';
import { createZombieView, type ZombieView } from './client/zombieView.ts';
import { BrowserInput } from './client/input.ts';
import { ADS_LOOK_SCALE, aimedFov } from './client/aim.ts';
import { loadBindings, type KeyBindings } from './client/bindings.ts';
import { SoloPauseController } from './client/pause.ts';
import { PerformanceOverlay } from './client/performance.ts';
import { batchStaticMeshes } from './client/staticBatch.ts';
import { ActorBatch } from './client/actorBatch.ts';
import { interpolatePosition } from './client/interpolation.ts';
import { CanvasHud, buildHudSnapshot } from './client/hud.ts';
import { HudFeedback } from './client/feedback.ts';
import { GameAudio } from './client/audio.ts';
import { AUDIO_CLIPS, decodeAudioClips, decodedAudioClip } from './client/audioClips.ts';
import { ZOMBIE_ASSET_IDS, loadModel, loadZombieAsset, zombieAssetFor, type ZombieAsset } from './client/runtimeAssets.ts';
import { zombieLook } from './client/zombieLooks.ts';
import { SkinnedZombieView } from './client/skinnedZombieView.ts';
import { WeaponView, prepareWeaponModel } from './client/weaponView.ts';
import { PowerupView } from './client/powerupView.ts';
import { GrenadeView } from './client/grenadeView.ts';
import { BlastEffects, groundFromSurfaces } from './client/blastEffects.ts';
import { HazardView } from './client/hazardView.ts';
import { HitboxView } from './client/hitboxView.ts';
import { GoreEffects } from './client/goreEffects.ts';
import { GoreDirector } from './client/goreDirector.ts';
import { MineView } from './client/mineView.ts';
import { createGrenadeModel, createMineModel } from './client/explosiveModels.ts';
import { readEnvironmentManifest, loadEnvironmentMaterials } from './client/environmentMaterials.ts';
import { buildEnvironmentProps, buildEnvironmentDecals, loadDecalTextures } from './client/environmentProps.ts';
import {
  FixedStepClock, GameSimulation, PLAYER_MOVEMENT, playerEyeHeight, DEFAULT_POWERUP_CONFIG,
  createWeaponState, createZombieState, WEAPON_DEFINITIONS, allocateEntityId, addEntity, currentSpread,
  type EntityId, type ZombieState, type Vec3, type PowerupKind, DOWN_RULES, damagePlayer, createInputFrame, type SimulationEvent,
} from './core/index.ts';
import { MAPS, isMapId, type MapId } from './maps/index.ts';
import { createMatch, simulationMap } from './maps/match.ts';
import type { NetHost } from './net/host.ts';
import type { NetClient, StartInfo } from './net/client.ts';
import type { LobbyPlayer } from './net/protocol.ts';
import { PlayerView, TEAMMATE_MODEL } from './client/playerView.ts';
import { applySky } from './client/sky.ts';
import { TREELINE_ASSETS, buildTreeline } from './client/treeline.ts';

import { DEFAULT_SETTINGS, type GameSettings } from './client/settings.ts';
// Re-exported so the start screen can preload through the same chunk it will run.
export { downloadAssets, gameAssetUrls, loadBootstrapManifest, markPrepared, openAssetCache, wasPrepared,
  type DownloadProgress, type BootstrapManifest } from './client/preload.ts';

export interface GameSession {
  ready: Promise<void>;
  start(): void;
  resume(): void;
  restart(): void;
  updateSettings(settings: GameSettings): void;
  updateBindings(bindings: KeyBindings): void;
  dispose(): void;
}
export interface GameHooks {
  onPauseChange?(paused: boolean): void;
  /** A co-op game ended from the other side: the host left, or the connection dropped. */
  onDisconnected?(reason: string): void;
}
/** A co-op game, as its host or as a player who joined. */
export type NetPlay =
  | { role: 'host'; host: NetHost; players: LobbyPlayer[]; seed: number }
  | { role: 'client'; client: NetClient; start: StartInfo };

/**
 * Start-screen warm-up after the download: decode every environment texture and parse the props, the
 * zombie rig and the starting pistol into the loaders' page-wide caches, so startGame finds them ready.
 * Bootstrap stops if required preparation fails, so menus never advertise an incomplete installation.
 */
export async function prepareGameAssets(onProgress: (done: number, total: number) => void): Promise<void> {
  // Warm every map's assets: the map is chosen after this, on the Solo screen.
  const allMaps = Object.values(MAPS);
  const manifest = await readEnvironmentManifest();
  const tasks: Array<() => Promise<unknown> | null> = [
    async () => { if (await loadEnvironmentMaterials(manifest)) throw new Error('Environment textures failed to decode.'); },
    ...[...new Set(allMaps.flatMap(map => map.decals.map(decal => decal.asset)))].map(id => () => loadDecalTextures(manifest, id)),
    ...[...new Set([...allMaps.flatMap(map => map.props.map(prop => prop.asset)), ...TREELINE_ASSETS])]
      .map(asset => () => loadModel(`props/${asset}/model.glb`)),
    () => loadModel(VENDING_MODEL),
    () => loadModel(TEAMMATE_MODEL),
    ...ZOMBIE_ASSET_IDS.map(id => () => loadZombieAsset(id)),
    () => prepareWeaponModel('starter-pistol'),
    // Model-derived chalk outlines need the weapon assets ready before the map appears.
    ...[...new Set(allMaps.flatMap(map => map.wallWeapons.map(wall => wall.weaponId)))].map(id => () => prepareWeaponModel(id)),
    // Every sound, so the first shot and the first moan play on the first frame of the map.
    async () => {
      await decodeAudioClips();
      if (AUDIO_CLIPS.some(clip => !decodedAudioClip(clip))) throw new Error('Audio clips failed to decode.');
    },
  ];
  let done = 0;
  const failures: unknown[] = [];
  onProgress(done, tasks.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(4, tasks.length) }, async () => {
    while (next < tasks.length) {
      const task = tasks[next++];
      try { await task(); } catch (error) { failures.push(error); }
      onProgress(++done, tasks.length);
    }
  }));
  if (failures.length) throw new AggregateError(failures, `${failures.length} asset preparation tasks failed.`);
}

/** Dev previews keep one seed so a given view always looks the same. */
const PREVIEW_SEED = 0x5a0b0a2;
/**
 * The seed a solo match starts from. Every roll of the box and every drop derives from it, so a
 * fixed one would replay the same match; each session takes a fresh random one. Dev builds can pin
 * it with `?seed=<n>` to reproduce a run.
 */
function soloSeed(preview: boolean): number {
  if (preview) return PREVIEW_SEED;
  const pinned = import.meta.env.DEV ? new URLSearchParams(location.search).get('seed') : null;
  if (pinned !== null && Number.isFinite(Number(pinned))) return Number(pinned) >>> 0;
  return crypto.getRandomValues(new Uint32Array(1))[0];
}

/**
 * Builds the chosen map, the simulation and every view on the given canvas, then runs the frame loop.
 * Loaded on demand (dynamic import) when Solo is chosen, so the menu never pays for the map.
 * Resolves once the map, props, zombie and starting gun are in place, textures are uploaded and shaders
 * compiled, so the caller can keep the canvas hidden until then and never show a half-loaded map.
 */
export function startGame(canvas: HTMLCanvasElement, initialSettings: GameSettings = DEFAULT_SETTINGS,
  mapId: MapId = 'bunker', hooks: GameHooks = {}, net?: NetPlay): GameSession {
  let settings = { ...initialSettings };
  // Development previews (`?preview=`) pick their map with `&map=`.
  const previewMap = import.meta.env.DEV && !net ? new URLSearchParams(location.search).get('map') : null;
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
  // Aimed at the middle of the building; the shadow camera is fitted to its walls and roofs below.
  const { focus } = map;
  placeMoon(keyLight, focus); scene.add(keyLight.target);
  keyLight.castShadow = true;
  // A larger building spreads the same shadow map further, so give it more texels.
  const shadowSize = focus.radius > 24 ? 2048 : 1024;
  keyLight.shadow.mapSize.set(shadowSize, shadowSize);
  keyLight.shadow.bias = -0.0006;
  scene.add(keyLight);
  const greybox = buildGreybox(map.greybox, map.prisms);
  scene.add(greybox);
  // Anything outside the shadow camera's box is lit, so it must reach every corner of every roof and wall.
  if (!fitShadowCamera(keyLight, greybox)) {
    Object.assign(keyLight.shadow.camera, { left: -focus.radius, right: focus.radius, top: focus.radius, bottom: -focus.radius,
      far: 45 + focus.radius * 1.2 });
  }
  // The map's lamps, perk machines, traps and box glow share a few real point lights.
  const lightPool = new LightPool(scene);
  const details = buildMapDetails(scene, map, lightPool);
  /** Whether the moon's shadow map is out of date: it is redrawn only when the building changes. */
  let shadowsDirty = true;
  batchStaticMeshes(scene);
  // Scenery beyond the building is a few hundred plain boxes: one batch per material costs fewer draws
  // than culling it in pieces would save.
  if (map.scenery?.length) {
    const scenery = buildGreybox(map.scenery); scenery.name = 'map-scenery';
    batchStaticMeshes(scenery, Infinity); scene.add(scenery);
  }
  let environmentNotice: string | null = 'Loading map materials and props…';
  const environmentReady = (async () => {
    // Prop proxies/collision must stay visible even when the texture manifest fails.
    const props = buildEnvironmentProps(scene, map.props);
    const surfaces = readEnvironmentManifest().then(manifest =>
      Promise.all([loadEnvironmentMaterials(manifest), buildEnvironmentDecals(scene, manifest, map.decals),
        applySky(scene, manifest, keyLight).then(() => 0, error => { console.warn('Night sky unavailable', error); return 1; }),
        buildTreeline(scene, map).then(() => 0)]))
      .catch(error => { console.warn('Environment manifest unavailable', error); return [1]; });
    const [propFailures, surfaceFailures] = await Promise.all([props, surfaces]);
    environmentNotice = propFailures > 0 || surfaceFailures.some(n => n > 0) ? 'Some environment assets failed to load; check console' : null;
    shadowsDirty = true;
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
  const previewPowerup = (DEFAULT_POWERUP_CONFIG.kinds as readonly PowerupKind[])
    .find(kind => kind === new URLSearchParams(location.search).get('powerup')) ?? 'maxAmmo';
  const forceAim = import.meta.env.DEV && new URLSearchParams(location.search).get('aim') === '1';
  const previewTeammate = import.meta.env.DEV ? new URLSearchParams(location.search).get('teammate') : null;
  const preview = import.meta.env.DEV && !net && previewName && Object.hasOwn(previewViews, previewName)
    ? previewViews[previewName as keyof typeof previewViews] : null;

  // Everyone in a co-op game builds the same match; the host's runs it, clients' copies follow it.
  const lobbyPlayers = net ? net.role === 'host' ? net.players : net.start.players : [];
  const simulation = net ? createMatch(map, lobbyPlayers.length, net.role === 'host' ? net.seed : net.start.seed) : new GameSimulation({
    seed: soloSeed(preview !== null),
    map: { ...simulationMap(map), zombieSpawns: preview && previewName === 'barrier' ? [map.zombieSpawns[0]] : map.zombieSpawns,
      // The map says how many of each look; `?zombie=peter_d` or `?zombie=pxltiger` makes every zombie one of them.
      zombieLooks: ({ peter_d: [1, 0], pxltiger: [0, 1] } as Record<string, number[]>)[new URLSearchParams(location.search).get('zombie') ?? ''] ?? map.zombieLooks },
    // `&teammate=idle|run|down` adds a teammate three metres ahead, to inspect their figure.
    playerSpawns: [preview?.position ?? map.playerSpawn, ...(previewTeammate && preview ? [{
      x: preview.position.x - Math.sin(preview.yaw) * 3, y: preview.position.y, z: preview.position.z - Math.cos(preview.yaw) * 3 }] : [])],
    ...(previewName === 'stress' && preview ? { spawnConfig: {
      baseZombieCount: 24, additionalPerRound: 0, spawnIntervalTicks: 1, maxAlive: 24,
    } } : {}),
    ...(previewName === 'assets' && preview ? { powerupConfig: {
      ...DEFAULT_POWERUP_CONFIG, randomDropPercent: 100, maxDropsPerRound: 1_000_000,
      kinds: [previewPowerup],
    } } : {}),
    ...(preview ? { roundConfig: { initialWaitTicks: previewName === 'barrier' || previewName === 'stress' ? 120 : 2147483647, intermissionTicks: 180 },
      economyConfig: { startingPoints: 10000, hitReward: 10, killBonus: 50 } }
      : { roundConfig: { initialWaitTicks: 1, intermissionTicks: 600 } }),
  });
  const playerId = simulation.playerIds[net?.role === 'client' ? net.start.slot : 0];
  if (!simulation.getPlayer(playerId)) throw new Error('Simulation failed to create local player.');
  /** Every player's name by entity id, in a co-op game. */
  const names = new Map<EntityId, string>(lobbyPlayers.map(player => [simulation.playerIds[player.slot], player.name]));
  const previewMate = previewTeammate && preview ? simulation.getPlayer(simulation.playerIds[1]) : null;
  if (previewMate) {
    names.set(previewMate.id, 'Teammate');
    previewMate.yaw = preview!.yaw + Math.PI + (previewTeammate === 'run' ? Math.PI / 2 : 0);
    if (previewTeammate === 'down') { previewMate.health = 1; damagePlayer(previewMate, 50); }
  }
  const playerViews = new Map<EntityId, PlayerView>();
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
      // Keep a sample pickup in view for inspecting every kind, including Carpenter before barriers break.
      simulation.state.powerups.drops.push({ id: 'preview:powerup', kind: previewPowerup,
        position: { x: map.playerSpawn.x, y: map.playerSpawn.y, z: map.playerSpawn.z - 2.7 },
        ticksRemaining: 2147483647 });
      const target = createZombieState(allocateEntityId(simulation.state.world),
        { x: map.playerSpawn.x, y: 0, z: map.playerSpawn.z - 5 }, 1);
      target.moveSpeed = 0; addEntity(simulation.state.world, target);
    }
  }

  const zombieViews = new Map<EntityId, ZombieView>();
  const zombieBatch = new ActorBatch(scene);
  // `?hitboxes=1` draws the capsules shots are tested against over every zombie.
  const hitboxView = new URLSearchParams(location.search).get('hitboxes') === '1' ? new HitboxView(scene) : null;
  const previousPositions = new Map<EntityId, Vec3>();
  const skinnedViews = new Map<EntityId, SkinnedZombieView>();
  // Every zombie model there is: which one a zombie is drawn with is its look (`ZombieState.variant`), chosen when it spawned.
  const zombieAssets = new Map<string, ZombieAsset>();
  let zombieAssetNotice: string | null = 'Loading zombie model…';
  const zombieReady = Promise.all(ZOMBIE_ASSET_IDS.map(id => loadZombieAsset(id).then(asset => { zombieAssets.set(id, asset); }).catch(error => {
    console.warn(`Unable to load zombie asset ${id}`, error);
  }))).then(() => {
    if (zombieAssets.size === 0) { zombieAssetNotice = 'Zombie asset failed to load; using low-poly fallback'; return; }
    zombieAssetNotice = null;
    zombieViews.clear(); zombieBatch.update([]);
  });
  const weaponView = new WeaponView();
  const powerupView = new PowerupView(scene);
  // Explosions, fire and debris are drawn by one shared set of instanced meshes; the hazards, mines and thrown
  // grenades below are what the core says exists, and BlastEffects is what they look like when they go off.
  const blastEffects = new BlastEffects(scene, { ground: groundFromSurfaces(map.walkSurfaces), lights: lightPool });
  const hazardView = new HazardView(scene, map.hazards ?? [], blastEffects);
  const mineView = new MineView(scene);
  // Blood, flesh and thrown limbs, and what turns the simulation's events into them.
  const goreEffects = new GoreEffects(scene, { ground: groundFromSurfaces(map.walkSurfaces) });
  const goreDirector = new GoreDirector(goreEffects, skinnedViews);
  const grenadeView = new GrenadeView(scene, blastEffects);

  function zombies(): ZombieState[] {
    return simulation.zombies();
  }
  function syncZombieViews(alpha: number, tick: number, previous: ReadonlyMap<EntityId, Vec3>): void {
    if (zombieAssets.size > 0) {
      for (const [id, view] of skinnedViews) if (!simulation.state.world.entities[id]) {
        view.dispose(); skinnedViews.delete(id);
      }
      for (const entity of Object.values(simulation.state.world.entities)) {
        if (entity.kind !== 'zombie') continue;
        let view = skinnedViews.get(entity.id);
        if (!view) {
          if (!entity.alive) continue;
          // A look whose model has not loaded is drawn with one that has.
          const asset = zombieAssets.get(zombieAssetFor(entity.variant)) ?? zombieAssets.values().next().value!;
          view = new SkinnedZombieView(asset, zombieLook(entity, map.id));
          skinnedViews.set(entity.id, view); scene.add(view.root);
        }
        view.update(entity, tick, simulation.state.barriers.find(barrier => barrier.id === entity.entry?.barrierId),
          previous.get(entity.id), alpha);
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
      view.update(zombie, tick,
        simulation.state.barriers.find(barrier => barrier.id === zombie.entry?.barrierId), previous.get(zombie.id), alpha);
    }
    for (const id of zombieViews.keys()) {
      if (liveIds.has(id)) continue;
      zombieViews.delete(id);
    }
    zombieBatch.update(Array.from(zombieViews.values(), view => view.root));
  }
  /** Teammates' figures, in a co-op game. */
  function syncPlayerViews(alpha: number, tick: number, previous: ReadonlyMap<EntityId, Vec3>): void {
    for (const [id, name] of names) {
      if (id === playerId) continue;
      const player = simulation.getPlayer(id);
      let view = playerViews.get(id);
      if (!view) {
        view = new PlayerView(name, simulation.playerIds.indexOf(id));
        playerViews.set(id, view); scene.add(view.root);
      }
      if (player && !simulation.state.leftPlayers.includes(id)) view.update(player, previous.get(id), alpha, tick);
      else view.root.visible = false;
    }
  }

  const clock = new FixedStepClock({ tickRate: 60 });
  const bindings = loadBindings();
  const input = new BrowserInput({ pointerElement: canvas, lookSensitivity: 0.0022 * settings.sensitivity, previewFireKey: !!preview,
    // Looking around is slower while aiming, for a steadier, more accurate feel than hip fire.
    lookScale: () => simulation.getPlayer(playerId)?.aiming ? ADS_LOOK_SCALE : 1,
    bindings });
  const audio = new GameAudio(canvas);
  audio.setPaused(!preview);
  if (!preview) audio.startFromGesture();
  audio.setVolume(settings.volume);
  const pause = new SoloPauseController(canvas, window, document, paused => {
    if (paused) {
      input.clear();
      const player = simulation.getPlayer(playerId);
      if (player) player.grenadeWindupTicks = 0;
    }
    if (!net) { clock.reset(); previousPositions.clear(); audio.setPaused(paused); }
    hooks.onPauseChange?.(paused);
  }, !preview, () => !preview, !preview);
  const hud = new CanvasHud(renderer, map.name, bindings);
  const feedback = new HudFeedback();
  const netCleanup: Array<() => void> = [];
  if (net?.role === 'host') net.host.attach(simulation);
  if (net?.role === 'client') net.client.attach(simulation, playerId, {
    collision: () => simulation.collisionBoxes(), walkSurfaces: map.walkSurfaces, shotBlockers: map.shotBlockers,
  });
  // Development builds expose the running match for inspection from the browser console.
  if (import.meta.env.DEV) Object.assign(window, { zombonz: { simulation, playerId, net, effects: blastEffects, weaponView, camera, frame, renderer, scene, skinnedViews, present, gore: goreEffects } });
  /** The host holds the first wave until every player has loaded. */
  let hostRunning = net?.role !== 'host';
  if (net) {
    feedback.setNames(names);
    const stops = net.role === 'host'
      ? [net.host.notices.add(notice => feedback.notice(`${notice.name.toUpperCase()} ${notice.kind === 'left' ? 'LEFT THE GAME' : 'JOINED'}`,
        simulation.state.world.tick))]
      : [net.client.notices.add(notice => feedback.notice(notice.toUpperCase(), simulation.state.world.tick)),
        net.client.closed.add(reason => hooks.onDisconnected?.(reason))];
    netCleanup.push(...stops);
  }
  const performanceOverlay = new PerformanceOverlay(renderer);
  renderer.info.autoReset = false;
  let previousSeconds: number | undefined;
  let lastShadowSeconds = -Infinity;
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
    // With the menu open in a shared game, the player just stands still.
    const inputFrame = pause.paused && net ? createInputFrame(0) : input.consume();
    if (pause.paused && net) inputFrame.actions.cancelGrenade = { held: false, pressed: true, released: false, value: 0 };
    if (forceAim) inputFrame.actions.aim = { held: true, pressed: false, released: false, value: 1 };
    let events: SimulationEvent[];
    if (net?.role === 'client') events = net.client.step(inputFrame);
    else {
      const mate = previewMate && previewTeammate === 'run' ? createInputFrame(0) : null;
      if (mate) mate.actions.moveForward = { held: true, pressed: false, released: false, value: 1 };
      const matePosition = mate ? { ...previewMate!.position } : null;
      events = simulation.tick({ ...(net?.role === 'host' ? net.host.inputs() : {}), ...(mate ? { [previewMate!.id]: mate } : {}),
        [playerId]: inputFrame }, dt);
      // The running preview teammate runs on the spot, to show the run cycle.
      if (matePosition) previewMate!.position = matePosition;
      if (net?.role === 'host') net.host.publish(events);
    }
    present(events);
    if (simulation.state.world !== world) resetMatchViews();
  }
  function present(events: readonly SimulationEvent[]): void {
    if (!events.length) return;
    weaponView.events(events as SimulationEvent[], playerId, simulation.state.world.tick);
    grenadeView.events(events as SimulationEvent[], simulation.state.world.tick);
    feedback.consume(events, playerId, simulation.state.world.tick);
    hud.events(events as SimulationEvent[], playerId);
    audio.consume(events as SimulationEvent[], playerId, simulation.state.world);
    goreDirector.consume(events, simulation.state.world);
  }
  function resetMatchViews(): void {
    hazardView.reset(); mineView.clear(); blastEffects.clear(); goreEffects.clear();
    previousPositions.clear();
    for (const view of skinnedViews.values()) view.dispose();
    skinnedViews.clear(); zombieViews.clear(); zombieBatch.update([]);
  }
  function syncCamera(alpha = 1): void {
    const player = simulation.getPlayer(playerId);
    if (!player) return;
    const position = interpolatePosition(previousPositions.get(playerId), player.position, alpha);
    // In last stand the view drops to the floor and lists to one side.
    // A client's view eases out of any correction from the host rather than jumping.
    const correction = net?.role === 'client' ? net.client.correction : { x: 0, y: 0, z: 0 };
    camera.position.set(position.x + correction.x,
      position.y + correction.y + (player.downed ? DOWN_RULES.eyeHeight : playerEyeHeight(player)), position.z + correction.z);
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
    // Teammates carry real guns too.
    for (const id of names.keys()) { const weapon = simulation.getPlayer(id)?.weapon.weaponId; if (weapon) prepareWeaponModel(weapon); }
  }

  let lastFrameSeconds: number | undefined;
  function frame(): void {
    if (disposed) return;
    const started = performance.now();
    const profiling = performanceOverlay.enabled;
    if (++lastWarmFrame % 20 === 0) warmUpcomingWeapons();
    // One time base for animation frames and the background timer, so neither can step the clock back.
    const nowSeconds = started / 1000;
    const interval = lastFrameSeconds === undefined ? 0 : (nowSeconds - lastFrameSeconds) * 1000;
    lastFrameSeconds = nowSeconds;
    const tickBefore = simulation.state.world.tick;
    const simulationStarted = profiling ? performance.now() : 0;
    advance(nowSeconds);
    const simulationEnded = profiling ? performance.now() : 0;
    const alpha = clock.interpolationAlpha();
    // A client draws everything but itself from the host's snapshots, slightly in the past.
    const netFrame = net?.role === 'client' ? net.client.frame(interval / 1000) : null;
    if (netFrame?.restarted) { resetMatchViews(); for (const view of playerViews.values()) view.root.visible = false; }
    if (netFrame) present(netFrame.events);
    const networkEnded = profiling ? performance.now() : 0;
    const remote = netFrame ?? { alpha, tick: simulation.state.world.tick - 1 + alpha, previous: previousPositions };
    syncCamera(alpha);
    const playerForCamera = simulation.getPlayer(playerId);
    // Aiming zooms the player's chosen field of view in (more for a rifle than a pistol); sprinting widens it a little.
    const targetFov = playerForCamera?.aiming ? aimedFov(settings.fov, playerForCamera.weapon.weaponId)
      : playerForCamera?.sprinting ? settings.fov + 4 : settings.fov;
    const fovBlend = 1 - Math.exp(-12 * Math.min(0.1, Math.max(0, interval / 1000)));
    const nextFov = camera.fov + (targetFov - camera.fov) * fovBlend;
    if (Math.abs(nextFov - camera.fov) > 0.001) { camera.fov = nextFov; camera.updateProjectionMatrix(); }
    syncZombieViews(remote.alpha, remote.tick, remote.previous);
    hitboxView?.update(simulation.zombies());
    syncPlayerViews(remote.alpha, remote.tick, remote.previous);
    powerupView.update(simulation.state.powerups.drops, remote.tick);
    grenadeView.update(simulation.state.grenades.active, remote.tick, interval / 1000);
    mineView.update(simulation.state.grenades.mines, nowSeconds);
    hazardView.update(simulation.state.hazards);
    blastEffects.update(interval / 1000, camera);
    goreEffects.update(interval / 1000, camera, renderer.domElement.height);
    // A blast near enough shakes the view, dying away over a second or so.
    const shake = blastEffects.shake();
    camera.rotation.x += shake.x; camera.rotation.y += shake.y; camera.rotation.z += shake.z;

    const actorsEnded = profiling ? performance.now() : 0;
    if (details.update(simulation.state)) shadowsDirty = true;
    lightPool.update(camera, interval / 1000);
    const detailsEnded = profiling ? performance.now() : 0;
    performanceOverlay.beginGpu();
    renderer.clear();
    renderer.info.reset();
    // The moon's shadows are the building's (actors cast none), so the shadow map is only redrawn when
    // a door, board, the box or the lever moves, or scenery finishes loading: at most 15 times a
    // second while something is moving (by the clock, so it still happens while paused or loading),
    // and not at all otherwise.
    const shadowFrame = shadowsDirty && nowSeconds - lastShadowSeconds >= 1 / 15;
    if (shadowFrame) { renderer.shadowMap.needsUpdate = true; lastShadowSeconds = nowSeconds; shadowsDirty = false; }
    renderer.render(scene, camera);
    const sceneEnded = profiling ? performance.now() : 0;
    const player = simulation.getPlayer(playerId);
    if (player) { weaponView.update(player, simulation.state.world.tick - 1 + alpha, interval / 1000); weaponView.render(renderer, camera.aspect); }
    const weaponEnded = profiling ? performance.now() : 0;
    const hudSnapshot = buildHudSnapshot(simulation, playerId, net ? names : undefined);
    const waiting = !hostRunning ? 'Waiting for everyone to load…' : null;
    if (hudSnapshot) hud.render({ ...hudSnapshot, paused: pause.paused && !net,
      pingMs: net?.role === 'client' && net.client.pingMs !== null ? Math.round(net.client.pingMs / 10) * 10 : null,
      canRestart: net?.role !== 'client',
      feedback: feedback.snapshot(simulation.state.world.tick),
      assetNotice: waiting ?? zombieAssetNotice ?? weaponView.notice ?? environmentNotice }, performance.now(),
      player ? { spread: currentSpread(player), verticalFov: camera.fov } : undefined);
    performanceOverlay.endGpu();
    const hudEnded = profiling ? performance.now() : 0;
    const calls = profiling ? renderer.info.render.calls : 0;
    const triangles = profiling ? renderer.info.render.triangles : 0;
    performanceOverlay.render(renderer);
    if (profiling) performanceOverlay.sample({
      intervalMs: interval, cpuMs: performance.now() - started,
      simulationMs: simulationEnded - simulationStarted,
      networkMs: networkEnded - simulationEnded,
      actorsMs: actorsEnded - networkEnded,
      detailsMs: detailsEnded - actorsEnded,
      sceneMs: sceneEnded - detailsEnded,
      weaponMs: weaponEnded - sceneEnded,
      hudMs: hudEnded - weaponEnded,
      overlayMs: performance.now() - hudEnded,
      shadowFrame, ticks: simulation.state.world.tick - tickBefore,
      calls, triangles, rigs: skinnedViews.size + playerViews.size,
      scale: renderer.getPixelRatio(),
    });
    frameId = requestAnimationFrame(frame);
  }

  /** Runs the fixed-step clock up to now (unless a solo game is paused, or the host is still waiting). */
  function advance(nowSeconds: number): void {
    if (previousSeconds === undefined) previousSeconds = nowSeconds;
    if (!hostRunning && net?.role === 'host' && net.host.everyoneReady()) hostRunning = true;
    const elapsed = Math.max(0, nowSeconds - previousSeconds);
    if ((pause.paused && !net) || !hostRunning) { input.clear(); clock.reset(); }
    else clock.advance(elapsed, simulate);
    previousSeconds = Math.max(previousSeconds, nowSeconds);
  }
  // A background tab gets no animation frames. A shared game must keep running there, so a worker's
  // timer (which browsers throttle far less) drives the clock while the page is hidden.
  let pump: Worker | null = null;
  if (net && typeof Worker !== 'undefined') {
    pump = new Worker(URL.createObjectURL(new Blob(['setInterval(() => postMessage(0), 1000 / 60);'], { type: 'text/javascript' })));
    pump.onmessage = () => { if (document.hidden && !disposed) advance(performance.now() / 1000); };
  }

  addEventListener('resize', resize);
  resize();
  syncCamera();
  frameId = requestAnimationFrame(frame);

  const startingWeapon = simulation.getPlayer(playerId)?.weapon.weaponId ?? 'starter-pistol';
  const ready = (async () => {
    await Promise.allSettled([environmentReady, zombieReady, details.ready, prepareWeaponModel(startingWeapon), hazardView.ready]);
    shadowsDirty = true; // the wall guns and perk machines are in place now
    // Upload every texture and compile every shader now, rather than stuttering on the first frames. A grenade and a
    // mine sit far below the map for the moment, so their shaders are ready before the first one is thrown.
    const spares = new THREE.Group(); spares.position.y = -200;
    spares.add(createGrenadeModel().root, createMineModel().root); scene.add(spares);
    await renderer.compileAsync(scene, camera);
    spares.removeFromParent();
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
      if (net?.role === 'client') net.client.ready();
      pause.resume();
      if (pause.paused) hooks.onPauseChange?.(true);
    },
    resume: () => pause.resume(),
    restart: () => {
      if (net?.role === 'client') return; // Only the host restarts a shared game.
      const event = simulation.restart();
      if (net?.role === 'host') net.host.publish([event]);
      input.clear(); clock.reset(); previousPositions.clear(); previousSeconds = undefined; shadowsDirty = true;
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
    updateBindings: next => { input.setBindings(next); hud.setBindings(next); },
    dispose: () => {
      if (disposed) return;
      disposed = true;
      cancelAnimationFrame(frameId);
      removeEventListener('resize', resize);
      pump?.terminate();
      for (const stop of netCleanup) stop();
      if (net?.role === 'host') net.host.close();
      if (net?.role === 'client') net.client.leave();
      for (const view of playerViews.values()) view.dispose();
      pause.dispose(); input.dispose(); audio.dispose(); hud.dispose(); blastEffects.clear(); goreEffects.dispose();
      performanceOverlay.dispose(); powerupView.dispose(); zombieBatch.dispose();
      for (const view of skinnedViews.values()) view.dispose();
      skinnedViews.clear(); zombieViews.clear();
      renderer.dispose();
    },
  };
}
