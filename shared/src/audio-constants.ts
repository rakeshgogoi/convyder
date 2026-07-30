// Wire-contract reference, kept in sync manually with the backend (Python
// can't import this). Verify against:
//   backend/app/audio/vad.py, backend/scripts/capture_client.py

export const SAMPLE_RATE_HZ = 16000;
export const CHUNK_MS = 20;
export const CHUNK_SAMPLES = (SAMPLE_RATE_HZ * CHUNK_MS) / 1000; // 320
