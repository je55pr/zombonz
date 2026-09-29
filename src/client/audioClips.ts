import { takeAssetAsync } from './assetStore.ts';

/** Every recorded clip the game plays (built by scripts/prepare_audio.py and scripts/make_round_start.py into public/assets/audio). */
export const AUDIO_CLIPS = [
  'gun-pistol', 'gun-kar98k', 'gun-springfield', 'gun-mosin', 'gun-30-06', 'gun-carbine', 'gun-battle-rifle', 'gun-ak',
  'gun-commando', 'gun-smg-45', 'gun-ppsh', 'gun-mp5k', 'gun-skorpion', 'gun-pump', 'gun-spas', 'gun-double', 'gun-revolver',
  'irrlicht-fire', 'molniya-fire',
  'reload-mag', 'reload-round', 'shotgun-rack', 'shotgun-shell', 'mechanical-click', 'mechanical-button', 'buy-denied',
  'step-stone-1', 'step-stone-2', 'step-stone-3', 'step-stone-4', 'step-dirt-1', 'step-dirt-2', 'step-dirt-3', 'step-dirt-4',
  'zombie-voice-1', 'zombie-voice-2', 'zombie-voice-3', 'zombie-voice-4', 'zombie-voice-5', 'zombie-voice-6', 'zombie-voice-7',
  'zombie-voice-8', 'zombie-attack-1', 'zombie-attack-2', 'zombie-attack-3', 'zombie-death-1', 'zombie-death-2',
  'wood-crack-1', 'wood-crack-2', 'wood-crack-3', 'wood-crack-4', 'wood-impact-1', 'wood-impact-2',
  'door-unlock', 'door-metal', 'door-open', 'pickup', 'knife', 'flesh-hit', 'electric-hit', 'electric-powerup', 'electric-boom',
  'explosion-small', 'explosion-large', 'ambience-sting-1', 'ambience-sting-2', 'round-start-1', 'round-start-2', 'round-start-3',
  'vent-loop', 'wind-loop',
] as const;
export type AudioClip = typeof AUDIO_CLIPS[number];

export function audioClipUrl(clip: AudioClip): string {
  return `${import.meta.env.BASE_URL}assets/audio/${clip}.mp3`;
}

const decoded = new Map<AudioClip, AudioBuffer>();
let decoding: Promise<void> | null = null;

/**
 * Decodes every clip once per page, from the start-screen download (or the network for dev previews,
 * which skip the menu). Decoding needs no user gesture, only playback does, so the start screen does
 * this with an offline context during "Preparing"; an AudioBuffer then plays in any AudioContext.
 * A clip that fails to download or decode is left out and simply stays silent.
 */
export function decodeAudioClips(context?: BaseAudioContext): Promise<void> {
  const decoder = context ?? (typeof OfflineAudioContext === 'undefined' ? null : new OfflineAudioContext(1, 1, 48000));
  if (!decoder) return Promise.resolve();
  decoding ??= Promise.all(AUDIO_CLIPS.map(async clip => {
    try {
      const url = audioClipUrl(clip);
      const downloaded = await takeAssetAsync(url);
      let data: ArrayBuffer;
      if (downloaded) data = await downloaded.arrayBuffer();
      else {
        const response = await fetch(url);
        if (!response.ok) return;
        data = await response.arrayBuffer();
      }
      decoded.set(clip, await decoder.decodeAudioData(data));
    } catch { /* Missing samples stay silent; audio must never affect gameplay. */ }
  })).then(() => {});
  return decoding;
}

/** A clip decoded by decodeAudioClips, if it has finished. */
export function decodedAudioClip(clip: AudioClip): AudioBuffer | undefined {
  return decoded.get(clip);
}
