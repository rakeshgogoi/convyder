// Loaded as a Vite build asset (hashed filename) rather than bundled into
// the renderer chunk — AudioWorklet modules run in their own global scope
// and must be addModule()'d from a real fetchable URL.
import workletUrl from './pcm-downsampler-worklet?url';

export interface CaptureController {
  stop: () => void;
}

/** Captures from `deviceId`, downsamples to 16kHz mono PCM16 in an
 * AudioWorklet, and invokes `onChunk` with each 20ms frame (ArrayBuffer of
 * Int16 samples). Does not touch any WebSocket — that's the caller's job. */
export async function startCapture(
  deviceId: string,
  onChunk: (chunk: ArrayBuffer) => void,
): Promise<CaptureController> {
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: {
      deviceId: { exact: deviceId },
      echoCancellation: false,
      noiseSuppression: false,
      autoGainControl: false,
    },
  });

  const audioContext = new AudioContext();
  await audioContext.audioWorklet.addModule(workletUrl);

  const source = audioContext.createMediaStreamSource(stream);
  const workletNode = new AudioWorkletNode(audioContext, 'pcm-downsampler');
  workletNode.port.onmessage = (event: MessageEvent<ArrayBuffer>) => onChunk(event.data);

  // Intentionally not connected to audioContext.destination — this is a
  // capture-only path, we don't want to hear the raw input locally.
  source.connect(workletNode);

  return {
    stop: () => {
      workletNode.port.onmessage = null;
      source.disconnect();
      workletNode.disconnect();
      stream.getTracks().forEach((track) => track.stop());
      audioContext.close();
    },
  };
}
