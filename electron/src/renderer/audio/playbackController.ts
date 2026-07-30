/**
 * Plays discrete PCM16 mono clips (one per finished TTS segment — the
 * backend sends a whole utterance per binary frame, not a stream) to a
 * chosen output device.
 *
 * Routing to a specific device uses the standard `<audio>` element +
 * `setSinkId()` workaround rather than the newer `AudioContext.setSinkId`,
 * which is still experimental/inconsistently supported — see plan notes.
 */
import { SAMPLE_RATE_HZ } from '@convyder/shared/audio-constants';

export interface PlaybackController {
  play: (pcm: ArrayBuffer) => void;
  stop: () => void;
}

function pcm16ToFloat32(pcm: ArrayBuffer): Float32Array {
  const int16 = new Int16Array(pcm);
  const float32 = new Float32Array(int16.length);
  for (let i = 0; i < int16.length; i++) {
    const sample = int16[i];
    float32[i] = sample / (sample < 0 ? 0x8000 : 0x7fff);
  }
  return float32;
}

export async function createPlaybackController(deviceId: string): Promise<PlaybackController> {
  // Deliberately NOT forcing { sampleRate: SAMPLE_RATE_HZ } here — running
  // the context itself at an unusual 16kHz rate while also routing to a
  // *named* (non-default) output device via setSinkId() is a real trouble
  // spot on some Chromium/macOS combinations (silent output, no error at
  // all). We don't need it: createBuffer() below still declares each
  // buffer's own 16kHz rate, and the Web Audio API resamples correctly
  // against whatever rate the context actually runs at regardless.
  const audioContext = new AudioContext();
  // Belt-and-suspenders: a context isn't guaranteed to start 'running'
  // in every environment, and a suspended context schedules playback with
  // no error at all — silent for the user, invisible to us.
  await audioContext.resume();
  const destination = audioContext.createMediaStreamDestination();

  const audioEl = new Audio();
  audioEl.srcObject = destination.stream;
  await audioEl.setSinkId(deviceId);
  await audioEl.play();

  // Segments arrive in the order they were spoken (the backend processes
  // each one fully — STT->MT->TTS->send — before starting the next, and
  // WebSocket preserves message order), but their arrival *times* aren't
  // evenly spaced: a later segment's round-trip can finish while an
  // earlier segment's clip is still playing. Scheduling each clip to
  // start no earlier than when the previous one ends (rather than
  // `source.start()` with no argument, which means "now") keeps playback
  // linear instead of overlapping.
  let nextStartTime = 0;

  function play(pcm: ArrayBuffer): void {
    if (pcm.byteLength === 0) return;
    const float32 = pcm16ToFloat32(pcm);
    const buffer = audioContext.createBuffer(1, float32.length, SAMPLE_RATE_HZ);
    buffer.getChannelData(0).set(float32);
    const source = audioContext.createBufferSource();
    source.buffer = buffer;
    source.connect(destination);

    const startAt = Math.max(audioContext.currentTime, nextStartTime);
    source.start(startAt);
    nextStartTime = startAt + buffer.duration;
  }

  function stop(): void {
    audioEl.pause();
    audioEl.srcObject = null;
    audioContext.close();
  }

  return { play, stop };
}
