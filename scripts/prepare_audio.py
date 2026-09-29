"""Build the small runtime audio selection from the CC0 downloads.

Requires: pip install py7zr imageio-ffmpeg
Run: python scripts/prepare_audio.py --downloads C:/Users/Jess/Downloads
     --extras C:/path/to/audio-source-extras
The original archives stay outside the repo; only compressed MP3 derivatives ship.
The round-start bell strikes are not from a download: scripts/make_round_start.py synthesises them.
"""

import argparse
import subprocess
import tempfile
import zipfile
from pathlib import Path

import imageio_ffmpeg
import py7zr


# (download, member or None for a loose file, runtime name, maximum seconds)
LIB = "Prepared SFX Library.7z"
# Recorded a few metres in front of the gun, these takes lack the low "thump" a close first-person
# shot has, which reads as distance. A low shelf plus a short synthetic kick (a 140 -> 55 Hz sweep
# decaying over ~25 ms, starting on the shot, tuned to the ~20% low-end body of the AK and Trench Gun takes) restores it; a limiter keeps the sum from clipping.
PUNCH = {"gun-pistol"}
PUNCH_FILTER = (
    "[0:a]aformat=channel_layouts=mono,aresample=32000,highpass=f=35,"
    "silenceremove=start_periods=1:start_threshold=-55dB,lowshelf=f=150:g=4[shot];"
    "aevalsrc=exprs='0.8*sin(2*PI*(55*t+2.55*(1-exp(-t/0.03))))*exp(-t/0.025)':s=32000:d=0.15[thump];"
    "[shot][thump]amix=inputs=2:weights=1 0.08:normalize=0,alimiter=limit=0.95:attack=1:release=50,"
    "afade=t=out:st={fade}:d=0.25[out]"
)
L = "Prepared SFX Library"
WOOD = "independent_nu_ljudbank-wood_crack_hit_destruction.7z"
CLIPS = [
    # Guns: the library's "near distance" take of each gun (the first shot, which starts the file),
    # one per gun family. Its "mid distance" takes are recorded down range and open with handling noise.
    (LIB, f"{L}/1911/A_42P.wav", "gun-pistol", 1.1),
    (LIB, f"{L}/Arisaka/E_25P.wav", "gun-kar98k", 1.2),
    (LIB, f"{L}/1917/B_24P.wav", "gun-springfield", 1.2),
    (LIB, f"{L}/Mosin Nagant/M_21P.wav", "gun-mosin", 1.2),
    (LIB, f"{L}/Tikka/W_29P.wav", "gun-30-06", 1.1),
    (LIB, f"{L}/SKS/U_14P.wav", "gun-carbine", 1.0),
    # The Marlin's .30-30 is the driest, fullest rifle take; the .300 Blackout sounded thin and distant.
    (LIB, f"{L}/Marlin 336/I_22P.wav", "gun-battle-rifle", 1.1),
    (LIB, f"{L}/AK-47/C_28P.wav", "gun-ak", 0.8),
    (LIB, f"{L}/AR-15/D_32P.wav", "gun-commando", 0.8),
    (LIB, f"{L}/Carl Gustav M45/G_31P.wav", "gun-smg-45", 0.7),
    (LIB, f"{L}/PPSh/P_30P.wav", "gun-ppsh", 0.6),
    (LIB, f"{L}/Walther PPQ/X_39P.wav", "gun-mp5k", 0.6),
    (LIB, f"{L}/Bersa/F_47P.wav", "gun-skorpion", 0.6),
    (LIB, f"{L}/Model 12/K_22P.wav", "gun-pump", 1.3),
    (LIB, f"{L}/Nova/O_21P.wav", "gun-spas", 1.2),
    (LIB, f"{L}/Mossberg/N_30P.wav", "gun-double", 1.3),
    (LIB, f"{L}/Smith & Wesson 642/V_27P.wav", "gun-revolver", 1.2),
    ("teleport.wav", None, "irrlicht-fire", 0.8),
    ("shieldhit.wav", None, "molniya-fire", 1.2),
    ("clipload1.wav", None, "reload-mag", 0.8),
    ("singlebullet1.wav", None, "reload-round", 0.8),
    ("shotgunsounds.zip", "ShotgunSounds/Rack.mp3", "shotgun-rack", 1.1),
    ("shotgunsounds.zip", "ShotgunSounds/First Shell.mp3", "shotgun-shell", 1.1),
    ("mechanical.7z", "mechanical/mechanical_clicks-01.flac", "mechanical-click", 0.9),
    ("mechanical.7z", "mechanical/mechanical_button-01.flac", "mechanical-button", 0.9),
    ("mechanical.7z", "mechanical/buzzerr-01.flac", "buy-denied", 0.6),
    *[("Fantozzi-footsteps.7z", f"Fantozzi-footsteps/ogg/Fantozzi-{source}.ogg", f"step-{kind}-{index}", 0.55)
      for kind, material in (("stone", "Stone"), ("dirt", "Sand"))
      for index, source in enumerate((f"{material}L1", f"{material}R1", f"{material}L2", f"{material}R2"), 1)],
    *[("zombies.zip", f"zombies/zombie-{source}.wav", f"zombie-voice-{index}", 2.4)
      for index, source in enumerate((1, 4, 8, 12, 15, 17, 20, 21), 1)],
    *[("zombies.zip", f"zombies/zombie-{source}.wav", f"zombie-attack-{index}", 1.2) for index, source in enumerate((5, 7, 13), 1)],
    *[("zombies.zip", f"zombies/zombie-{source}.wav", f"zombie-death-{index}", 1.2) for index, source in enumerate((10, 14), 1)],
    *[(WOOD, f"wood_impact/crack{source:02d}.mp3.flac", f"wood-crack-{index}", 0.9) for index, source in enumerate((1, 3, 5, 7), 1)],
    *[(WOOD, f"wood_impact/impactwood{source:02d}.mp3.flac", f"wood-impact-{index}", 0.9) for index, source in enumerate((1, 4), 1)],
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
    ("dark_ambiences.zip", "dark_ambiences/ambience-1.wav", "ambience-sting-1", 4.6),
    ("dark_ambiences.zip", "dark_ambiences/ambience-5.wav", "ambience-sting-2", 3.4),
    ("airvent-large-loop.wav", None, "vent-loop", 9.0),
    ("wind1.wav", None, "wind-loop", 9.0),
]


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--downloads", required=True, type=Path)
    parser.add_argument("--extras", type=Path, help="folder holding qubodup-DoorSet.7z and 25-CC0-bang-sfx.zip")
    parser.add_argument("--only", nargs="*", help="rebuild just these runtime names (default: all)")
    args = parser.parse_args()
    rows = [row for row in CLIPS if not args.only or row[2] in args.only]
    target = Path(__file__).resolve().parents[1] / "public/assets/audio"
    target.mkdir(parents=True, exist_ok=True)
    ffmpeg = imageio_ffmpeg.get_ffmpeg_exe()
    extras = {"qubodup-DoorSet.7z", "25-CC0-bang-sfx.zip"}
    def archive_path(name: str) -> Path:
        return (args.extras if name in extras else args.downloads) / name
    with tempfile.TemporaryDirectory(prefix="zombonz-audio-") as scratch:
        staging = Path(scratch)
        for archive_name in sorted({row[0] for row in rows}):
            members = [row[1] for row in rows if row[0] == archive_name and row[1]]
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
        for archive_name, member, name, seconds in rows:
            source = staging / member if member else archive_path(archive_name)
            if not source.is_file():
                raise FileNotFoundError(source)
            output = target / f"{name}.mp3"
            ambience = name.endswith("-loop")
            command = [ffmpeg, "-hide_banner", "-loglevel", "error", "-y", "-i", str(source),
                       "-t", str(seconds), "-ac", "1", "-ar", "24000" if ambience else "32000",
                       "-b:a", "48k" if ambience else "64k", "-codec:a", "libmp3lame"]
            # Fade the last 0.25 s so a clip cut short of its tail never ends on a click.
            fade = max(0.0, seconds - 0.25)
            if name in PUNCH:
                command += ["-filter_complex", PUNCH_FILTER.format(fade=fade), "-map", "[out]"]
            elif not ambience:
                command += ["-af", "highpass=f=45,silenceremove=start_periods=1:start_threshold=-55dB,"
                            f"afade=t=out:st={fade}:d=0.25"]
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
