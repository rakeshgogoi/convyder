// Wire-contract reference, kept in sync manually with the backend (Python
// can't import this — there's no codegen). Verify against:
//   backend/app/providers/stt_provider.py       (TranscriptChunk)
//   backend/app/pipelines/incoming_pipeline.py  (send_json call site)
//   backend/app/pipelines/outgoing_pipeline.py  (send_json call site)
//
// Both endpoints accept raw binary PCM frames from the client continuously
// (mono, 16-bit signed, SAMPLE_RATE_HZ — see audio-constants.ts). Server
// replies differ per endpoint, below.

/** ws://.../ws/incoming — one JSON frame per STT chunk (partial or final).
 * Only when is_final is true, this frame is immediately followed by one
 * binary WS frame: raw PCM of the translated speech (may be empty bytes). */
export interface IncomingTranscriptMessage {
  type: 'transcript';
  segment_id: number;
  text: string;
  is_final: boolean;
  translated_text: string | null; // non-null only when is_final
}

/** ws://.../ws/outgoing — one JSON frame per finished (final-only) segment,
 * always immediately followed by one binary WS frame: raw PCM of the
 * synthesized speech (may be empty bytes if TTS produced nothing). */
export interface OutgoingSynthesizedAudioMessage {
  type: 'synthesized_audio';
  segment_id: number;
  text: string;
  translated_text: string;
}
