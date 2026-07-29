"""Convyder backend: FastAPI service owning pipeline orchestration.

Currently scaffolds the incoming (captions-only) pipeline only — see
CLAUDE.md build order. Outgoing pipeline, MT, TTS come later.
"""
import logging
import os
from contextlib import asynccontextmanager
from typing import AsyncIterator, Optional

from fastapi import FastAPI, WebSocket, WebSocketDisconnect

from app.pipelines.incoming_pipeline import IncomingPipeline
from app.providers.mt_provider import MTProvider, MockMTProvider
from app.providers.stt_provider import STTProvider, MockSTTProvider

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")

_stt_provider: Optional[STTProvider] = None
_mt_provider: Optional[MTProvider] = None


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncIterator[None]:
    # Both loaded once at startup, not per-connection: real providers do a
    # blocking download/load that would otherwise freeze the event loop
    # long enough to stall the WebSocket handshake.
    global _stt_provider, _mt_provider

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
