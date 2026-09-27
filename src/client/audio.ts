import type { EntityId, PlayerState, Vec3, WorldState, ZombieState } from '../core/types.ts';
import type { SimulationEvent } from '../core/simulation.ts';
import { WEAPON_DEFINITIONS } from '../core/weapon.ts';

const CLIPS = [
  'gun-pistol', 'gun-kar98k', 'gun-springfield', 'gun-mosin', 'gun-30-06', 'gun-carbine', 'gun-battle-rifle', 'gun-ak',
  'gun-commando', 'gun-smg-45', 'gun-ppsh', 'gun-mp5k', 'gun-skorpion', 'gun-pump', 'gun-spas', 'gun-double', 'gun-revolver',
  'irrlicht-fire', 'molniya-fire',
  'reload-mag', 'reload-round', 'shotgun-rack', 'shotgun-shell', 'mechanical-click', 'mechanical-button', 'buy-denied',
  'step-stone-1', 'step-stone-2', 'step-stone-3', 'step-stone-4', 'step-dirt-1', 'step-dirt-2', 'step-dirt-3', 'step-dirt-4',
  'zombie-voice-1', 'zombie-voice-2', 'zombie-voice-3', 'zombie-voice-4', 'zombie-voice-5', 'zombie-voice-6', 'zombie-voice-7',
  'zombie-voice-8', 'zombie-attack-1', 'zombie-attack-2', 'zombie-attack-3', 'zombie-death-1', 'zombie-death-2', 'zombie-distant',
  'wood-crack-1', 'wood-crack-2', 'wood-crack-3', 'wood-crack-4', 'wood-impact-1', 'wood-impact-2',
  'door-unlock', 'door-metal', 'door-open', 'pickup', 'knife', 'flesh-hit', 'electric-hit', 'electric-powerup', 'electric-boom',
  'explosion-small', 'explosion-large', 'ambience-sting-1', 'ambience-sting-2',
  'vent-loop', 'wind-loop',
] as const;
type Clip = typeof CLIPS[number];

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
/** One-shot mix levels, relative to the player's own gunfire. */
const MIX = {
  gunfire: 1, explosion: 1, electric: 0.8, reload: 0.4, reloadDone: 0.35, knife: 0.5, hit: 0.35, headshot: 0.5,
  hurt: 0.6, footstep: 0.28, sprintStep: 0.34, zombieVoice: 0.6, zombieStep: 0.3, zombieDeath: 0.55,
  boardBreak: 0.55, boardRepair: 0.4, door: 0.6, box: 0.4, pickup: 0.5, reject: 0.35, roundStart: 0.5,
  zombieAttack: 0.55, sting: 0.22,
} as const;
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
  /** Output gain when audible; the player's volume setting scales the original 0.2 mix level. */
  private level = 0.2;
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

  private start(): void {
    if (!this.context) {
      try {
        this.context = new AudioContext({ latencyHint: 'interactive' });
        this.output = this.context.createGain();
        this.output.gain.value = this.muted || this.paused ? 0 : this.level;
        this.output.connect(this.context.destination);
        void this.loadClips();
      } catch { return; }
    }
    if (this.context.state === 'suspended') void this.context.resume().catch(() => {});
  }

  private async loadClips(): Promise<void> {
    const context = this.context;
    if (!context) return;
    await Promise.all(CLIPS.map(async clip => {
      try {
        const response = await fetch(`${import.meta.env.BASE_URL}assets/audio/${clip}.mp3`);
        if (!response.ok) return;
        const buffer = await context.decodeAudioData(await response.arrayBuffer());
        if (this.context !== context) return;
        this.clips.set(clip, buffer);
        // Ambience loops keep their authored bed levels; only one-shots are normalised.
        if (clip === 'vent-loop' || clip === 'wind-loop') this.loopClip(clip);
        else this.trims.set(clip, normalisingGain(loudestWindowDb(buffer.getChannelData(0), buffer.sampleRate)));
      } catch { /* Missing samples stay silent; audio must never affect gameplay. */ }
    }));
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

  private playAt(clip: Clip, volume: number, point: Vec3 | undefined, player: PlayerState | undefined): boolean {
    if (!point || !player) return false;
    const dx = point.x - player.position.x, dz = point.z - player.position.z;
    const distance = Math.hypot(dx, dz);
    if (distance > HEARING_RANGE) return false;
    const pan = distance > 0.01 ? (dx * Math.cos(player.yaw) - dz * Math.sin(player.yaw)) / distance : 0;
    return this.playClip(clip, volume / (1 + distance * 0.24), pan);
  }

  setPaused(paused: boolean): void {
    this.paused = paused;
    if (this.output && this.context) this.output.gain.setTargetAtTime(this.muted || paused ? 0 : this.level,
      this.context.currentTime, 0.03);
  }

  /** 0 to 1 master volume from the settings menu. */
  setVolume(volume: number): void {
    this.level = 0.2 * Math.max(0, Math.min(1, volume));
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
      if ('playerId' in event && event.playerId !== playerId && event.type !== 'powerupCollected') continue;
      switch (event.type) {
        case 'weaponFired': { const { clip, rate } = gunClip(event.weaponId); this.playClip(clip, MIX.gunfire, 0, rate); break; }
        case 'weaponHit': this.playClip('flesh-hit', event.hitZone === 'head' ? MIX.headshot : MIX.hit); break;
        case 'zombieDied': this.playAt(variant('zombie-death', 2, Number(event.zombieId.slice(2))), MIX.zombieDeath,
          world.entities[event.zombieId]?.position, player); break;
        case 'meleeSwung': this.playClip('knife', MIX.knife); break;
        // A zombie's swipe lands with a grunt as well as the hit.
        case 'playerDamaged': this.playClip('flesh-hit', MIX.hurt); this.playClip(variant('zombie-attack', 3, world.tick), MIX.zombieAttack); break;
        case 'weaponReloadStarted': this.playClip(WEAPON_DEFINITIONS[event.weaponId]?.pellets ? 'shotgun-shell'
          : ['kar98k', 'springfield', 'mosin'].includes(event.weaponId) ? 'reload-round' : 'reload-mag', MIX.reload); break;
        case 'weaponReloadCompleted': this.playClip(WEAPON_DEFINITIONS[event.weaponId]?.pellets ? 'shotgun-rack' : 'mechanical-click', MIX.reloadDone); break;
        case 'pointsSpendRejected': this.playClip('buy-denied', MIX.reject); break;
        case 'mysteryBoxUsed': this.playClip('mechanical-button', MIX.box); break;
        case 'mysteryBoxClaimed': this.playClip('pickup', MIX.pickup); break;
        case 'doorOpened': this.playClip('door-unlock', MIX.door); this.playClip('door-open', MIX.door * 0.8); break;
        case 'powerupCollected': this.playClip('electric-powerup', MIX.electric * 0.6); this.playClip('pickup', MIX.pickup * 0.6); break;
        case 'nukeDetonated': this.playClip('explosion-large', MIX.explosion, 0, 0.75); break;
        case 'grenadeThrown': this.playClip('door-metal', MIX.reload * 0.5, 0, 1.4); break;
        case 'weaponExploded':
          this.playAt(event.weaponId === 'irrlicht' ? 'electric-boom' : 'explosion-small', MIX.explosion, event.position, player);
          break;
        case 'weaponChained': this.playClip('electric-hit', MIX.electric); break;
        case 'grenadeExploded': this.playAt('explosion-small', MIX.explosion, event.position, player); break;
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
