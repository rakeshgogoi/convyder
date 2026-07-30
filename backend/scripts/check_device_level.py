"""Throwaway diagnostic: print the raw RMS audio level of a device every
second for 10 seconds, independent of the VAD/pipeline, to answer one
question: is any audio actually reaching this device at all?

Usage:
    python scripts/check_device_level.py --device "BlackHole 2ch"
"""
import argparse
import time

import numpy as np
import sounddevice as sd


def find_device_index(name_substring: str) -> int:
    devices = sd.query_devices()
    for i, d in enumerate(devices):
        if name_substring.lower() in d["name"].lower() and d["max_input_channels"] > 0:
            return i
    raise SystemExit(f"No input device matching '{name_substring}'")


def main(device_name: str) -> None:
    device_index = find_device_index(device_name)
    print(f"Listening to: {sd.query_devices(device_index)['name']} for 10s...")

    levels = []

    def callback(indata, frames, time_info, status) -> None:
        mono = indata[:, 0] if indata.ndim > 1 else indata
        levels.append(float(np.sqrt(np.mean(mono.astype(np.float64) ** 2))))

    with sd.InputStream(device=device_index, samplerate=16000, channels=1, dtype="int16", callback=callback):
        for second in range(10):
            time.sleep(1)
            recent = levels[-20:] if levels else [0.0]
            print(f"  t={second+1}s  rms={max(recent):.1f}")
            levels.clear()


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--device", default="BlackHole 2ch")
    args = parser.parse_args()
    main(args.device)
