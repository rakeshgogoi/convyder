import { useCallback, useRef, useState } from 'react';
import type { OutgoingSynthesizedAudioMessage } from '@convyder/shared/wire-types';
import { startCapture, type CaptureController } from '../audio/captureController';
import { createPlaybackController, type PlaybackController } from '../audio/playbackController';

export interface OutgoingCaption {
  segmentId: number;
  text: string;
  translatedText: string;
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

/** EN mic -> translated speech sent to the meeting's virtual mic. Owns its
 * own WS connection to /ws/outgoing, independent of the incoming pipeline
 * (see CLAUDE.md: two independent pipelines, not one bidirectional one). */
export function useOutgoingPipeline() {
  const [status, setStatus] = useState<PipelineStatus>('idle');
  const [error, setError] = useState<string | null>(null);
  const [captions, setCaptions] = useState<OutgoingCaption[]>([]);

  const captureRef = useRef<CaptureController | null>(null);
  const playbackRef = useRef<PlaybackController | null>(null);
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

  const start = useCallback(async (micDeviceId: string, virtualMicOutDeviceId: string) => {
    setStatus('starting');
    setError(null);

    const backendError = await waitForBackendReady();
    if (backendError) {
      setStatus('error');
      setError(backendError);
      return;
    }

    try {
      playbackRef.current = await createPlaybackController(virtualMicOutDeviceId);

      const ws = new WebSocket('ws://127.0.0.1:8000/ws/outgoing');
      ws.binaryType = 'arraybuffer';
      wsRef.current = ws;

      let pendingHeader: OutgoingSynthesizedAudioMessage | null = null;
      ws.onmessage = (event) => {
        if (typeof event.data === 'string') {
          const msg = JSON.parse(event.data) as OutgoingSynthesizedAudioMessage;
          pendingHeader = msg;
          setCaptions((prev) =>
            [...prev, { segmentId: msg.segment_id, text: msg.text, translatedText: msg.translated_text }].slice(-50),
          );
        } else if (pendingHeader) {
          playbackRef.current?.play(event.data as ArrayBuffer);
          pendingHeader = null;
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

      captureRef.current = await startCapture(micDeviceId, (chunk) => {
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
