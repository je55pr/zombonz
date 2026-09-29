"""Render the round-start stinger: three short, dark, low bell strikes (`round-start-1..3`).

Original and synthesised, with no sampled material, so it needs no attribution. Each is a struck bell with a
minor-third partial, a slow shimmer between detuned copies of it, a soft low drone whose two notes rub against each
other, and a breath of dark noise. All of it sits below about 1 kHz, under the crack of a gun and the rasp of a zombie's
voice, and it dies away over about two seconds, so it can play over a fight without covering it. The three differ in
pitch and colour and the game rotates through them by round, so a long run doesn't hear the same take every time.

Requires: pip install numpy imageio-ffmpeg
Run: python scripts/make_round_start.py
"""

import subprocess
import tempfile
import wave
from pathlib import Path

import imageio_ffmpeg
import numpy as np

RATE = 32000
# Bell partials as ratios of the root, with their strength and their decay time (seconds to fall to 1/e).
# 1.19 is a minor third above the root and 1.56 a flat fifth-ish: what makes it a cold bell rather than a friendly one.
BELL = [(0.5, 0.25, 1.3), (1.0, 0.7, 1.1), (1.19, 0.6, 0.9), (1.56, 0.6, 0.75), (2.0, 0.9, 0.65),
        (2.54, 0.8, 0.5), (3.0, 0.75, 0.4), (4.1, 0.6, 0.3), (5.4, 0.45, 0.22), (6.8, 0.3, 0.15)]
# name, root in Hz, the drone's second note as a ratio (a minor second or a tritone rubs), length in seconds, noise seed, bell partials used
VARIANTS = [
    ("round-start-1", 110.00, 16 / 15, 2.4, 11, len(BELL)),
    ("round-start-2", 98.00, 45 / 32, 2.2, 23, len(BELL) - 2),
    ("round-start-3", 87.31, 16 / 15, 2.6, 37, len(BELL) - 1),
]


def bandpass(signal: np.ndarray, low: float, high: float) -> np.ndarray:
    """A smooth band-pass through the spectrum, so the noise has no hard edges."""
    spectrum = np.fft.rfft(signal)
    freqs = np.fft.rfftfreq(len(signal), 1 / RATE)
    gain = np.exp(-(np.maximum(0, low - freqs) / (low * 0.5)) ** 2) * np.exp(-(np.maximum(0, freqs - high) / (high * 0.5)) ** 2)
    return np.fft.irfft(spectrum * gain, len(signal))


def render(root: float, drone_ratio: float, seconds: float, seed: int, partials: int) -> np.ndarray:
    n = int(RATE * seconds)
    t = np.arange(n) / RATE
    rng = np.random.default_rng(seed)
    out = np.zeros(n)

    # The thud under the strike: a sine falling from 78 Hz to 46 Hz, eased in over 4 ms so it starts without a click.
    tau = 0.09
    thud = np.sin(2 * np.pi * (46 * t + (78 - 46) * tau * (1 - np.exp(-t / tau))))
    out += 0.3 * thud * np.exp(-t / 0.14) * np.minimum(1, t / 0.004)

    # The bell: every partial twice, the second a little sharp, so each beats slowly against itself.
    for ratio, strength, decay in BELL[:partials]:
        for detune, share in ((0.0, 1.0), (0.55 + 0.1 * ratio, 0.6)):
            phase = rng.uniform(0, 2 * np.pi)
            out += 0.16 * strength * share * np.sin(2 * np.pi * (root * ratio + detune) * t + phase) * np.exp(-t / decay) \
                * np.minimum(1, t / 0.003)
    # The strike itself: a 25 ms burst of dark noise.
    out += 0.5 * bandpass(rng.standard_normal(n), 300, 1400) * np.exp(-t / 0.02) * np.minimum(1, t / 0.002)

    # The drone: two low, soft notes that rub against each other, swelling in and fading out.
    swell = np.sin(np.pi * np.clip(t / seconds, 0, 1) ** 0.6) ** 2
    for ratio, share in ((1.0, 1.0), (drone_ratio, 0.7)):
        saw = np.zeros(n)
        for harmonic in range(1, 9):
            saw += np.sin(2 * np.pi * root * ratio * harmonic * t + rng.uniform(0, 2 * np.pi)) / harmonic
        out += 0.045 * share * swell * bandpass(saw, 40, 330)

    # A breath of dark noise that comes up after the strike, like something turning over.
    breath = np.clip(t / 0.35, 0, 1) ** 2 * np.exp(-np.maximum(0, t - 0.35) / 0.9)
    out += 0.07 * breath * bandpass(rng.standard_normal(n), 140, 650)

    # A smooth tail, so it always ends on silence.
    tail = int(RATE * 0.4)
    out[-tail:] *= 0.5 * (1 + np.cos(np.pi * np.arange(tail) / tail))
    return out * (0.85 / np.max(np.abs(out)))


def main() -> None:
    target = Path(__file__).resolve().parents[1] / "public/assets/audio"
    ffmpeg = imageio_ffmpeg.get_ffmpeg_exe()
    with tempfile.TemporaryDirectory(prefix="zombonz-round-start-") as scratch:
        for name, root, drone_ratio, seconds, seed, partials in VARIANTS:
            samples = render(root, drone_ratio, seconds, seed, partials)
            source = Path(scratch) / f"{name}.wav"
            with wave.open(str(source), "wb") as out:
                out.setnchannels(1); out.setsampwidth(2); out.setframerate(RATE)
                out.writeframes((samples * 32767).astype("<i2").tobytes())
            output = target / f"{name}.mp3"
            subprocess.run([ffmpeg, "-hide_banner", "-loglevel", "error", "-y", "-i", str(source), "-ac", "1", "-ar", str(RATE),
                            "-b:a", "64k", "-codec:a", "libmp3lame", str(output)], check=True)
            subprocess.run([ffmpeg, "-v", "error", "-i", str(output), "-f", "null", "-"], check=True, capture_output=True)
            print(f"{output.name}: {output.stat().st_size // 1024} KiB")


if __name__ == "__main__":
    main()
