/**
 * AudioWorkletProcessor: downmixes to mono, resamples the device's native
 * sample rate down to SAMPLE_RATE_HZ, converts Float32 -> Int16, and
 * buffers up from the worklet's native 128-sample render quantum into
 * CHUNK_SAMPLES (320 = 20ms @ 16kHz) frames before posting each one to the
 * main thread — matching the framing backend/scripts/capture_client.py
 * already sends.
 *
 * Resampling is simple fractional-accumulator decimation, not a proper
 * anti-aliased resample — no different in spirit from the Python VAD's
 * RMS-threshold stub elsewhere in this codebase: adequate for speech/STT
 * input, not audiophile-grade.
 *
 * Plain JS (not TS): this file is loaded via `?url` and executed verbatim
 * in the AudioWorkletGlobalScope, not run through Vite's bundler/transform
 * — see loadWorkletModule.ts. So it can't use TS-only syntax or import
 * from `shared/`; SAMPLE_RATE_HZ/CHUNK_SAMPLES are duplicated below,
 * kept in sync manually with shared/src/audio-constants.ts.
 */
const SAMPLE_RATE_HZ = 16000;
const CHUNK_SAMPLES = 320;

class PcmDownsamplerProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.outputBuffer = new Int16Array(CHUNK_SAMPLES);
    this.writeIndex = 0;
    this.resampleAccumulator = 0;
    // `sampleRate` is a global in AudioWorkletGlobalScope (the context's
    // native rate, e.g. 48000).
    this.resampleRatio = sampleRate / SAMPLE_RATE_HZ;
  }

  process(inputs) {
    const input = inputs[0];
    if (!input || input.length === 0) return true;

    const numChannels = input.length;
    const frameCount = input[0]?.length ?? 0;

    for (let i = 0; i < frameCount; i++) {
      let sum = 0;
      for (let ch = 0; ch < numChannels; ch++) {
        sum += input[ch][i];
      }
      const monoSample = sum / numChannels;

      this.resampleAccumulator += 1;
      if (this.resampleAccumulator < this.resampleRatio) continue;
      this.resampleAccumulator -= this.resampleRatio;

      const clamped = Math.max(-1, Math.min(1, monoSample));
      this.outputBuffer[this.writeIndex] = clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff;
      this.writeIndex++;

      if (this.writeIndex >= CHUNK_SAMPLES) {
        // postMessage structured-clones (copies) the buffer by default
        // since it's not in a transfer list, so reusing outputBuffer for
        // the next frame is safe.
        this.port.postMessage(this.outputBuffer.buffer);
        this.writeIndex = 0;
      }
    }

    return true;
  }
}

registerProcessor('pcm-downsampler', PcmDownsamplerProcessor);
