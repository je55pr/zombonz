import type { EntityId, PlayerState, Vec3, WorldState, ZombieState } from '../core/types.ts';
import type { SimulationEvent } from '../core/simulation.ts';
import { weaponDefinition } from '../core/weapon.ts';
import { baseWeaponId, isUpgradedWeapon } from '../core/upgrades.ts';
import { AUDIO_CLIPS, decodeAudioClips, decodedAudioClip, type AudioClip } from './audioClips.ts';
import { SpatialAudioManager, type AudioBus } from './audioManager.ts';

export { softCeilingCurve } from './audioManager.ts';

type Clip = AudioClip;

/** Each gun plays its own family's close-up recording (see scripts/prepare_audio.py). */
const GUN_CLIPS: Readonly<Record<string, Clip>> = {
  'starter-pistol': 'gun-pistol', kar98k: 'gun-kar98k', springfield: 'gun-springfield', mosin: 'gun-mosin',
  // The Garand, BAR and FG42 fire .30-06 or similar full-power rounds; the MG42 shares their crack.
  'm1-garand': 'gun-30-06', bar: 'gun-30-06', fg42: 'gun-30-06', mg42: 'gun-30-06',
  'm1-carbine': 'gun-carbine', m14: 'gun-battle-rifle', fal: 'gun-battle-rifle',
  stg44: 'gun-ak', ak74u: 'gun-ak', rpk: 'gun-ak', commando: 'gun-commando',
  thompson: 'gun-smg-45', mp40: 'gun-smg-45', ppsh41: 'gun-ppsh', mp5k: 'gun-mp5k', skorpion: 'gun-skorpion',
  'trench-gun': 'gun-pump', ithaca37: 'gun-pump', spas12: 'gun-spas', 'double-barrel': 'gun-double',
  'magnum-357': 'gun-revolver', python: 'gun-revolver', irrlicht: 'irrlicht-fire', molniya: 'molniya-fire',
};
export function gunClip(weaponId: string): { clip: Clip; rate: number } {
  const gun = baseWeaponId(weaponId);
  // The launcher's thump is the double-barrel's report pitched well down.
  if (gun === 'rpg7') return { clip: 'gun-double', rate: isUpgradedWeapon(weaponId) ? 0.58 : 0.62 };
  // A Pack-a-Punched gun sounds like its base gun, a little heavier.
  return { clip: GUN_CLIPS[gun] ?? 'gun-pistol', rate: isUpgradedWeapon(weaponId) ? 0.94 : 1 };
}
/** One of a numbered set of variations, so repeated sounds don't machine-gun the same take. */
function variant(prefix: string, count: number, seed: number): Clip {
  return (prefix + '-' + (1 + Math.abs(Math.floor(seed)) % count)) as Clip;
}

/**
 * The recordings differ by over 20 dB (a board-breaking impact peaks far louder than the pistol), so
 * every one-shot clip is normalised on load: its loudest 50 ms is brought to this level. The volumes
 * passed to playClip are then the mix itself, with the player's own gunfire the loudest thing.
 */
const NORMALISED_PEAK_DB = -12;
/** Normalisation never boosts a quiet clip by more than this, or cuts a loud one by more. */
const MAX_TRIM_DB = 12;
/**
 * Master gain at full volume. Normalised clips peak near full scale, so at the default 80% volume the
 * player's gunshots peak a little under 0 dBFS; a soft ceiling after it catches overlaps. (The old 0.2 was
 * set for quiet synthesised tones and left recorded gunfire around 16 dB too quiet.)
 */
const MASTER_LEVEL = 0.7;

