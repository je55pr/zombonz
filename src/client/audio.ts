import type { EntityId, PlayerState, Vec3, WorldState, ZombieState } from '../core/types.ts';
import type { SimulationEvent } from '../core/simulation.ts';
import { WEAPON_DEFINITIONS } from '../core/weapon.ts';
import { AUDIO_CLIPS, decodeAudioClips, decodedAudioClip, type AudioClip } from './audioClips.ts';

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
  // The launcher's thump is the double-barrel's report pitched well down.
  if (weaponId === 'rpg7') return { clip: 'gun-double', rate: 0.62 };
  return { clip: GUN_CLIPS[weaponId] ?? 'gun-pistol', rate: 1 };
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

/**
 * A soft ceiling for the output: unchanged up to 70% of full scale, then rounded off so overlapping
 * shots and explosions never exceed about -0.6 dBFS. (A WaveShaper rather than Chrome's
 * DynamicsCompressorNode, which cut even quiet gunfire by about 15 dB when measured.)
 */
export function softCeilingCurve(points = 4097): Float32Array {
  const curve = new Float32Array(points);
  for (let i = 0; i < points; i++) {
    const x = i / (points - 1) * 2 - 1, size = Math.abs(x);
    curve[i] = size <= 0.7 ? x : Math.sign(x) * (0.7 + 0.3 * Math.tanh((size - 0.7) / 0.3));
  }
  return curve;
}
/** One-shot mix levels; everything else sits below the player's own gunfire. */
const MIX = {
  gunfire: 1.4, explosion: 1, electric: 0.8, reload: 0.4, reloadDone: 0.35, knife: 0.5, hit: 0.35, headshot: 0.5,
  hurt: 0.6, footstep: 0.28, sprintStep: 0.34, zombieVoice: 0.6, zombieStep: 0.3, zombieDeath: 0.55,
  boardBreak: 0.55, boardRepair: 0.4, door: 0.6, box: 0.4, pickup: 0.5, reject: 0.35, roundStart: 0.5,
  zombieAttack: 0.55, sting: 0.22, clink: 0.32, ping: 0.5, mine: 0.4,
} as const;
/** How quickly a blast fades with distance (see playAt): big ones carry much further than a footstep. */
const BLAST_ROLLOFF = { grenade: 0.16, mine: 0.16, barrel: 0.1, vehicle: 0.07 } as const;
/** Events with a place in the world: everyone hears them, whoever caused them, from where they happened. */
const WORLD_EVENTS: ReadonlySet<string> = new Set(['grenadeThrown', 'grenadeBounced', 'grenadeExploded', 'weaponExploded',
  'minePlaced', 'mineArmed', 'mineTriggered', 'mineExploded', 'hazardHit', 'hazardIgnited', 'hazardExploded', 'zombieSwung']);
