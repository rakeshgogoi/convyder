"""Local TTS via macOS `say` + `afconvert`. Free, no API key, no download —
but macOS-only and robotic-sounding. Good for proving the outgoing
pipeline's shape and latency (CLAUDE.md build order step 2's "generic TTS
voice") before caring about voice quality or cross-platform support.
"""
import asyncio
import os
import subprocess
import tempfile
import wave

from app.providers.tts_provider import TTSProvider

SAMPLE_RATE_HZ = 16000


class SayTTSProvider(TTSProvider):
    def __init__(self, voice: str = "Monica") -> None:
        self.voice = voice

    async def synthesize(self, text: str) -> bytes:
        if not text.strip():
            return b""
        return await asyncio.to_thread(self._synthesize_sync, text)

    def _synthesize_sync(self, text: str) -> bytes:
        with tempfile.TemporaryDirectory() as tmp_dir:
            aiff_path = os.path.join(tmp_dir, "out.aiff")
            wav_path = os.path.join(tmp_dir, "out.wav")

            subprocess.run(
                ["say", "-v", self.voice, "-o", aiff_path, text],
                check=True,
                capture_output=True,
            )
            subprocess.run(
                [
                    "afconvert",
                    "-f", "WAVE",
                    "-d", f"LEI16@{SAMPLE_RATE_HZ}",
                    "-c", "1",
                    aiff_path,
                    wav_path,
                ],
                check=True,
                capture_output=True,
            )
            with wave.open(wav_path, "rb") as wf:
                return wf.readframes(wf.getnframes())
