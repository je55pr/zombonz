import type { EntityId, PlayerState, Vec3, WorldState, ZombieState } from '../core/types.ts';
import type { SimulationEvent } from '../core/simulation.ts';
import { WEAPON_DEFINITIONS } from '../core/weapon.ts';

const CLIPS = [
  'gun-pistol', 'gun-bolt', 'gun-rifle', 'gun-smg', 'gun-auto', 'gun-shotgun', 'gun-magnum',
  'reload-mag', 'reload-round', 'shotgun-rack', 'shotgun-shell', 'mechanical-click', 'mechanical-button',
  'step-stone-1', 'step-stone-2', 'step-dirt-1', 'step-dirt-2',
  'zombie-voice-1', 'zombie-voice-2', 'zombie-voice-3', 'zombie-distant',
  'wood-crack-1', 'wood-crack-2', 'wood-impact', 'door-unlock', 'door-metal', 'door-open', 'pickup',
  'knife', 'flesh-hit', 'electric-hit', 'electric-powerup', 'electric-boom',
  'explosion-small', 'explosion-large',
  'vent-loop', 'wind-loop',
] as const;
type Clip = typeof CLIPS[number];

function gunClip(weaponId: string): Clip {
  if (weaponId === 'irrlicht' || weaponId === 'molniya') return 'electric-hit';
  if (weaponId === 'rpg7') return 'gun-shotgun';
  if (WEAPON_DEFINITIONS[weaponId]?.pellets) return 'gun-shotgun';
  if (weaponId === 'starter-pistol') return 'gun-pistol';
  if (weaponId === 'magnum-357' || weaponId === 'python') return 'gun-magnum';
  if (weaponId === 'kar98k' || weaponId === 'springfield' || weaponId === 'mosin') return 'gun-bolt';
  if (['thompson', 'mp40', 'ppsh41', 'mp5k', 'skorpion', 'ak74u'].includes(weaponId)) return 'gun-smg';
  if (WEAPON_DEFINITIONS[weaponId]?.trigger === 'auto') return 'gun-auto';
  return 'gun-rifle';
}

/** Recorded CC0 audio cues. Audio is presentation only and starts on user input. */
export class GameAudio {
  private context: AudioContext | null = null;
  private output: GainNode | null = null;
  private readonly clips = new Map<Clip, AudioBuffer>();
  private readonly activeClips = new Map<Clip, number>();
  private lastStepTick = -100;
  private lastZombieVoiceTick = -100;
  private lastZombieStepTick = -100;
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
        if (clip === 'vent-loop' || clip === 'wind-loop') this.loopClip(clip);
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
    gain.gain.value = volume;
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
    if (distance > 24) return false;
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
        this.playClip(world.tick % 2 ? 'step-stone-1' : 'step-stone-2', player.sprinting ? 0.24 : 0.18);
      }
    }
    if (player && world.tick - this.lastZombieVoiceTick >= 150) {
      const nearby = Object.values(world.entities).filter(entity => entity.kind === 'zombie' && entity.alive)
        .sort((a, b) => Math.hypot(a.position.x - player.position.x, a.position.z - player.position.z)
          - Math.hypot(b.position.x - player.position.x, b.position.z - player.position.z));
      const zombie = nearby[0];
      if (zombie) {
        this.lastZombieVoiceTick = world.tick;
        this.playAt(`zombie-voice-${1 + world.tick % 3}` as Clip, 0.52, zombie.position, player);
      }
    }
    if (player && world.tick - this.lastZombieStepTick >= 31) {
      const zombie = Object.values(world.entities).find((entity): entity is ZombieState => entity.kind === 'zombie' && entity.alive
        && Math.hypot(entity.velocity.x, entity.velocity.z) > 0.25
        && Math.hypot(entity.position.x - player.position.x, entity.position.z - player.position.z) < 8);
      if (zombie) {
        this.lastZombieStepTick = world.tick;
        const dirt = zombie.entry?.phase === 'approach';
        this.playAt(dirt ? world.tick % 2 ? 'step-dirt-1' : 'step-dirt-2'
          : world.tick % 2 ? 'step-stone-1' : 'step-stone-2', 0.23, zombie.position, player);
      }
    }
    for (const event of events) {
      if ('playerId' in event && event.playerId !== playerId && event.type !== 'powerupCollected') continue;
      switch (event.type) {
        case 'weaponFired': this.playClip(gunClip(event.weaponId), 0.75); break;
        case 'weaponHit': this.playClip('flesh-hit', event.hitZone === 'head' ? 0.42 : 0.26); break;
        case 'zombieDied': this.playAt('zombie-voice-3', 0.42, world.entities[event.zombieId]?.position, player); break;
        case 'meleeSwung': this.playClip('knife', 0.4); break;
        case 'playerDamaged': this.playClip('flesh-hit', 0.5); break;
        case 'weaponReloadStarted': this.playClip(WEAPON_DEFINITIONS[event.weaponId]?.pellets ? 'shotgun-shell'
          : ['kar98k', 'springfield', 'mosin'].includes(event.weaponId) ? 'reload-round' : 'reload-mag', 0.38); break;
        case 'weaponReloadCompleted': this.playClip(WEAPON_DEFINITIONS[event.weaponId]?.pellets ? 'shotgun-rack' : 'mechanical-click', 0.32); break;
        case 'pointsSpendRejected': this.playClip('mechanical-click', 0.2, 0, 0.7); break;
        case 'mysteryBoxUsed': this.playClip('mechanical-button', 0.3); break;
        case 'mysteryBoxClaimed': this.playClip('pickup', 0.45); break;
        case 'doorOpened': this.playClip('door-unlock', 0.55); this.playClip('door-open', 0.45); break;
        case 'powerupCollected': this.playClip('electric-powerup', 0.4); this.playClip('pickup', 0.3); break;
        case 'nukeDetonated': this.playClip('explosion-large', 0.75, 0, 0.75); break;
        case 'grenadeThrown': this.playClip('door-metal', 0.16, 0, 1.4); break;
        case 'weaponExploded':
          this.playClip(event.weaponId === 'irrlicht' ? 'electric-boom' : 'explosion-small', 0.65);
          break;
        case 'weaponChained': this.playClip('electric-hit', 0.58); break;
        case 'grenadeExploded': this.playClip('explosion-small', 0.7); break;
        case 'barrierBoardRemoved': this.playClip(event.boards === 0 ? 'wood-impact' : event.boards % 2 ? 'wood-crack-1' : 'wood-crack-2', 0.58); break;
        case 'barrierBoardRepaired': this.playClip('wood-impact', 0.35); break;
        case 'roundPhaseChanged': if (event.to === 'spawning') this.playClip('zombie-distant', 0.36); break;
        case 'matchRestarted': this.lastStepTick = -100; this.lastZombieVoiceTick = -100;
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
