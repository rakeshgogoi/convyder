"""Outgoing direction: user mic -> VAD -> STT -> MT -> TTS -> synthesized
audio sent back over the WebSocket. Single speaker (the user), no
diarization needed.

Step 2 of the build order ("generic TTS voice, manually-configured virtual
mic"). This pipeline only produces the synthesized audio — routing it into
an actual virtual mic device is the client's job (see
scripts/playback_client.py, which currently plays it to your own speakers
for validation before wiring up real virtual-mic routing).

Wire protocol per segment: one JSON text frame (metadata) immediately
followed by one binary frame (raw 16-bit PCM mono audio, empty if TTS
produced nothing).
"""
import itertools
import time

from fastapi import WebSocket

from app.audio.vad import VoiceActivityDetector
from app.pipelines.base_pipeline import BasePipeline
from app.providers.mt_provider import MTProvider
from app.providers.stt_provider import STTProvider
from app.providers.tts_provider import TTSProvider


class OutgoingPipeline(BasePipeline):
    def __init__(
        self,
        websocket: WebSocket,
        stt_provider: STTProvider,
        mt_provider: MTProvider,
        tts_provider: TTSProvider,
    ) -> None:
        super().__init__(direction="outgoing")
        self.websocket = websocket
        self.stt_provider = stt_provider
        self.mt_provider = mt_provider
        self.tts_provider = tts_provider
        self.vad = VoiceActivityDetector()
        self._chunk_ids = itertools.count(1)
        self._segment_ids = itertools.count(1)

    async def handle_audio_chunk(self, chunk: bytes) -> None:
        chunk_id = next(self._chunk_ids)
        with self.stage_timer("vad", chunk_id):
            segment = self.vad.process_chunk(chunk)

        if segment is not None:
            await self._run_pipeline(segment)

    async def handle_disconnect(self) -> None:
        segment = self.vad.flush()
        if segment is not None:
            await self._run_pipeline(segment)

    async def _run_pipeline(self, segment: bytes) -> None:
        segment_id = next(self._segment_ids)
        stt_start = time.perf_counter()

        async for transcript in self.stt_provider.transcribe(segment, segment_id):
            if not transcript.is_final:
                continue
            self.log_duration("stt", segment_id, stt_start)

            mt_start = time.perf_counter()
            translated_text = await self.mt_provider.translate(transcript.text)
            self.log_duration("mt", segment_id, mt_start)

            tts_start = time.perf_counter()
            audio = await self.tts_provider.synthesize(translated_text)
            self.log_duration("tts", segment_id, tts_start)

            await self.websocket.send_json(
                {
                    "type": "synthesized_audio",
                    "segment_id": segment_id,
                    "text": transcript.text,
                    "translated_text": translated_text,
                }
            )
            await self.websocket.send_bytes(audio)
