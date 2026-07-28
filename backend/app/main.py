"""Convyder backend: FastAPI service owning pipeline orchestration.

Currently scaffolds the incoming (captions-only) pipeline only — see
CLAUDE.md build order. Outgoing pipeline, MT, TTS, and real STT providers
come later.
"""
import logging

from fastapi import FastAPI, WebSocket, WebSocketDisconnect

from app.pipelines.incoming_pipeline import IncomingPipeline
from app.providers.stt_provider import MockSTTProvider

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")

app = FastAPI(title="Convyder Backend")


@app.get("/health")
async def health() -> dict:
    return {"status": "ok"}


@app.websocket("/ws/incoming")
async def ws_incoming(websocket: WebSocket) -> None:
    await websocket.accept()
    pipeline = IncomingPipeline(websocket, stt_provider=MockSTTProvider())
    try:
        while True:
            chunk = await websocket.receive_bytes()
            await pipeline.handle_audio_chunk(chunk)
    except WebSocketDisconnect:
        await pipeline.handle_disconnect()
