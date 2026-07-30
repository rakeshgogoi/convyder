import { useCallback, useRef, useState } from 'react';
import type { IncomingTranscriptMessage } from '@convyder/shared/wire-types';
import { startCapture, type CaptureController } from '../audio/captureController';
import { createStereoChannelPlayer, type StereoChannelPlayer } from '../audio/stereoChannelNode';

export interface IncomingCaption {
  segmentId: number;
  text: string;
  translatedText: string | null;
  isFinal: boolean;
}

export type PipelineStatus = 'idle' | 'starting' | 'running' | 'error';

async function waitForBackendReady(): Promise<string | null> {
  let status = await window.convyder.backend.getStatus();
  while (status.status !== 'ready') {
    if (status.status === 'error') return status.detail;
    await new Promise((resolve) => setTimeout(resolve, 500));
    status = await window.convyder.backend.getStatus();
  }
  return null;
}

/** Meeting audio loopback -> translated speech in your headphones (left =
 * near-live original passthrough, right = translated). Owns its own WS
 * connection to /ws/incoming, independent of the outgoing pipeline. */
export function useIncomingPipeline() {
  const [status, setStatus] = useState<PipelineStatus>('idle');
  const [error, setError] = useState<string | null>(null);
  const [captions, setCaptions] = useState<IncomingCaption[]>([]);

  const captureRef = useRef<CaptureController | null>(null);
  const playbackRef = useRef<StereoChannelPlayer | null>(null);
  const wsRef = useRef<WebSocket | null>(null);

  const stop = useCallback(() => {
    captureRef.current?.stop();
    captureRef.current = null;
    playbackRef.current?.stop();
    playbackRef.current = null;
    wsRef.current?.close();
    wsRef.current = null;
    setStatus('idle');
  }, []);

  const start = useCallback(async (meetingAudioInDeviceId: string, headphoneDeviceId: string) => {
    setStatus('starting');
    setError(null);

    const backendError = await waitForBackendReady();
    if (backendError) {
      setStatus('error');
      setError(backendError);
      return;
    }

    try {
      playbackRef.current = await createStereoChannelPlayer(headphoneDeviceId);

      const ws = new WebSocket('ws://127.0.0.1:8000/ws/incoming');
      ws.binaryType = 'arraybuffer';
      wsRef.current = ws;

      ws.onmessage = (event) => {
        if (typeof event.data === 'string') {
          const msg = JSON.parse(event.data) as IncomingTranscriptMessage;
          setCaptions((prev) => {
            const next = [...prev];
            const idx = next.findIndex((c) => c.segmentId === msg.segment_id);
            const caption: IncomingCaption = {
              segmentId: msg.segment_id,
              text: msg.text,
              translatedText: msg.translated_text,
              isFinal: msg.is_final,
            };
            if (idx >= 0) next[idx] = caption;
            else next.push(caption);
            return next.slice(-50);
          });
        } else {
          playbackRef.current?.pushRight(event.data as ArrayBuffer);
        }
      };
      ws.onerror = () => {
        setStatus('error');
        setError('WebSocket error');
      };

      await new Promise<void>((resolve, reject) => {
        ws.addEventListener('open', () => resolve(), { once: true });
        ws.addEventListener('error', () => reject(new Error('WebSocket connection failed')), { once: true });
      });

      captureRef.current = await startCapture(meetingAudioInDeviceId, (chunk) => {
        playbackRef.current?.pushLeft(chunk);
        if (ws.readyState === WebSocket.OPEN) ws.send(chunk);
      });

      setStatus('running');
    } catch (err) {
      stop();
      setStatus('error');
      setError(err instanceof Error ? err.message : String(err));
    }
  }, [stop]);

  return { status, error, captions, start, stop };
}
