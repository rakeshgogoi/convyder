"""Shared pipeline scaffolding.

Both directions (incoming, outgoing) drive audio through
VAD -> STT -> MT -> TTS and must log per-stage latency the same way —
end-to-end latency is the main risk metric for this product, so this
logging hook stays in place even while MT/TTS are unimplemented.
"""
import logging
import time
from contextlib import contextmanager
from typing import Union

logger = logging.getLogger("convyder.pipeline")


class BasePipeline:
    def __init__(self, direction: str) -> None:
        self.direction = direction

    @contextmanager
    def stage_timer(self, stage: str, segment_id: Union[int, str]):
        """Wrap a pipeline stage (VAD, STT, MT, TTS) to log its duration.

        Works around sync or async code inside the `with` block — only
        the enter/exit timestamps matter, not what happens in between.
        Avoid this around code that yields control back to a caller
        who does unrelated work before resuming it (e.g. an async
        generator whose consumer does its own slow work between
        items) — the elapsed time would wrongly include that. Use
        `log_duration` with a manually captured start time instead.
        """
        start = time.perf_counter()
        try:
            yield
        finally:
            self.log_duration(stage, segment_id, start)

    def log_duration(self, stage: str, segment_id: Union[int, str], start: float) -> None:
        duration_ms = (time.perf_counter() - start) * 1000
        logger.info(
            "direction=%s segment=%s stage=%s duration_ms=%.1f",
            self.direction,
            segment_id,
            stage,
            duration_ms,
        )
