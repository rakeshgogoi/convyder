"""Throwaway CLI: capture your mic, stream it to /ws/outgoing, and play the
synthesized (translated) speech back through a chosen output device.

Validates the full outgoing pipeline (VAD -> STT -> MT -> TTS) end-to-end
before wiring it into a real virtual mic / Teams call. Plays to your own
speakers/headphones by default so you can hear the result directly —
routing into an actual virtual mic device is a follow-up step once this is
proven (needs a second virtual audio device distinct from the one used by
the incoming pipeline's capture, since they must not cross — see CLAUDE.md
"Audio routing").

Usage:
    python scripts/playback_client.py --mic "MacBook Air Microphone" --speaker "MacBook Air Speakers"

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


async def run(mic_name: str, speaker_name: str, ws_url: str) -> None:
    mic_index = find_device_index(mic_name, require_input=True)
    speaker_index = find_device_index(speaker_name, require_input=False)
    print(
        f"Mic: {sd.query_devices(mic_index)['name']} -> {ws_url} "
        f"-> Speaker: {sd.query_devices(speaker_index)['name']}"
    )

    audio_queue: "asyncio.Queue[bytes]" = asyncio.Queue()
    loop = asyncio.get_event_loop()

    def mic_callback(indata, frames, time_info, status) -> None:
        if status:
            print(f"[mic status] {status}", file=sys.stderr)
        mono = indata[:, 0] if indata.ndim > 1 else indata
        loop.call_soon_threadsafe(audio_queue.put_nowait, np.ascontiguousarray(mono).tobytes())

    mic_stream = sd.InputStream(
        device=mic_index,
        samplerate=SAMPLE_RATE_HZ,
        channels=1,
        dtype="int16",
        blocksize=CHUNK_SAMPLES,
        callback=mic_callback,
    )

    async with websockets.connect(ws_url) as ws:
        async def sender() -> None:
            while True:
                chunk = await audio_queue.get()
                await ws.send(chunk)

        async def receiver() -> None:
            pending_header = None
            async for message in ws:
                if isinstance(message, str):
                    pending_header = json.loads(message)
                    continue

                if pending_header is not None:
                    print(
                        f"\n[{pending_header['segment_id']}] {pending_header['text']}"
                        f"  ->  {pending_header['translated_text']}"
                    )
                    pending_header = None

                if message:
                    audio_np = np.frombuffer(message, dtype=np.int16)
                    sd.play(audio_np, samplerate=SAMPLE_RATE_HZ, device=speaker_index, blocking=False)

        with mic_stream:
            await asyncio.gather(sender(), receiver())


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--mic", default="MacBook Air Microphone")
    parser.add_argument("--speaker", default="MacBook Air Speakers")
    parser.add_argument("--url", default="ws://127.0.0.1:8000/ws/outgoing")
    args = parser.parse_args()
    asyncio.run(run(args.mic, args.speaker, args.url))
