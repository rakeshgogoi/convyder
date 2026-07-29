"""Throwaway CLI: capture meeting audio (via BlackHole), stream it to the
backend's /ws/incoming endpoint, print live captions, and play it back on
a stereo output device with the two languages kept on separate channels:
LEFT ear = live passthrough of the original audio, RIGHT ear = translated
speech. Keeping them on separate channels avoids the two voices mixing
together in your ears.

This exists to validate the incoming pipeline against real audio before
the Electron app is built. Requires the backend running first.

Since this script now delivers the original audio to your ears itself
(left-channel passthrough), point the meeting app's Speaker directly at
"BlackHole 2ch" — no Multi-Output Device needed anymore. If this script
isn't running, you won't hear anything from the call.

Usage:
    python scripts/capture_client.py --device "BlackHole 2ch" --speaker AirPods
    python scripts/capture_client.py --device "MacBook Air Microphone"  # quick mic test

Note: with both BlackHole 2ch and BlackHole 16ch installed, a bare
"blackhole" substring is ambiguous and may match the wrong one (16ch is
the outgoing pipeline's virtual mic and has nothing routed to it for
capture) — always specify "2ch" here.

Extra dependency not in requirements.txt (capture-only, not needed by the
backend service itself):
    pip install sounddevice
"""
import argparse
import asyncio
import json
import sys
import threading

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


class StereoChannelPlayer:
    """Plays two independent mono streams to one stereo output device:
    `push_left` for near-live passthrough, `push_right` for audio that
    arrives later (e.g. after translation). Never mixes the two."""

    def __init__(self, device_index: int) -> None:
        self._left = np.zeros(0, dtype=np.int16)
        self._right = np.zeros(0, dtype=np.int16)
        self._lock = threading.Lock()
        self._stream = sd.OutputStream(
            device=device_index,
            samplerate=SAMPLE_RATE_HZ,
            channels=2,
            dtype="int16",
            blocksize=CHUNK_SAMPLES,
            callback=self._callback,
        )

    def _callback(self, outdata, frames, time_info, status) -> None:
        if status:
            print(f"[playback status] {status}", file=sys.stderr)
        with self._lock:
            left, self._left = self._left[:frames], self._left[frames:]
            right, self._right = self._right[:frames], self._right[frames:]
        outdata[:, 0] = np.pad(left, (0, frames - len(left)))
        outdata[:, 1] = np.pad(right, (0, frames - len(right)))

    def push_left(self, pcm_bytes: bytes) -> None:
        samples = np.frombuffer(pcm_bytes, dtype=np.int16)
        with self._lock:
            self._left = np.concatenate([self._left, samples])

    def push_right(self, pcm_bytes: bytes) -> None:
        samples = np.frombuffer(pcm_bytes, dtype=np.int16)
        with self._lock:
            self._right = np.concatenate([self._right, samples])

    def __enter__(self) -> "StereoChannelPlayer":
        self._stream.start()
        return self

    def __exit__(self, *exc) -> None:
        self._stream.stop()
        self._stream.close()


async def run(device_name: str, speaker_name: str, ws_url: str) -> None:
    device_index = find_device_index(device_name, require_input=True)
    speaker_index = find_device_index(speaker_name, require_input=False)
    print(
        f"Capturing from: {sd.query_devices(device_index)['name']} -> {ws_url} "
        f"-> {sd.query_devices(speaker_index)['name']} (L=original, R=translated)"
    )

    audio_queue: "asyncio.Queue[bytes]" = asyncio.Queue()
    loop = asyncio.get_event_loop()
    player = StereoChannelPlayer(speaker_index)

    def callback(indata, frames, time_info, status) -> None:
        if status:
            print(f"[stream status] {status}", file=sys.stderr)
        mono = indata[:, 0] if indata.ndim > 1 else indata
        pcm16 = np.ascontiguousarray(mono).tobytes()
        player.push_left(pcm16)
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
                    player.push_right(message)
                pending_final = False

        with stream, player:
            await asyncio.gather(sender(), receiver())


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--device", default="BlackHole 2ch", help="Substring to match the input device name")
    parser.add_argument("--speaker", default="AirPods", help="Substring to match the output device name")
    parser.add_argument("--url", default="ws://127.0.0.1:8000/ws/incoming")
    args = parser.parse_args()
    asyncio.run(run(args.device, args.speaker, args.url))