/** Positional sounds fade with distance and are culled past this (the map is about 35 m across). */
const HEARING_RANGE = 36;

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
  private context: AudioContext | null = null;
  private output: GainNode | null = null;
  private readonly clips = new Map<Clip, AudioBuffer>();
  private readonly trims = new Map<Clip, number>();
  private readonly activeClips = new Map<Clip, number>();
  private lastStepTick = -100;
  private lastZombieVoiceTick = -100;
  private lastZombieStepTick = -100;
  private nextStingTick = 60 * 50;
  private stepCount = 0;
  private muted = false;
  /** Output gain when audible: the master level scaled by the player's volume setting. */
  private level = MASTER_LEVEL;
  private paused = false;
  private readonly unlock = () => this.start();
  private readonly onKeyDown = (event: KeyboardEvent) => {
    if (event.code === 'KeyM' && !event.repeat) {
      this.muted = !this.muted;
      if (this.output && this.context) this.output.gain.setTargetAtTime(this.muted || this.paused ? 0 : this.level,
        this.context.currentTime, 0.015);
    }
  };

  constructor(private readonly surface: HTMLElement) {
    surface.addEventListener('pointerdown', this.unlock);
    window.addEventListener('keydown', this.unlock);
    window.addEventListener('keydown', this.onKeyDown);
  }

  /** Call within the level-selection gesture so the first round has audio immediately. */
  startFromGesture(): void { this.start(); }

  private start(): void {
    if (!this.context) {
      try {
        this.context = new AudioContext({ latencyHint: 'interactive' });
        this.output = this.context.createGain();
        this.output.gain.value = this.muted || this.paused ? 0 : this.level;
        // The soft ceiling keeps automatic fire, explosions and a crowd of zombies from clipping.
        const ceiling = this.context.createWaveShaper?.();
        if (ceiling) {
          ceiling.curve = softCeilingCurve() as Float32Array<ArrayBuffer>;
          this.output.connect(ceiling); ceiling.connect(this.context.destination);
        } else this.output.connect(this.context.destination);
        void this.loadClips();
      } catch { return; }
    }
    if (this.context.state === 'suspended') void this.context.resume().catch(() => {});
  }

  /** The start screen has usually decoded every clip already; otherwise (dev previews) decode them now. */
  private async loadClips(): Promise<void> {
    const context = this.context;
    if (!context) return;
    await decodeAudioClips(context);
    if (this.context !== context) return;
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
    const context = this.context, output = this.output, buffer = this.clips.get(clip);
    if (!context || !output || !buffer) return;
    const source = context.createBufferSource(), gain = context.createGain();
    source.buffer = buffer; source.loop = true;
    gain.gain.value = clip === 'wind-loop' ? 0.07 : 0.045;
    source.connect(gain); gain.connect(output); source.start();
    if (clip === 'wind-loop') this.sampleWind = source;
    else this.sampleVent = source;
  }

  private sampleWind: AudioBufferSourceNode | null = null;
  private sampleVent: AudioBufferSourceNode | null = null;

  private playClip(clip: Clip, volume: number, pan = 0, rate = 1): boolean {
    const context = this.context, output = this.output, buffer = this.clips.get(clip);
    if (!context || !output || !buffer || this.muted || this.paused || context.state !== 'running') return false;
    const active = this.activeClips.get(clip) ?? 0;
    // Dense automatic fire and a Nuke should not spawn dozens of overlapping decoders.
    if (active >= (clip.startsWith('gun-') ? 6 : clip.startsWith('zombie-') ? 3 : 8)) return true;
    this.activeClips.set(clip, active + 1);
    const source = context.createBufferSource(), gain = context.createGain(), stereo = context.createStereoPanner();
    source.buffer = buffer;
    source.playbackRate.value = rate;
    gain.gain.value = volume * (this.trims.get(clip) ?? 1);
    stereo.pan.value = Math.max(-1, Math.min(1, pan));
    source.connect(gain); gain.connect(stereo); stereo.connect(output);
    source.start();
    source.onended = () => {
      this.activeClips.set(clip, Math.max(0, (this.activeClips.get(clip) ?? 1) - 1));
      source.disconnect(); gain.disconnect(); stereo.disconnect();
    };
    return true;
  }

  private playAt(clip: Clip, volume: number, point: Vec3 | undefined, player: PlayerState | undefined, rate = 1,
    rolloff = 0.24): boolean {
    if (!point || !player) return false;
    const dx = point.x - player.position.x, dz = point.z - player.position.z;
    const distance = Math.hypot(dx, dz);
    if (distance > HEARING_RANGE) return false;
    const pan = distance > 0.01 ? (dx * Math.cos(player.yaw) - dz * Math.sin(player.yaw)) / distance : 0;
    return this.playClip(clip, volume / (1 + distance * rolloff), pan, rate);
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
    if (this.output && this.context) this.output.gain.setTargetAtTime(this.muted || paused ? 0 : this.level,
      this.context.currentTime, 0.03);
  }

  /** 0 to 1 master volume from the settings menu. */
  setVolume(volume: number): void {
    this.level = MASTER_LEVEL * Math.max(0, Math.min(1, volume));
    this.setPaused(this.paused);
  }

  consume(events: readonly SimulationEvent[], playerId: EntityId, world: WorldState): void {
    if (!this.context || this.muted || this.paused) return;
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
      this.playClip(variant('ambience-sting', 2, world.tick), MIX.sting, ((world.tick * 104729) % 200) / 100 - 1);
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
        case 'perkBought': this.playClip('pickup', MIX.pickup); this.playClip('electric-powerup', MIX.electric * 0.4); break;
        case 'playerRevived': this.playClip('pickup', MIX.pickup); break;
        case 'playerDowned': this.playClip('ambience-sting-2', MIX.sting * 3); this.playClip('flesh-hit', MIX.hurt); break;
        case 'playerRespawned': this.playClip('mechanical-click', MIX.reloadDone); break;
        case 'trapActivated': this.playClip('electric-powerup', MIX.electric); this.playClip('electric-hit', MIX.electric * 0.7); break;
        case 'mysteryBoxTeddy': this.playClip('ambience-sting-1', MIX.sting * 3); break;
        case 'meleeSwung': this.playClip('knife', MIX.knife); break;
        // A zombie grunts as it winds up, from where it stands: the warning that a blow is coming; the hit itself is a thud.
        case 'zombieSwung': this.playAt(variant('zombie-attack', 3, world.tick + Number(event.zombieId.slice(2))), MIX.zombieAttack,
          world.entities[event.zombieId]?.position, player); break;
        case 'playerDamaged': this.playClip('flesh-hit', MIX.hurt); break;
        case 'weaponReloadStarted': this.playClip(WEAPON_DEFINITIONS[event.weaponId]?.pellets ? 'shotgun-shell'
          : ['kar98k', 'springfield', 'mosin'].includes(event.weaponId) ? 'reload-round' : 'reload-mag', MIX.reload); break;
        case 'weaponReloadCompleted': this.playClip(WEAPON_DEFINITIONS[event.weaponId]?.pellets ? 'shotgun-rack' : 'mechanical-click', MIX.reloadDone); break;
        case 'pointsSpendRejected': this.playClip('buy-denied', MIX.reject); break;
        case 'mysteryBoxUsed': this.playClip('mechanical-button', MIX.box); break;
        case 'mysteryBoxClaimed': this.playClip('pickup', MIX.pickup); break;
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
        case 'equipmentPurchased': this.playClip('pickup', MIX.pickup); this.playClip('mechanical-click', MIX.reloadDone, 0, 0.8); break;
        case 'equipmentFull': this.playClip('buy-denied', MIX.reject); break;
        // Boards break where the zombie tearing them stands, so a far window is faint and panned.
        case 'barrierBoardRemoved': this.playAt(event.boards === 0 ? variant('wood-impact', 2, world.tick) : variant('wood-crack', 4, world.tick + event.boards),
          MIX.boardBreak, world.entities[event.zombieId]?.position, player); break;
        case 'barrierBoardRepaired': this.playClip(variant('wood-impact', 2, event.boards), MIX.boardRepair); break;
        case 'roundPhaseChanged': if (event.to === 'spawning') this.playClip('zombie-distant', MIX.roundStart); break;
        case 'matchRestarted': this.lastStepTick = -100; this.lastZombieVoiceTick = -100; this.nextStingTick = 60 * 50;
          this.lastZombieStepTick = -100; break;
      }
    }
  }

  dispose(): void {
    this.surface.removeEventListener('pointerdown', this.unlock);
    window.removeEventListener('keydown', this.unlock);
    window.removeEventListener('keydown', this.onKeyDown);
    this.sampleWind?.stop(); this.sampleVent?.stop();
    void this.context?.close();
    this.context = null;
  }
}
