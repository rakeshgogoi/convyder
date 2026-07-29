"""Throwaway CLI: capture audio from a chosen input device (e.g. BlackHole,
fed by a Multi-Output Device during a Teams/Meet call), stream it to the
backend's /ws/incoming endpoint, print live captions, and play the
translated speech through a chosen output device (your headphones).

This exists to validate the incoming pipeline against real audio before
the Electron app is built. Requires the backend running first.

Usage:
    python scripts/capture_client.py --device blackhole --speaker AirPods
    python scripts/capture_client.py --device "MacBook Air Microphone"  # quick mic test

Extra dependency not in requirements.txt (capture-only, not needed by the
backend service itself):
    pip install sounddevice
"""
import argparse
import asyncio
import json
import sys

import numpy as np
import sounddevice as sd
import websockets

SAMPLE_RATE_HZ = 16000
CHUNK_MS = 20
CHUNK_SAMPLES = SAMPLE_RATE_HZ * CHUNK_MS // 1000


def find_device_index(name_substring: str, require_input: bool) -> int:
    devices = sd.query_devices()
    key = "max_input_channels" if require_input else "max_output_channels"
    for i, d in enumerate(devices):
        if name_substring.lower() in d["name"].lower() and d[key] > 0:
            return i
    kind = "input" if require_input else "output"
    available = "\n".join(f"  [{i}] {d['name']} ({kind}={d[key]})" for i, d in enumerate(devices))
    raise SystemExit(f"No {kind} device matching '{name_substring}'. Available:\n{available}")


def print_transcript(data: dict) -> None:
    prefix = f"[{data['segment_id']}]"
    if data["is_final"]:
        line = f"{prefix} {data['text']}"
        if data.get("translated_text"):
            line += f"  ->  {data['translated_text']}"
        print(f"\r{line}" + " " * 10)
    else:
        print(f"\r{prefix} {data['text']}", end="", flush=True)


async def run(device_name: str, speaker_name: str, ws_url: str) -> None:
    device_index = find_device_index(device_name, require_input=True)
    speaker_index = find_device_index(speaker_name, require_input=False)
    print(
        f"Capturing from: {sd.query_devices(device_index)['name']} -> {ws_url} "
        f"-> playing to: {sd.query_devices(speaker_index)['name']}"
    )

    audio_queue: "asyncio.Queue[bytes]" = asyncio.Queue()
    loop = asyncio.get_event_loop()

    def callback(indata, frames, time_info, status) -> None:
        if status:
            print(f"[stream status] {status}", file=sys.stderr)
        mono = indata[:, 0] if indata.ndim > 1 else indata
        pcm16 = np.ascontiguousarray(mono).tobytes()
        loop.call_soon_threadsafe(audio_queue.put_nowait, pcm16)

    stream = sd.InputStream(
        device=device_index,
        samplerate=SAMPLE_RATE_HZ,
        channels=1,
        dtype="int16",
        blocksize=CHUNK_SAMPLES,
        callback=callback,
    )

    async with websockets.connect(ws_url) as ws:
        async def sender() -> None:
            while True:
                chunk = await audio_queue.get()
                await ws.send(chunk)

        async def receiver() -> None:
            pending_final = False
            async for message in ws:
                if isinstance(message, str):
                    data = json.loads(message)
                    if data.get("type") != "transcript":
                        continue
                    print_transcript(data)
                    pending_final = data["is_final"]
                    continue

                if pending_final and message:
                    audio_np = np.frombuffer(message, dtype=np.int16)
                    sd.play(audio_np, samplerate=SAMPLE_RATE_HZ, device=speaker_index, blocking=False)
                pending_final = False

        with stream:
            await asyncio.gather(sender(), receiver())


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--device", default="blackhole", help="Substring to match the input device name")
    parser.add_argument("--speaker", default="AirPods", help="Substring to match the output device name")
    parser.add_argument("--url", default="ws://127.0.0.1:8000/ws/incoming")
    args = parser.parse_args()
    asyncio.run(run(args.device, args.speaker, args.url))
