import workletUrl from './stereo-channel-worklet.js?url';
import { SAMPLE_RATE_HZ } from '@convyder/shared/audio-constants';
import { loadWorkletModule } from './loadWorkletModule';

export interface StereoChannelPlayer {
  pushLeft: (pcm16: ArrayBuffer) => void;
  pushRight: (pcm16: ArrayBuffer) => void;
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

/** Left = near-live passthrough of the original captured audio, right =
 * translated audio arriving later over the wire — see stereo-channel-worklet.ts. */
export async function createStereoChannelPlayer(deviceId: string): Promise<StereoChannelPlayer> {
  const audioContext = new AudioContext({ sampleRate: SAMPLE_RATE_HZ });
  await loadWorkletModule(audioContext, workletUrl);

  const node = new AudioWorkletNode(audioContext, 'stereo-channel-player', {
    numberOfInputs: 0,
    numberOfOutputs: 1,
    outputChannelCount: [2],
  });

  const destination = audioContext.createMediaStreamDestination();
  node.connect(destination);

  const audioEl = new Audio();
  audioEl.srcObject = destination.stream;
  await audioEl.setSinkId(deviceId);
  await audioEl.play();

  function push(channel: 'left' | 'right', pcm16: ArrayBuffer): void {
    if (pcm16.byteLength === 0) return;
    const samples = pcm16ToFloat32(pcm16);
    node.port.postMessage({ channel, samples }, [samples.buffer]);
  }

  return {
    pushLeft: (pcm16) => push('left', pcm16),
    pushRight: (pcm16) => push('right', pcm16),
    stop: () => {
      node.disconnect();
      audioEl.pause();
      audioEl.srcObject = null;
      audioContext.close();
    },
  };
}
