"""Convyder backend: FastAPI service owning pipeline orchestration.

Incoming pipeline (captions + translated speech) and outgoing pipeline
(mic -> translated synthesized speech) are both scaffolded — see
CLAUDE.md build order steps 1-2. Diarization, voice cloning, and the
Electron app come later.

Incoming is ES->EN (hear meeting participants in English) and outgoing is
EN->ES (participants hear you in Spanish) — genuinely different
directions, so each gets its own STT/MT/TTS provider instances, all
configurable via env vars.
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

_incoming_stt_provider: Optional[STTProvider] = None
_incoming_mt_provider: Optional[MTProvider] = None
_incoming_tts_provider: Optional[TTSProvider] = None
_outgoing_stt_provider: Optional[STTProvider] = None
_outgoing_mt_provider: Optional[MTProvider] = None
_outgoing_tts_provider: Optional[TTSProvider] = None


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncIterator[None]:
    # All loaded once at startup, not per-connection: real providers do a
    # blocking download/load that would otherwise freeze the event loop
    # long enough to stall the WebSocket handshake.
    global _incoming_stt_provider, _incoming_mt_provider, _incoming_tts_provider
    global _outgoing_stt_provider, _outgoing_mt_provider, _outgoing_tts_provider

    stt_provider_name = os.environ.get("STT_PROVIDER", "whisper")
    if stt_provider_name == "mock":
        _incoming_stt_provider = MockSTTProvider()
        _outgoing_stt_provider = MockSTTProvider()
    else:
        from faster_whisper import WhisperModel

        from app.providers.whisper_stt_provider import WhisperSTTProvider

        # One model shared by both directions (it's multilingual; only the
        # per-call `language` differs) to avoid loading it twice.
        shared_model = WhisperModel(
            os.environ.get("WHISPER_MODEL_SIZE", "base"), device="cpu", compute_type="int8"
        )
        _incoming_stt_provider = WhisperSTTProvider(
            model=shared_model, language=os.environ.get("INCOMING_STT_LANGUAGE", "es")
        )
        _outgoing_stt_provider = WhisperSTTProvider(
            model=shared_model, language=os.environ.get("OUTGOING_STT_LANGUAGE", "en")
        )

    mt_provider_name = os.environ.get("MT_PROVIDER", "argos")
    if mt_provider_name == "mock":
        _incoming_mt_provider = MockMTProvider()
        _outgoing_mt_provider = MockMTProvider()
    else:
        from app.providers.argos_mt_provider import ArgosMTProvider

        _incoming_mt_provider = ArgosMTProvider(
            source_lang=os.environ.get("INCOMING_MT_SOURCE_LANG", "es"),
            target_lang=os.environ.get("INCOMING_MT_TARGET_LANG", "en"),
        )
        _outgoing_mt_provider = ArgosMTProvider(
            source_lang=os.environ.get("OUTGOING_MT_SOURCE_LANG", "en"),
            target_lang=os.environ.get("OUTGOING_MT_TARGET_LANG", "es"),
        )

    tts_provider_name = os.environ.get("TTS_PROVIDER", "say")
    if tts_provider_name == "mock":
        _incoming_tts_provider = MockTTSProvider()
        _outgoing_tts_provider = MockTTSProvider()
    else:
        from app.providers.say_tts_provider import SayTTSProvider

        _incoming_tts_provider = SayTTSProvider(voice=os.environ.get("INCOMING_TTS_VOICE", "Samantha"))
        _outgoing_tts_provider = SayTTSProvider(voice=os.environ.get("OUTGOING_TTS_VOICE", "Monica"))

    yield


app = FastAPI(title="Convyder Backend", lifespan=lifespan)


@app.get("/health")
async def health() -> dict:
    return {"status": "ok"}


@app.websocket("/ws/incoming")
async def ws_incoming(websocket: WebSocket) -> None:
    await websocket.accept()
    pipeline = IncomingPipeline(
        websocket,
        stt_provider=_incoming_stt_provider,
        mt_provider=_incoming_mt_provider,
        tts_provider=_incoming_tts_provider,
    )
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
        stt_provider=_outgoing_stt_provider,
        mt_provider=_outgoing_mt_provider,
        tts_provider=_outgoing_tts_provider,
    )
    try:
        while True:
            chunk = await websocket.receive_bytes()
            await pipeline.handle_audio_chunk(chunk)
    except WebSocketDisconnect:
        await pipeline.handle_disconnect()