/** One-shot mix levels; everything else sits below the player's own gunfire. */
const MIX = {
  gunfire: 1.4, explosion: 1, electric: 0.8, reload: 0.4, reloadDone: 0.35, knife: 0.5, hit: 0.35, headshot: 0.5,
  hurt: 0.6, footstep: 0.28, sprintStep: 0.34, zombieVoice: 0.6, zombieStep: 0.3, zombieDeath: 0.55,
  boardBreak: 0.55, boardRepair: 0.4, door: 0.6, box: 0.4, pickup: 0.5, reject: 0.35, roundStart: 0.8,
  zombieAttack: 0.55, sting: 0.22, clink: 0.32, ping: 0.5, mine: 0.4,
} as const;
/** How quickly a blast fades with distance (see playAt): big ones carry much further than a footstep. */
const BLAST_ROLLOFF = { grenade: 0.16, mine: 0.16, barrel: 0.1, vehicle: 0.07 } as const;
/** Events with a place in the world: everyone hears them, whoever caused them, from where they happened. */
const WORLD_EVENTS: ReadonlySet<string> = new Set(['grenadeThrown', 'grenadeBounced', 'grenadeExploded', 'weaponExploded',
  'minePlaced', 'mineArmed', 'mineTriggered', 'mineExploded', 'hazardHit', 'hazardIgnited', 'hazardExploded', 'zombieSwung']);

/** The level (dBFS) of a buffer's loudest 50 ms window, for normalisation. */
export function loudestWindowDb(samples: Float32Array, sampleRate: number): number {
  const window = Math.max(1, Math.floor(sampleRate * 0.05));
  let sum = 0, best = 0;
  for (let i = 0; i < samples.length; i++) {
    sum += samples[i] * samples[i];
    if (i >= window) sum -= samples[i - window] * samples[i - window];
    if (i >= window - 1 || i === samples.length - 1) best = Math.max(best, sum / Math.min(window, i + 1));
  }
  return best > 0 ? 10 * Math.log10(best) : -Infinity;
}

/** Linear gain that brings a clip's loudest window to the normalised level, within the trim limit. */
export function normalisingGain(loudestDb: number): number {
  if (!Number.isFinite(loudestDb)) return 1;
  const trim = Math.max(-MAX_TRIM_DB, Math.min(MAX_TRIM_DB, NORMALISED_PEAK_DB - loudestDb));
  return 10 ** (trim / 20);
}

/** Recorded CC0 audio cues. Audio is presentation only and starts on user input. */
export class GameAudio {
  private readonly manager: SpatialAudioManager;
  private readonly clips = new Map<Clip, AudioBuffer>();
  private readonly trims = new Map<Clip, number>();
  private lastStepTick = -100;
  private lastZombieVoiceTick = -100;
  private lastZombieStepTick = -100;
  private nextStingTick = 60 * 50;
  private stepCount = 0;
  private muted = false;
  private paused = false;

  private readonly onKeyDown = (event: KeyboardEvent) => {
    if (event.code === 'KeyM' && !event.repeat) {
      this.muted = !this.muted;
      this.manager.setMuted(this.muted);
    }
  };

  constructor(surface: HTMLElement) {
    this.manager = new SpatialAudioManager(surface, context => { void this.loadClips(context); }, MASTER_LEVEL);
    window.addEventListener('keydown', this.onKeyDown);
  }

  /** Call within the level-selection gesture so the first round has audio immediately. */
  startFromGesture(): void { this.manager.unlockFromGesture(); }

  /** The start screen has usually decoded every clip already; otherwise (dev previews) decode them now. */
  private async loadClips(context: AudioContext): Promise<void> {
    await decodeAudioClips(context);
    if (this.manager.context !== context) return;
    for (const clip of AUDIO_CLIPS) {
      const buffer = decodedAudioClip(clip);
      if (!buffer) continue;
      this.clips.set(clip, buffer);
      try {
        // Ambience loops keep their authored bed levels; only one-shots are normalised.
        if (clip === 'vent-loop' || clip === 'wind-loop') this.loopClip(clip);
        else this.trims.set(clip, normalisingGain(loudestWindowDb(buffer.getChannelData(0), buffer.sampleRate)));
      } catch { /* A clip that can't be measured plays at its recorded level. */ }
    }
  }

  private loopClip(clip: Clip): void {
    const buffer = this.clips.get(clip);
    if (!buffer) return;
    this.manager.playLoop(clip, buffer, 'music', clip === 'wind-loop' ? 0.07 : 0.045);
  }

  private playClip(clip: Clip, volume: number, pan = 0, rate = 1, bus: AudioBus = 'sfx'): boolean {
    const buffer = this.clips.get(clip);
    if (!buffer || this.muted || this.paused) return false;
    const maxInstances = clip.startsWith('gun-') ? 6 : clip.startsWith('zombie-') ? 3 : 8;
    return this.manager.play(clip, buffer, {
      bus,
      volume: volume * (this.trims.get(clip) ?? 1),
      pan,
      rate,
      maxInstances,
    });
  }

