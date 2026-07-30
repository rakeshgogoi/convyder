/**
 * A pure-source AudioWorkletProcessor (no inputs) that renders two
 * independently-buffered mono streams to stereo output: left = pushed via
 * postMessage({channel:'left', samples}), right = same for 'right'. Ports
 * StereoChannelPlayer from backend/scripts/capture_client.py: on
 * underrun, output stays silent for that channel rather than blocking or
 * glitching — Web Audio pre-zeros output buffers each render quantum, so
 * that falls out for free as long as we only .set() as many samples as
 * we actually have buffered.
 */
function concatFloat32(
  a: Float32Array<ArrayBufferLike>,
  b: Float32Array<ArrayBufferLike>,
): Float32Array<ArrayBufferLike> {
  const out = new Float32Array(a.length + b.length);
  out.set(a, 0);
  out.set(b, a.length);
  return out;
}

class StereoChannelProcessor extends AudioWorkletProcessor {
  private leftBuffer: Float32Array<ArrayBufferLike> = new Float32Array(0);
  private rightBuffer: Float32Array<ArrayBufferLike> = new Float32Array(0);

  constructor() {
    super();
    this.port.onmessage = (event: MessageEvent<{ channel: 'left' | 'right'; samples: Float32Array }>) => {
      const { channel, samples } = event.data;
      if (channel === 'left') {
        this.leftBuffer = concatFloat32(this.leftBuffer, samples);
      } else {
        this.rightBuffer = concatFloat32(this.rightBuffer, samples);
      }
    };
  }

  process(_inputs: Float32Array[][], outputs: Float32Array[][]): boolean {
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
