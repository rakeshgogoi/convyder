"""Sarvam AI STT (Saaras v3) — specialized for Indian languages, notably
better quality than Whisper's `base` model for them (see the Hindi
mis-transcription issues hit earlier). Needs a Sarvam API key
(https://www.sarvam.ai/), not free.

REST API: POST https://api.sarvam.ai/speech-to-text, multipart form
(model, mode, language_code, file), auth via the `api-subscription-key`
header. `mode=transcribe` keeps output in the original language, matching
how MT is a separate stage in this codebase (unlike `mode=translate`,
which would translate straight to English and break that separation).
"""
import asyncio
import io
import wave
from typing import AsyncIterator

import requests

from app.providers.stt_provider import STTProvider, TranscriptChunk

SARVAM_STT_URL = "https://api.sarvam.ai/speech-to-text"
SAMPLE_RATE_HZ = 16000

# Our internal 2-letter language codes (matching Whisper/Argos) -> Sarvam's
# BCP-47-style codes. Source: https://docs.sarvam.ai (Saaras v3 supported
# source languages).
TO_SARVAM_LANGUAGE_CODE = {
    "hi": "hi-IN",
    "bn": "bn-IN",
    "kn": "kn-IN",
    "ml": "ml-IN",
    "mr": "mr-IN",
    "or": "od-IN",
    "pa": "pa-IN",
    "ta": "ta-IN",
    "te": "te-IN",
    "gu": "gu-IN",
    "en": "en-IN",
}


def _pcm16_to_wav_bytes(pcm: bytes) -> bytes:
    buf = io.BytesIO()
    with wave.open(buf, "wb") as wf:
        wf.setnchannels(1)
        wf.setsampwidth(2)
        wf.setframerate(SAMPLE_RATE_HZ)
        wf.writeframes(pcm)
    return buf.getvalue()


class SarvamSTTProvider(STTProvider):
    def __init__(self, api_key: str, language_code: str = "hi-IN", model: str = "saaras:v3") -> None:
        self.api_key = api_key
        self.language_code = language_code
        self.model = model

    async def transcribe(self, audio: bytes, segment_id: int) -> AsyncIterator[TranscriptChunk]:
        yield TranscriptChunk(segment_id=segment_id, text="...", is_final=False)
        text = await asyncio.to_thread(self._transcribe_sync, audio)
        yield TranscriptChunk(segment_id=segment_id, text=text, is_final=True)

    def _transcribe_sync(self, audio: bytes) -> str:
        wav_bytes = _pcm16_to_wav_bytes(audio)
        response = requests.post(
            SARVAM_STT_URL,
            headers={"api-subscription-key": self.api_key},
            data={"model": self.model, "mode": "transcribe", "language_code": self.language_code},
            files={"file": ("audio.wav", wav_bytes, "audio/wav")},
            timeout=15,
        )
        response.raise_for_status()
        return (response.json().get("transcript") or "").strip()
