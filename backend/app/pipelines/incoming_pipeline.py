"""Incoming direction: meeting-audio loopback -> VAD -> STT -> MT -> TTS ->
translated speech + captions. Multiple speakers are possible on this side
eventually (diarization), but that's not needed for this scaffold.

Wire protocol: a JSON text frame per STT chunk (partial or final). Only
final chunks are followed by one binary frame (raw 16-bit PCM mono audio
of the translated speech).
"""
import itertools
import time

from fastapi import WebSocket

from app.audio.vad import VoiceActivityDetector
from app.pipelines.base_pipeline import BasePipeline
from app.providers.mt_provider import MTProvider
from app.providers.stt_provider import STTProvider
from app.providers.tts_provider import TTSProvider


class IncomingPipeline(BasePipeline):
    def __init__(
        self,
        websocket: WebSocket,
        stt_provider: STTProvider,
        mt_provider: MTProvider,
        tts_provider: TTSProvider,
    ) -> None:
        super().__init__(direction="incoming")
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
            await self._run_stt(segment)

    async def handle_disconnect(self) -> None:
        segment = self.vad.flush()
        if segment is not None:
            await self._run_stt(segment)

    async def _run_stt(self, segment: bytes) -> None:
        segment_id = next(self._segment_ids)
        stt_start = time.perf_counter()

        async for transcript in self.stt_provider.transcribe(segment, segment_id):
            translated_text = None
            audio = None

            if transcript.is_final:
                self.log_duration("stt", segment_id, stt_start)

                mt_start = time.perf_counter()
                translated_text = await self.mt_provider.translate(transcript.text)
                self.log_duration("mt", segment_id, mt_start)

                tts_start = time.perf_counter()
                audio = await self.tts_provider.synthesize(translated_text)
                self.log_duration("tts", segment_id, tts_start)

            await self.websocket.send_json(
                {
                    "type": "transcript",
                    "segment_id": transcript.segment_id,
                    "text": transcript.text,
                    "is_final": transcript.is_final,
                    "translated_text": translated_text,
                }
            )
            if transcript.is_final:
                await self.websocket.send_bytes(audio)
