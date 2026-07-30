"""Silence-based VAD stub.

Chunks incoming raw PCM audio (assumed 16-bit signed, mono) into speech
segments by RMS-energy thresholding. Not production-grade — no noise-floor
adaptation, no ML model — but enough to validate the VAD -> STT -> ...
pipeline plumbing end-to-end before swapping in a real VAD later.
"""
import array
from typing import Optional


def _rms(chunk: bytes) -> float:
    usable_len = len(chunk) - (len(chunk) % 2)
    samples = array.array("h")
    samples.frombytes(chunk[:usable_len])
    if not samples:
        return 0.0
    return (sum(s * s for s in samples) / len(samples)) ** 0.5


class VoiceActivityDetector:
    """Feed raw PCM chunks in via `process_chunk`; get back a completed
    speech segment once trailing silence is observed."""

    def __init__(
        self,
        silence_threshold: float = 500.0,
        silence_chunks_to_close: int = 8,
        min_segment_bytes: int = 3200,
        max_segment_bytes: int = 384000,  # ~12s @ 16kHz mono 16-bit
    ) -> None:
        self.silence_threshold = silence_threshold
        self.silence_chunks_to_close = silence_chunks_to_close
        self.min_segment_bytes = min_segment_bytes
        # With no cap, closely-spaced sentences (short pauses that never
        # trip silence_chunks_to_close) accumulate into one ever-growing
        # segment. Observed live: STT (Sarvam) hallucinated a runaway
        # repetition loop on an unusually long segment. Force-flushing at
        # a bounded length keeps segments in the range STT models are
        # actually built for (Sarvam's own sync REST docs cap at 30s) and
        # keeps latency bounded for long/run-on speech.
        self.max_segment_bytes = max_segment_bytes
        self._buffer = bytearray()
        self._in_speech = False
        self._trailing_silence_chunks = 0

    def process_chunk(self, chunk: bytes) -> Optional[bytes]:
        """Returns a completed segment (bytes) once enough trailing silence
        follows speech, else None."""
        if not chunk:
            return None

        is_silent = _rms(chunk) < self.silence_threshold

        if not is_silent:
            self._in_speech = True
            self._trailing_silence_chunks = 0
            self._buffer.extend(chunk)
            if len(self._buffer) >= self.max_segment_bytes:
                return self._flush()
            return None

        if not self._in_speech:
            return None

        self._buffer.extend(chunk)
        self._trailing_silence_chunks += 1
        if self._trailing_silence_chunks >= self.silence_chunks_to_close:
            return self._flush()
        return None

    def flush(self) -> Optional[bytes]:
        """Force-flush buffered audio, e.g. on client disconnect."""
        return self._flush()

    def _flush(self) -> Optional[bytes]:
        segment = bytes(self._buffer) if len(self._buffer) >= self.min_segment_bytes else None
        self._buffer.clear()
        self._in_speech = False
        self._trailing_silence_chunks = 0
        return segment
