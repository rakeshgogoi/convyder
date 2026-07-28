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
from app.providers.stt_provider import STTProvider, MockSTTProvider

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")

_stt_provider: Optional[STTProvider] = None


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncIterator[None]:
    # Loaded once at startup, not per-connection: WhisperModel init does a
    # blocking download/load that would otherwise freeze the event loop
    # long enough to stall the WebSocket handshake.
    global _stt_provider
    provider_name = os.environ.get("STT_PROVIDER", "whisper")
    if provider_name == "mock":
        _stt_provider = MockSTTProvider()
    else:
        from app.providers.whisper_stt_provider import WhisperSTTProvider

        _stt_provider = WhisperSTTProvider(model_size=os.environ.get("WHISPER_MODEL_SIZE", "base"))
    yield


app = FastAPI(title="Convyder Backend", lifespan=lifespan)


@app.get("/health")
async def health() -> dict:
    return {"status": "ok"}


@app.websocket("/ws/incoming")
async def ws_incoming(websocket: WebSocket) -> None:
    await websocket.accept()
    pipeline = IncomingPipeline(websocket, stt_provider=_stt_provider)
    try:
        while True:
            chunk = await websocket.receive_bytes()
            await pipeline.handle_audio_chunk(chunk)
    except WebSocketDisconnect:
        await pipeline.handle_disconnect()
