# Convyder

Real-time voice translation for meetings (Google Meet, Teams). A personal
simultaneous-interpreter app: only the user runs Convyder — no one else in
the meeting needs to install anything.

## Core use case
- User speaks English → meeting participants hear Spanish (via a virtual mic)
- Participants speak Spanish → user hears English (via headphones)
- Two independent, concurrently running streaming pipelines, not a single
  bidirectional one.

## Architecture

- `electron/` — Electron shell. Thin. Handles UI, audio device selection,
  and forwards raw audio to/from the backend over WebSocket. No pipeline
  logic lives here.
- `backend/` — FastAPI service. Owns all pipeline orchestration:
  VAD → STT → MT → TTS, for both directions.
- `shared/` — Shared type definitions between Electron (TS) and backend (Python).

### Pipelines
- `outgoing_pipeline.py` — EN mic → ES virtual mic. Single speaker (the
  user), no diarization needed.
- `incoming_pipeline.py` — ES system-audio loopback → EN headphones.
  Multiple speakers possible — needs diarization eventually, not in v1.
- Both inherit from `base_pipeline.py`, which handles VAD chunking and
  exposes per-stage latency logging hooks. Always keep latency logging in
  place — end-to-end latency is the main risk metric for this product.

### Audio routing (critical constraint)
Three distinct audio channels, never let them cross:
1. Real mic → outgoing pipeline only
2. Outgoing pipeline's synthesized speech → virtual mic device → meeting app
3. Meeting app's output audio → loopback capture → incoming pipeline →
   user's headphones only (must never feed back into the virtual mic)

Platform-specific virtual devices: VB-Cable (Windows), BlackHole (macOS),
PulseAudio/PipeWire null sink (Linux). Don't attempt to write a custom audio
driver — integrate with these existing ones.

## Build order (don't skip ahead)
1. Incoming pipeline only, captions-only (no TTS) — validates STT→MT
   streaming latency with zero audio-routing risk.
2. Outgoing pipeline with a generic TTS voice, manually-configured virtual
   mic — validates the full loop into an actual Meet/Teams call.
3. Add diarization to incoming, voice cloning to outgoing.
4. Build the `DeviceSetup.tsx` first-run wizard once the manual setup is
   proven to work.

## Conventions
- Provider integrations (STT/MT/TTS) go behind an interface
  (`stt_provider.py`, `mt_provider.py`, `tts_provider.py`) so vendors can be
  swapped without touching pipeline logic.
- Prefer streaming APIs at every stage over batch — latency budget target
  is under ~2s end-to-end per direction.
- Log per-stage latency (STT time, MT time, TTS time) on every processed
  segment during development; this data drives provider selection later.

## Not yet decided / open items
- Final STT/MT/TTS vendor choices
- Voice cloning approach for the outgoing pipeline
- Feedback-loop detection strategy (preventing the outgoing pipeline's own
  synthesized voice from re-entering via loopback)
