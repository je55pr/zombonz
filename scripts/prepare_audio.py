"""Build the small runtime audio selection from the CC0 downloads.

Requires: pip install py7zr imageio-ffmpeg
Run: python scripts/prepare_audio.py --downloads C:/Users/Jess/Downloads
     --extras C:/path/to/audio-source-extras
The original archives stay outside the repo; only compressed MP3 derivatives ship.
"""

import argparse
import subprocess
import tempfile
import zipfile
from pathlib import Path

import imageio_ffmpeg
import py7zr


# (download, member or None for a loose file, runtime name, maximum seconds)
CLIPS = [
    ("Prepared SFX Library.7z", "Prepared SFX Library/1911/A_34P.wav", "gun-pistol", 1.5),
    ("Prepared SFX Library.7z", "Prepared SFX Library/Mosin Nagant/M_21P.wav", "gun-bolt", 2.0),
    ("Prepared SFX Library.7z", "Prepared SFX Library/SKS/U_14P.wav", "gun-rifle", 1.6),
    ("Prepared SFX Library.7z", "Prepared SFX Library/PPSh/P_16P.wav", "gun-smg", 0.6),
    ("Prepared SFX Library.7z", "Prepared SFX Library/AK-47/C_27P.wav", "gun-auto", 0.6),
    ("Prepared SFX Library.7z", "Prepared SFX Library/Mossberg/N_26P.wav", "gun-shotgun", 2.0),
    ("Prepared SFX Library.7z", "Prepared SFX Library/Ruger Single Six/S_11P.wav", "gun-magnum", 1.7),
    ("clipload1.wav", None, "reload-mag", 0.8),
    ("singlebullet1.wav", None, "reload-round", 0.8),
    ("shotgunsounds.zip", "ShotgunSounds/Rack.mp3", "shotgun-rack", 1.1),
    ("shotgunsounds.zip", "ShotgunSounds/First Shell.mp3", "shotgun-shell", 1.1),
    ("mechanical.7z", "mechanical/mechanical_clicks-01.flac", "mechanical-click", 0.9),
    ("mechanical.7z", "mechanical/mechanical_button-01.flac", "mechanical-button", 0.9),
    ("Fantozzi-footsteps.7z", "Fantozzi-footsteps/ogg/Fantozzi-StoneL1.ogg", "step-stone-1", 0.55),
    ("Fantozzi-footsteps.7z", "Fantozzi-footsteps/ogg/Fantozzi-StoneR2.ogg", "step-stone-2", 0.55),
    ("Fantozzi-footsteps.7z", "Fantozzi-footsteps/ogg/Fantozzi-SandL1.ogg", "step-dirt-1", 0.55),
    ("Fantozzi-footsteps.7z", "Fantozzi-footsteps/ogg/Fantozzi-SandR2.ogg", "step-dirt-2", 0.55),
    ("zombies.zip", "zombies/zombie-1.wav", "zombie-voice-1", 2.4),
    ("zombies.zip", "zombies/zombie-4.wav", "zombie-voice-2", 2.4),
    ("zombies.zip", "zombies/zombie-10.wav", "zombie-voice-3", 2.4),
    ("darsycho__zombie-moans.ogg", None, "zombie-distant", 3.0),
    ("independent_nu_ljudbank-wood_crack_hit_destruction.7z", "wood_impact/crack01.mp3.flac", "wood-crack-1", 0.9),
    ("independent_nu_ljudbank-wood_crack_hit_destruction.7z", "wood_impact/crack03.mp3.flac", "wood-crack-2", 0.9),
    ("independent_nu_ljudbank-wood_crack_hit_destruction.7z", "wood_impact/impactwood01.mp3.flac", "wood-impact", 0.9),
    ("80-CC0-RPG-SFX.zip", "lock_01.ogg", "door-unlock", 1.0),
    ("80-CC0-RPG-SFX.zip", "metal_01.ogg", "door-metal", 1.5),
    ("80-CC0-RPG-SFX.zip", "item_misc_01.ogg", "pickup", 1.3),
    ("80-CC0-RPG-SFX.zip", "blade_01.ogg", "knife", 1.0),
    ("80-CC0-RPG-SFX.zip", "creature_hurt_01.ogg", "flesh-hit", 1.0),
    ("qubodup-DoorSet.7z", "qubodup-DoorSet/ogg/qubodup-DoorOpen01.ogg", "door-open", 2.0),
    ("25-CC0-bang-sfx.zip", "bang_01.ogg", "explosion-small", 1.5),
    ("25-CC0-bang-sfx.zip", "cannon_01.ogg", "explosion-large", 2.5),
    ("hit.wav", None, "electric-hit", 1.2),
    ("powerup.wav", None, "electric-powerup", 1.6),
    ("deathboom.wav", None, "electric-boom", 2.0),
    ("airvent-large-loop.wav", None, "vent-loop", 9.0),
    ("wind1.wav", None, "wind-loop", 9.0),
]


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--downloads", required=True, type=Path)
    parser.add_argument("--extras", required=True, type=Path)
    args = parser.parse_args()
    target = Path(__file__).resolve().parents[1] / "public/assets/audio"
    target.mkdir(parents=True, exist_ok=True)
    ffmpeg = imageio_ffmpeg.get_ffmpeg_exe()
    extras = {"qubodup-DoorSet.7z", "25-CC0-bang-sfx.zip"}
    def archive_path(name: str) -> Path:
        return (args.extras if name in extras else args.downloads) / name
    with tempfile.TemporaryDirectory(prefix="zombonz-audio-") as scratch:
        staging = Path(scratch)
        for archive_name in sorted({row[0] for row in CLIPS}):
            members = [row[1] for row in CLIPS if row[0] == archive_name and row[1]]
            if not members:
                continue
            archive = archive_path(archive_name)
            if archive.suffix == ".7z":
                with py7zr.SevenZipFile(archive) as packed:
                    packed.extract(path=staging, targets=members)
            else:
                with zipfile.ZipFile(archive) as packed:
                    for member in members:
                        packed.extract(member, staging)
        for archive_name, member, name, seconds in CLIPS:
            source = staging / member if member else archive_path(archive_name)
            if not source.is_file():
                raise FileNotFoundError(source)
            output = target / f"{name}.mp3"
            ambience = name.endswith("-loop")
            command = [ffmpeg, "-hide_banner", "-loglevel", "error", "-y", "-i", str(source),
                       "-t", str(seconds), "-ac", "1", "-ar", "24000" if ambience else "32000",
                       "-b:a", "48k" if ambience else "64k", "-codec:a", "libmp3lame"]
            if not ambience:
                command += ["-af", "highpass=f=45,silenceremove=start_periods=1:start_threshold=-55dB"]
            command.append(str(output))
            subprocess.run(command, check=True)
            subprocess.run([ffmpeg, "-v", "error", "-i", str(output), "-f", "null", "-"],
                           check=True, capture_output=True)
            print(f"{output.name}: {output.stat().st_size // 1024} KiB")
    total = sum(path.stat().st_size for path in target.glob("*.mp3"))
    print(f"Runtime selection: {total // 1024} KiB")
    if total > 2_000_000:
        raise RuntimeError("Audio selection exceeds the 2 MB budget")


if __name__ == "__main__":
    main()
