import { useEffect, useRef, useState } from 'react';
import { useAudioDevices } from './audio/useAudioDevices';
import { startCapture, type CaptureController } from './audio/captureController';
import { createPlaybackController, type PlaybackController } from './audio/playbackController';

export function App() {
  const { devices, permissionGranted, error, requestPermission } = useAudioDevices();
  const [micDeviceId, setMicDeviceId] = useState('');
  const [speakerDeviceId, setSpeakerDeviceId] = useState('');
  const [log, setLog] = useState<string[]>([]);
  const captureRef = useRef<CaptureController | null>(null);
  const playbackRef = useRef<PlaybackController | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const chunkCountRef = useRef(0);

  useEffect(() => {
    requestPermission();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!micDeviceId) {
      const preferred =
        devices.find((d) => d.kind === 'audioinput' && d.label.includes('BlackHole 2ch')) ??
        devices.find((d) => d.kind === 'audioinput' && d.label);
      if (preferred) setMicDeviceId(preferred.deviceId);
    }
    if (!speakerDeviceId) {
      const preferred =
        devices.find((d) => d.kind === 'audiooutput' && d.label.includes('BlackHole 16ch')) ??
        devices.find((d) => d.kind === 'audiooutput' && d.label);
      if (preferred) setSpeakerDeviceId(preferred.deviceId);
    }
  }, [devices, micDeviceId, speakerDeviceId]);

  useEffect(() => {
    if (micDeviceId && speakerDeviceId && !captureRef.current) {
      startTest();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [micDeviceId, speakerDeviceId]);

  const appendLog = (line: string) => {
    console.log(line);
    setLog((prev) => [...prev.slice(-30), line]);
  };

  const startTest = async () => {
    appendLog('[backend] waiting for ready...');
    let status = await window.convyder.backend.getStatus();
    while (status.status !== 'ready') {
      if (status.status === 'error') {
        appendLog(`[backend] error: ${status.detail}`);
        return;
      }
      await new Promise((resolve) => setTimeout(resolve, 500));
      status = await window.convyder.backend.getStatus();
    }
    appendLog('[backend] ready');

    playbackRef.current = await createPlaybackController(speakerDeviceId);
    appendLog(`[playback] controller ready for device ${speakerDeviceId}`);

    const ws = new WebSocket('ws://127.0.0.1:8000/ws/outgoing');
    ws.binaryType = 'arraybuffer';
    wsRef.current = ws;
    chunkCountRef.current = 0;

    ws.onopen = () => appendLog('[ws] open');
    ws.onclose = () => appendLog('[ws] closed');
    ws.onerror = () => appendLog('[ws] error');
    ws.onmessage = (event) => {
      if (typeof event.data === 'string') {
        appendLog(`[ws] json: ${event.data}`);
      } else {
        const buf = event.data as ArrayBuffer;
        appendLog(`[ws] binary: ${buf.byteLength} bytes`);
        playbackRef.current?.play(buf);
      }
    };

    await new Promise<void>((resolve) => {
      ws.addEventListener('open', () => resolve(), { once: true });
    });

    captureRef.current = await startCapture(micDeviceId, (chunk) => {
      chunkCountRef.current += 1;
      if (chunkCountRef.current % 25 === 0) {
        appendLog(`[capture] sent ${chunkCountRef.current} chunks, last size=${chunk.byteLength} bytes`);
      }
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(chunk);
      }
    });
  };

  const stopTest = () => {
    captureRef.current?.stop();
    captureRef.current = null;
    playbackRef.current?.stop();
    playbackRef.current = null;
    wsRef.current?.close();
    wsRef.current = null;
  };

  return (
    <div style={{ fontFamily: 'sans-serif', padding: 24 }}>
      <h1>Convyder — capture path test</h1>
      <p>permissionGranted={String(permissionGranted)} error={error ?? 'none'}</p>

      <label>
        Mic device:{' '}
        <select value={micDeviceId} onChange={(e) => setMicDeviceId(e.target.value)}>
          {devices
            .filter((d) => d.kind === 'audioinput')
            .map((d) => (
              <option key={d.deviceId} value={d.deviceId}>
                {d.label || d.deviceId}
              </option>
            ))}
        </select>
      </label>

      <div style={{ marginTop: 12 }}>
        <button onClick={startTest} disabled={!micDeviceId}>
          Start capture -&gt; /ws/outgoing
        </button>{' '}
        <button onClick={stopTest}>Stop</button>
      </div>

      <pre style={{ marginTop: 16, fontSize: 12, background: '#eee', padding: 8, height: 300, overflow: 'auto' }}>
        {log.join('\n')}
      </pre>
    </div>
  );
}