  private playAt(clip: Clip, volume: number, point: Vec3 | undefined, player: PlayerState | undefined, rate = 1,
    rolloff = 0.24): boolean {
    const buffer = this.clips.get(clip);
    if (!buffer || !point || !player || this.muted || this.paused) return false;
    const maxInstances = clip.startsWith('gun-') ? 6 : clip.startsWith('zombie-') ? 3 : 8;
    return this.manager.playSpatial(clip, buffer, point, { position: player.position, yaw: player.yaw }, {
      bus: 'sfx',
      volume: volume * (this.trims.get(clip) ?? 1),
      rate,
      rolloff,
      maxInstances,
    });
  }

  /**
   * An explosion, from where it happened. There is one small and one large recorded bang for now; the clips
   * wanted for each kind of blast are listed in docs/audio-wanted.md.
   */
  private boom(clip: 'explosion-small' | 'explosion-large', rate: number, rolloff: number, point: Vec3 | undefined,
    player: PlayerState | undefined, level = 1): void {
    this.playAt(clip, MIX.explosion * level, point, player, rate, rolloff);
  }

  setPaused(paused: boolean): void {
    this.paused = paused;
    this.manager.setPaused(paused);
  }

  /** 0 to 1 master volume from the settings menu. */
  setVolume(volume: number): void { this.manager.setMasterVolume(volume); }

  /** Presentation bus controls for the future settings UI; these never enter deterministic game state. */
  setBusVolume(bus: AudioBus, volume: number): void { this.manager.setBusVolume(bus, volume); }

