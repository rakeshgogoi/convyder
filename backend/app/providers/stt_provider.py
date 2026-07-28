"""STT provider interface.

Real vendors (Deepgram, Whisper, Google STT, ...) implement `STTProvider`
so pipeline code never depends on a specific vendor SDK. `MockSTTProvider`
lets us exercise the WebSocket plumbing before any real API key exists.
"""
import asyncio
from abc import ABC, abstractmethod
from typing import AsyncIterator

from pydantic import BaseModel


class TranscriptChunk(BaseModel):
    segment_id: int
    text: str
    is_final: bool


class STTProvider(ABC):
    @abstractmethod
    async def transcribe(self, audio: bytes, segment_id: int) -> AsyncIterator[TranscriptChunk]:
        """Stream transcript chunks for one speech segment, ending with
        exactly one chunk where is_final=True."""
        raise NotImplementedError
        yield  # pragma: no cover - makes this an async generator for type checkers


class MockSTTProvider(STTProvider):
    """Echoes a fake partial then a fake final transcript after short
    delays, to simulate a streaming STT vendor without calling one."""

    def __init__(self, partial_delay: float = 0.2, final_delay: float = 0.4) -> None:
        self.partial_delay = partial_delay
        self.final_delay = final_delay

    async def transcribe(self, audio: bytes, segment_id: int) -> AsyncIterator[TranscriptChunk]:
        await asyncio.sleep(self.partial_delay)
        yield TranscriptChunk(
            segment_id=segment_id,
            text="...",
            is_final=False,
        )

        await asyncio.sleep(self.final_delay)
        yield TranscriptChunk(
            segment_id=segment_id,
            text=f"[mock transcript: segment {segment_id}, {len(audio)} bytes of audio]",
            is_final=True,
        )
