"""Convyder backend: FastAPI service owning pipeline orchestration.

Incoming pipeline (captions + translated speech) and outgoing pipeline
(mic -> translated synthesized speech) are both scaffolded — see
CLAUDE.md build order steps 1-2. Diarization, voice cloning, and the
Electron app come later.

Incoming and outgoing are genuinely different directions with
independent language settings, so each gets its own STT/MT/TTS provider
instances, all configurable via env vars — including STT provider choice
per direction (e.g. Sarvam for Indian languages, Whisper otherwise).
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


def _build_stt_provider(provider_name: str, language: str, shared_whisper_model) -> STTProvider:
    if provider_name == "mock":
        return MockSTTProvider()

    if provider_name == "sarvam":
        from app.providers.sarvam_stt_provider import SarvamSTTProvider, TO_SARVAM_LANGUAGE_CODE

        api_key = os.environ.get("SARVAM_API_KEY")
        if not api_key:
            raise RuntimeError("SARVAM_API_KEY is required when *_STT_PROVIDER=sarvam")
        sarvam_language = TO_SARVAM_LANGUAGE_CODE.get(language, f"{language}-IN")
        return SarvamSTTProvider(api_key=api_key, language_code=sarvam_language)

    from app.providers.whisper_stt_provider import WhisperSTTProvider

    return WhisperSTTProvider(model=shared_whisper_model, language=language)


def _build_mt_provider(provider_name: str, source_lang: str, target_lang: str) -> MTProvider:
    if provider_name == "mock":
        return MockMTProvider()

    if provider_name == "sarvam":
        from app.providers.sarvam_mt_provider import SarvamMTProvider
        from app.providers.sarvam_stt_provider import TO_SARVAM_LANGUAGE_CODE

        api_key = os.environ.get("SARVAM_API_KEY")
        if not api_key:
            raise RuntimeError("SARVAM_API_KEY is required when *_MT_PROVIDER=sarvam")
        return SarvamMTProvider(
            api_key=api_key,
            source_lang=TO_SARVAM_LANGUAGE_CODE.get(source_lang, f"{source_lang}-IN"),
            target_lang=TO_SARVAM_LANGUAGE_CODE.get(target_lang, f"{target_lang}-IN"),
        )

    from app.providers.argos_mt_provider import ArgosMTProvider

    return ArgosMTProvider(source_lang=source_lang, target_lang=target_lang)


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncIterator[None]:
    # All loaded once at startup, not per-connection: real providers do a
    # blocking download/load that would otherwise freeze the event loop
    # long enough to stall the WebSocket handshake.
    global _incoming_stt_provider, _incoming_mt_provider, _incoming_tts_provider
    global _outgoing_stt_provider, _outgoing_mt_provider, _outgoing_tts_provider

    incoming_stt_language = os.environ.get("INCOMING_STT_LANGUAGE", "es")
    outgoing_stt_language = os.environ.get("OUTGOING_STT_LANGUAGE", "en")
    incoming_stt_provider_name = os.environ.get("INCOMING_STT_PROVIDER", "whisper")
    outgoing_stt_provider_name = os.environ.get("OUTGOING_STT_PROVIDER", "whisper")

    # One Whisper model shared by both directions when at least one needs
    # it (it's multilingual; only the per-call `language` differs) — avoids
    # loading it at all if both directions use a different provider (e.g.
    # both on Sarvam).
    shared_whisper_model = None
    if "whisper" in (incoming_stt_provider_name, outgoing_stt_provider_name):
        from faster_whisper import WhisperModel

        shared_whisper_model = WhisperModel(
            os.environ.get("WHISPER_MODEL_SIZE", "base"), device="cpu", compute_type="int8"
        )

    _incoming_stt_provider = _build_stt_provider(incoming_stt_provider_name, incoming_stt_language, shared_whisper_model)
    _outgoing_stt_provider = _build_stt_provider(outgoing_stt_provider_name, outgoing_stt_language, shared_whisper_model)

    incoming_mt_source = os.environ.get("INCOMING_MT_SOURCE_LANG", "es")
    incoming_mt_target = os.environ.get("INCOMING_MT_TARGET_LANG", "en")
    outgoing_mt_source = os.environ.get("OUTGOING_MT_SOURCE_LANG", "en")
    outgoing_mt_target = os.environ.get("OUTGOING_MT_TARGET_LANG", "es")
    incoming_mt_provider_name = os.environ.get("INCOMING_MT_PROVIDER", os.environ.get("MT_PROVIDER", "argos"))
    outgoing_mt_provider_name = os.environ.get("OUTGOING_MT_PROVIDER", os.environ.get("MT_PROVIDER", "argos"))

    _incoming_mt_provider = _build_mt_provider(incoming_mt_provider_name, incoming_mt_source, incoming_mt_target)
    _outgoing_mt_provider = _build_mt_provider(outgoing_mt_provider_name, outgoing_mt_source, outgoing_mt_target)

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