  consume(events: readonly SimulationEvent[], playerId: EntityId, world: WorldState): void {
    if (!this.manager.context || this.muted || this.paused) return;
    const playerEntity = world.entities[playerId];
    const player = playerEntity?.kind === 'player' ? playerEntity : undefined;
    if (player?.alive && !player.noclip && Math.hypot(player.velocity.x, player.velocity.z) > 0.2) {
      const interval = player.sprinting ? 17 : 25;
      if (world.tick - this.lastStepTick >= interval) {
        this.lastStepTick = world.tick;
        this.playClip(variant('step-stone', 4, this.stepCount++), player.sprinting ? MIX.sprintStep : MIX.footstep);
      }
    }
    if (player && world.tick - this.lastZombieVoiceTick >= 150) {
      const nearby = Object.values(world.entities).filter(entity => entity.kind === 'zombie' && entity.alive)
        .sort((a, b) => Math.hypot(a.position.x - player.position.x, a.position.z - player.position.z)
          - Math.hypot(b.position.x - player.position.x, b.position.z - player.position.z));
      const zombie = nearby[0];
      if (zombie) {
        this.lastZombieVoiceTick = world.tick;
        this.playAt(variant('zombie-voice', 8, world.tick / 150 + Number(zombie.id.slice(2))), MIX.zombieVoice, zombie.position, player);
      }
    }
    if (player && world.tick - this.lastZombieStepTick >= 31) {
      const zombie = Object.values(world.entities).find((entity): entity is ZombieState => entity.kind === 'zombie' && entity.alive
        && Math.hypot(entity.velocity.x, entity.velocity.z) > 0.25
        && Math.hypot(entity.position.x - player.position.x, entity.position.z - player.position.z) < 8);
      if (zombie) {
        this.lastZombieStepTick = world.tick;
        const dirt = zombie.entry?.phase === 'approach';
        this.playAt(variant(dirt ? 'step-dirt' : 'step-stone', 4, world.tick / 31), MIX.zombieStep, zombie.position, player);
      }
    }
    // Now and then something unseen shifts in the dark between the moans.
    if (world.tick >= this.nextStingTick) {
      this.nextStingTick = world.tick + 60 * (45 + (world.tick * 7919) % 45);
      this.playClip(variant('ambience-sting', 2, world.tick), MIX.sting, ((world.tick * 104729) % 200) / 100 - 1, 1, 'music');
    }
    for (const event of events) {
      if ('playerId' in event && event.playerId !== playerId && event.type === 'weaponFired') {
        // A teammate's shot, from where they stand.
        const shooter = world.entities[event.playerId];
        if (shooter) this.playAt(gunClip(event.weaponId).clip, MIX.gunfire * 0.8, shooter.position, player);
        continue;
      }
      if ('playerId' in event && event.playerId !== playerId && event.type !== 'powerupCollected'
        && event.type !== 'powerActivated' && !WORLD_EVENTS.has(event.type)) continue;
      switch (event.type) {
        case 'weaponFired': { const { clip, rate } = gunClip(event.weaponId); this.playClip(clip, MIX.gunfire, 0, rate); break; }
        case 'weaponHit': this.playClip('flesh-hit', event.hitZone === 'head' ? MIX.headshot : MIX.hit); break;
        case 'zombieDied':
          if (event.method === 'trap') this.playAt('electric-hit', MIX.electric, world.entities[event.zombieId]?.position, player);
          this.playAt(variant('zombie-death', 2, Number(event.zombieId.slice(2))), MIX.zombieDeath,
            world.entities[event.zombieId]?.position, player); break;
        case 'powerActivated': this.playClip('electric-boom', MIX.explosion * 0.8); this.playClip('electric-powerup', MIX.electric); break;
        case 'perkBought': this.playClip('pickup', MIX.pickup, 0, 1, 'ui'); this.playClip('electric-powerup', MIX.electric * 0.4); break;
        case 'playerRevived': this.playClip('pickup', MIX.pickup); break;
        case 'playerDowned': this.playClip('ambience-sting-2', MIX.sting * 3); this.playClip('flesh-hit', MIX.hurt); break;
        case 'playerRespawned': this.playClip('mechanical-click', MIX.reloadDone); break;
        case 'trapActivated': this.playClip('electric-powerup', MIX.electric); this.playClip('electric-hit', MIX.electric * 0.7); break;
        case 'mysteryBoxTeddy': this.playClip('ambience-sting-1', MIX.sting * 3); break;
        case 'meleeSwung': this.playClip('knife', MIX.knife); break;
        // The blow lands a moment after the swish, so it gets its own thud.
        case 'meleeHit': this.playAt('flesh-hit', MIX.hurt, world.entities[event.zombieId]?.position, player); break;
        // A zombie grunts as it winds up, from where it stands: the warning that a blow is coming; the hit itself is a thud.
        case 'zombieSwung': this.playAt(variant('zombie-attack', 3, world.tick + Number(event.zombieId.slice(2))), MIX.zombieAttack,
          world.entities[event.zombieId]?.position, player); break;
        case 'playerDamaged': this.playClip('flesh-hit', MIX.hurt); break;
        case 'weaponReloadStarted': this.playClip(weaponDefinition(event.weaponId)?.pellets ? 'shotgun-shell'
          : ['kar98k', 'springfield', 'mosin'].includes(baseWeaponId(event.weaponId)) ? 'reload-round' : 'reload-mag', MIX.reload); break;
        case 'weaponReloadCompleted':
          if (weaponDefinition(event.weaponId)?.pellets) this.playClip('shotgun-rack', MIX.reloadDone);
          break;
        case 'pointsSpendRejected': this.playClip('buy-denied', MIX.reject, 0, 1, 'ui'); break;
        case 'mysteryBoxUsed': this.playClip('mechanical-button', MIX.box, 0, 1, 'ui'); break;
        case 'mysteryBoxClaimed': this.playClip('pickup', MIX.pickup, 0, 1, 'ui'); break;
        case 'doorOpened': this.playClip('door-unlock', MIX.door); this.playClip('door-open', MIX.door * 0.8); break;
        case 'powerupCollected': this.playClip('electric-powerup', MIX.electric * 0.6); this.playClip('pickup', MIX.pickup * 0.6); break;
        case 'carpenterRepaired':
          // Boards hammered back up.
          this.playClip('wood-impact-1', MIX.boardRepair); this.playClip('wood-impact-2', MIX.boardRepair, 0, 0.9); break;
        case 'nukeDetonated': this.playClip('explosion-large', MIX.explosion, 0, 0.75); break;
        // Stand-ins from the recorded clips until the ones in docs/audio-wanted.md exist: metal for a pin, a bounce and a
        // bullet on a drum or a car, a dull clunk for a mine springing, and the two recorded bangs for every blast.
        case 'grenadeThrown': this.playAt('door-metal', MIX.reload * 0.5, world.entities[event.playerId]?.position, player, 1.4, 0.4); break;
        case 'grenadeBounced':
          this.playAt('door-metal', MIX.clink * Math.min(1, event.speed / 6), event.position, player, 1.8 + (world.tick % 5) * 0.08, 0.3);
          break;
        case 'weaponExploded':
          if (event.weaponId === 'irrlicht') this.playAt('electric-boom', MIX.explosion, event.position, player);
          else this.boom('explosion-small', 0.8, BLAST_ROLLOFF.grenade, event.position, player, 1.1);
          break;
        case 'weaponChained': this.playClip('electric-hit', MIX.electric); break;
        case 'grenadeExploded': this.boom('explosion-small', 1, BLAST_ROLLOFF.grenade, event.position, player); break;
        case 'mineExploded': this.boom('explosion-small', 1.05, BLAST_ROLLOFF.mine, event.position, player); break;
        case 'minePlaced':
          this.playAt('mechanical-button', MIX.mine, event.position, player, 0.8);
          this.playAt('mechanical-click', MIX.mine * 0.8, event.position, player, 0.7);
          break;
        case 'mineArmed': this.playAt('mechanical-click', MIX.mine * 0.6, event.position, player, 1.5, 0.4); break;
        case 'mineTriggered': this.playAt('mechanical-button', MIX.mine * 1.4, event.position, player, 0.6, 0.16); break;
        case 'hazardHit':
          this.playAt('door-metal', MIX.ping, event.position, player, (event.kind === 'barrel' ? 0.78 : 0.56) + ((world.tick * 7) % 5) * 0.03, 0.14);
          break;
        case 'hazardExploded':
          if (event.kind === 'barrel') this.boom('explosion-large', 1, BLAST_ROLLOFF.barrel, event.position, player);
          else this.boom('explosion-large', 0.8, BLAST_ROLLOFF.vehicle, event.position, player, 1.2);
          break;
        case 'equipmentPurchased': this.playClip('pickup', MIX.pickup, 0, 1, 'ui'); this.playClip('mechanical-click', MIX.reloadDone, 0, 0.8); break;
        case 'equipmentFull': this.playClip('buy-denied', MIX.reject, 0, 1, 'ui'); break;
        // Stand-ins from the recorded clips until the ones in docs/audio-wanted.md exist: a clank and a hum as the gun goes in,
        // the electric surge when it is ready, and the pickup when it is taken.
        case 'packAPunchStarted':
          this.playClip('door-metal', MIX.reload * 0.7, 0, 0.5); this.playClip('mechanical-button', MIX.box, 0, 0.7);
          this.playClip('electric-powerup', MIX.electric * 0.8, 0, 0.8); break;
        case 'packAPunchReady': this.playClip('electric-powerup', MIX.electric); this.playClip('pickup', MIX.pickup * 0.8, 0, 1.2); break;
        case 'packAPunchCollected': this.playClip('pickup', MIX.pickup, 0, 1, 'ui'); this.playClip('mechanical-click', MIX.reloadDone, 0, 0.8); break;
        case 'packAPunchRefused': this.playClip('buy-denied', MIX.reject, 0, 1, 'ui'); break;
        // Boards break where the zombie tearing them stands, so a far window is faint and panned.
        case 'barrierBoardRemoved': this.playAt(event.boards === 0 ? variant('wood-impact', 2, world.tick) : variant('wood-crack', 4, world.tick + event.boards),
          MIX.boardBreak, world.entities[event.zombieId]?.position, player); break;
        case 'barrierBoardRepaired': this.playClip(variant('wood-impact', 2, event.boards), MIX.boardRepair); break;
        // A low bell strike as each round begins; it takes one of three, by round, so a long run doesn't hear the same one each time.
        case 'roundPhaseChanged': if (event.to === 'spawning') this.playClip(variant('round-start', 3, event.round), MIX.roundStart, 0, 1, 'music'); break;
        case 'matchRestarted': this.lastStepTick = -100; this.lastZombieVoiceTick = -100; this.nextStingTick = 60 * 50;
          this.lastZombieStepTick = -100; break;
      }
    }
  }

  dispose(): void {
    window.removeEventListener('keydown', this.onKeyDown);
    this.manager.dispose();
  }
}
