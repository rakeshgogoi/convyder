"""Throwaway diagnostic: record a device to a WAV file and print a
per-second RMS report, to verify real audio is actually reaching a
device (e.g. confirming Electron's playbackController genuinely produced
audible output on a virtual device) without needing to listen yourself.

Usage:
    python scripts/record_device.py <device_index> <duration_s> <out.wav>
"""
import sys
import wave

import numpy as np
import sounddevice as sd

device_index = int(sys.argv[1])
duration_s = float(sys.argv[2])
out_path = sys.argv[3]
samplerate = 16000

print(f"Recording device {device_index} for {duration_s}s -> {out_path}")
recording = sd.rec(int(duration_s * samplerate), samplerate=samplerate, channels=1, dtype="int16", device=device_index)
sd.wait()

with wave.open(out_path, "wb") as wf:
    wf.setnchannels(1)
    wf.setsampwidth(2)
    wf.setframerate(samplerate)
    wf.writeframes(recording.tobytes())

# per-second RMS report
samples_per_sec = samplerate
flat = recording.flatten().astype(np.float64)
for sec in range(int(duration_s)):
    chunk = flat[sec * samples_per_sec : (sec + 1) * samples_per_sec]
    if len(chunk) == 0:
        continue
    rms = np.sqrt(np.mean(chunk**2))
    print(f"  t={sec}s rms={rms:.1f}")
