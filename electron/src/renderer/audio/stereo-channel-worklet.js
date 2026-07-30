/**
 * A pure-source AudioWorkletProcessor (no inputs) that renders two
 * independently-buffered mono streams to stereo output: left = pushed via
 * postMessage({channel:'left', samples}), right = same for 'right'. Ports
 * StereoChannelPlayer from backend/scripts/capture_client.py: on
 * underrun, output stays silent for that channel rather than blocking or
 * glitching — Web Audio pre-zeros output buffers each render quantum, so
 * that falls out for free as long as we only .set() as many samples as
 * we actually have buffered.
 *
 * Plain JS (not TS): this file is loaded via `?url` and executed verbatim
 * in the AudioWorkletGlobalScope, not run through Vite's bundler/transform
 * — see loadWorkletModule.ts and pcm-downsampler-worklet.js.
 */
function concatFloat32(a, b) {
  const out = new Float32Array(a.length + b.length);
  out.set(a, 0);
  out.set(b, a.length);
  return out;
}

class StereoChannelProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.leftBuffer = new Float32Array(0);
    this.rightBuffer = new Float32Array(0);
    this.port.onmessage = (event) => {
      const { channel, samples } = event.data;
      if (channel === 'left') {
        this.leftBuffer = concatFloat32(this.leftBuffer, samples);
      } else {
        this.rightBuffer = concatFloat32(this.rightBuffer, samples);
      }
    };
  }

  process(_inputs, outputs) {
    const [leftOut, rightOut] = outputs[0];
    const frames = leftOut.length;

    const leftTake = Math.min(frames, this.leftBuffer.length);
    leftOut.set(this.leftBuffer.subarray(0, leftTake));
    this.leftBuffer = this.leftBuffer.subarray(leftTake);

    const rightTake = Math.min(frames, this.rightBuffer.length);
    rightOut.set(this.rightBuffer.subarray(0, rightTake));
    this.rightBuffer = this.rightBuffer.subarray(rightTake);

    return true;
  }
}

registerProcessor('stereo-channel-player', StereoChannelProcessor);
