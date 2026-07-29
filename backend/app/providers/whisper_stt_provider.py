"""Local, offline STT via faster-whisper. Free, no API key — the default
while STT vendor choice is still open (see CLAUDE.md open items).

Whisper transcribes a whole segment at once rather than streaming tokens,
which fits how VAD already hands us complete speech segments. Audio must
be 16-bit signed PCM, mono, at SAMPLE_RATE_HZ.
"""
import array
import asyncio
from typing import AsyncIterator, Optional

import numpy as np
from faster_whisper import WhisperModel

from app.providers.stt_provider import STTProvider, TranscriptChunk

SAMPLE_RATE_HZ = 16000


def _pcm16_to_float32(audio: bytes) -> np.ndarray:
    usable_len = len(audio) - (len(audio) % 2)
    samples = array.array("h")
    samples.frombytes(audio[:usable_len])
    return np.frombuffer(samples, dtype=np.int16).astype(np.float32) / 32768.0


class WhisperSTTProvider(STTProvider):
    def __init__(
        self,
        model_size: str = "base",
        device: str = "cpu",
        compute_type: str = "int8",
        language: str = "en",
        model: Optional[WhisperModel] = None,
    ) -> None:
        # `model` lets two directions (different `language`) share one
        # loaded WhisperModel instead of doubling memory/load time —
        # the model itself is multilingual; only the transcribe() call
        # is language-pinned.
        self.language = language
        self._model = model or WhisperModel(model_size, device=device, compute_type=compute_type)

    async def transcribe(self, audio: bytes, segment_id: int) -> AsyncIterator[TranscriptChunk]:
        yield TranscriptChunk(segment_id=segment_id, text="...", is_final=False)

        text = await asyncio.to_thread(self._transcribe_sync, audio)
        yield TranscriptChunk(segment_id=segment_id, text=text, is_final=True)

    def _transcribe_sync(self, audio: bytes) -> str:
        audio_np = _pcm16_to_float32(audio)
        segments, _ = self._model.transcribe(
            audio_np,
            language=self.language,
            beam_size=1,
        )
        return " ".join(segment.text.strip() for segment in segments).strip()
