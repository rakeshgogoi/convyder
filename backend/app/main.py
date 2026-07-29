"""Convyder backend: FastAPI service owning pipeline orchestration.

Incoming pipeline (captions + translation) and outgoing pipeline (mic ->
translated synthesized speech) are both scaffolded — see CLAUDE.md build
order steps 1-2. Diarization, voice cloning, and the Electron app come
later.
"""
import logging
import os
from contextlib import asynccontextmanager
from typing import AsyncIterator, Optional

from fastapi import FastAPI, WebSocket, WebSocketDisconnect

from app.pipelines.incoming_pipeline import IncomingPipeline
from app.pipelines.outgoing_pipeline import OutgoingPipeline
from app.providers.mt_provider import MTProvider, MockMTProvider
from app.providers.stt_provider import STTProvider, MockSTTProvider
from app.providers.tts_provider import TTSProvider, MockTTSProvider

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")

_stt_provider: Optional[STTProvider] = None
_mt_provider: Optional[MTProvider] = None
_tts_provider: Optional[TTSProvider] = None


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncIterator[None]:
    # All loaded once at startup, not per-connection: real providers do a
    # blocking download/load that would otherwise freeze the event loop
    # long enough to stall the WebSocket handshake.
    #
    # The same STT/MT instances are shared by both pipelines below. That's
    # only valid because both currently target EN<->ES (incoming is
    # temporarily testing EN->ES rather than its real ES->EN spec — see
    # CLAUDE.md). Once incoming needs its own direction, split these into
    # per-pipeline instances instead of sharing.
    global _stt_provider, _mt_provider, _tts_provider

    stt_provider_name = os.environ.get("STT_PROVIDER", "whisper")
    if stt_provider_name == "mock":
        _stt_provider = MockSTTProvider()
    else:
        from app.providers.whisper_stt_provider import WhisperSTTProvider

        _stt_provider = WhisperSTTProvider(
            model_size=os.environ.get("WHISPER_MODEL_SIZE", "base"),
            language=os.environ.get("STT_LANGUAGE", "en"),
        )

    mt_provider_name = os.environ.get("MT_PROVIDER", "argos")
    if mt_provider_name == "mock":
        _mt_provider = MockMTProvider()
    else:
        from app.providers.argos_mt_provider import ArgosMTProvider

        _mt_provider = ArgosMTProvider(
            source_lang=os.environ.get("MT_SOURCE_LANG", "en"),
            target_lang=os.environ.get("MT_TARGET_LANG", "es"),
        )

    tts_provider_name = os.environ.get("TTS_PROVIDER", "say")
    if tts_provider_name == "mock":
        _tts_provider = MockTTSProvider()
    else:
        from app.providers.say_tts_provider import SayTTSProvider

        _tts_provider = SayTTSProvider(voice=os.environ.get("TTS_VOICE", "Monica"))

    yield


app = FastAPI(title="Convyder Backend", lifespan=lifespan)


@app.get("/health")
async def health() -> dict:
    return {"status": "ok"}


@app.websocket("/ws/incoming")
async def ws_incoming(websocket: WebSocket) -> None:
    await websocket.accept()
    pipeline = IncomingPipeline(websocket, stt_provider=_stt_provider, mt_provider=_mt_provider)
    try:
        while True:
            chunk = await websocket.receive_bytes()
            await pipeline.handle_audio_chunk(chunk)
    except WebSocketDisconnect:
        await pipeline.handle_disconnect()


@app.websocket("/ws/outgoing")
async def ws_outgoing(websocket: WebSocket) -> None:
    await websocket.accept()
    pipeline = OutgoingPipeline(
        websocket,
        stt_provider=_stt_provider,
        mt_provider=_mt_provider,
        tts_provider=_tts_provider,
    )
    try:
        while True:
            chunk = await websocket.receive_bytes()
            await pipeline.handle_audio_chunk(chunk)
    except WebSocketDisconnect:
        await pipeline.handle_disconnect()
