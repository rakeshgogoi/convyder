"""TTS provider interface.

Real vendors/local engines implement `TTSProvider`; `MockTTSProvider` lets
us exercise the pipeline before wiring a real one. Synthesizes a whole
utterance at once, not a token/audio stream.
"""
from abc import ABC, abstractmethod


class TTSProvider(ABC):
    @abstractmethod
    async def synthesize(self, text: str) -> bytes:
        """Return 16-bit signed PCM mono audio for `text`."""
        ...


class MockTTSProvider(TTSProvider):
    async def synthesize(self, text: str) -> bytes:
        return b""
