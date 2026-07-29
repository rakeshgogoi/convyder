"""MT provider interface.

Real vendors/local models implement `MTProvider`; `MockMTProvider` lets us
exercise the pipeline before wiring a real one. Operates on whole (final)
transcript text only — translating a mid-utterance partial isn't useful.
"""
from abc import ABC, abstractmethod


class MTProvider(ABC):
    @abstractmethod
    async def translate(self, text: str) -> str:
        ...


class MockMTProvider(MTProvider):
    async def translate(self, text: str) -> str:
        return f"[mock translation] {text}"
