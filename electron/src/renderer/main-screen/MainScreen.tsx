import { useEffect, useState } from 'react';
import { useAudioDevices } from '../audio/useAudioDevices';
import { useIncomingPipeline } from '../pipelines/useIncomingPipeline';
import { useOutgoingPipeline } from '../pipelines/useOutgoingPipeline';

export function MainScreen() {
  const { devices, permissionGranted, requestPermission } = useAudioDevices();
  const [micDeviceId, setMicDeviceId] = useState('');
  const [virtualMicOutDeviceId, setVirtualMicOutDeviceId] = useState('');
  const [meetingAudioInDeviceId, setMeetingAudioInDeviceId] = useState('');
  const [headphoneDeviceId, setHeadphoneDeviceId] = useState('');

  const outgoing = useOutgoingPipeline();
  const incoming = useIncomingPipeline();

  useEffect(() => {
    requestPermission();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const inputDevices = devices.filter((d) => d.kind === 'audioinput');
  const outputDevices = devices.filter((d) => d.kind === 'audiooutput');

  return (
    <div style={{ fontFamily: 'sans-serif', padding: 24, maxWidth: 720 }}>
      <h1>Convyder</h1>
      <p>Mic permission granted: {String(permissionGranted)}</p>

      <fieldset style={{ marginBottom: 16 }}>
        <legend>Outgoing — you speak, meeting hears translated</legend>
        <div>
          <label>
            Your mic:{' '}
            <select value={micDeviceId} onChange={(e) => setMicDeviceId(e.target.value)}>
              <option value="">-- select --</option>
              {inputDevices.map((d) => (
                <option key={d.deviceId} value={d.deviceId}>
                  {d.label}
                </option>
              ))}
            </select>
          </label>
        </div>
        <div>
          <label>
            Virtual mic out (set this as the meeting app&apos;s Microphone):{' '}
            <select value={virtualMicOutDeviceId} onChange={(e) => setVirtualMicOutDeviceId(e.target.value)}>
              <option value="">-- select --</option>
              {outputDevices.map((d) => (
                <option key={d.deviceId} value={d.deviceId}>
                  {d.label}
                </option>
              ))}
            </select>
          </label>
        </div>
        <button
          style={{ marginTop: 8 }}
          disabled={outgoing.status === 'starting' || (!micDeviceId && outgoing.status !== 'running')}
          onClick={() =>
            outgoing.status === 'running' ? outgoing.stop() : outgoing.start(micDeviceId, virtualMicOutDeviceId)
          }
        >
          {outgoing.status === 'running' ? 'Stop' : 'Start'} outgoing
        </button>
        <p>
          Status: {outgoing.status}
          {outgoing.error ? ` — ${outgoing.error}` : ''}
        </p>
        <div style={{ maxHeight: 150, overflow: 'auto', background: '#f7f7f7', padding: 8, fontSize: 13 }}>
          {outgoing.captions.map((c) => (
            <div key={c.segmentId}>
              {c.text} → {c.translatedText}
            </div>
          ))}
        </div>
      </fieldset>

      <fieldset>
        <legend>Incoming — meeting speaks, you hear translated</legend>
        <div>
          <label>
            Meeting audio in (loopback capture — meeting app&apos;s Speaker must point here):{' '}
            <select value={meetingAudioInDeviceId} onChange={(e) => setMeetingAudioInDeviceId(e.target.value)}>
              <option value="">-- select --</option>
              {inputDevices.map((d) => (
                <option key={d.deviceId} value={d.deviceId}>
                  {d.label}
                </option>
              ))}
            </select>
          </label>
        </div>
        <div>
          <label>
            Your headphones (left = original, right = translated):{' '}
            <select value={headphoneDeviceId} onChange={(e) => setHeadphoneDeviceId(e.target.value)}>
              <option value="">-- select --</option>
              {outputDevices.map((d) => (
                <option key={d.deviceId} value={d.deviceId}>
                  {d.label}
                </option>
              ))}
            </select>
          </label>
        </div>
        <button
          style={{ marginTop: 8 }}
          disabled={incoming.status === 'starting' || (!meetingAudioInDeviceId && incoming.status !== 'running')}
          onClick={() =>
            incoming.status === 'running'
              ? incoming.stop()
              : incoming.start(meetingAudioInDeviceId, headphoneDeviceId)
          }
        >
          {incoming.status === 'running' ? 'Stop' : 'Start'} incoming
        </button>
        <p>
          Status: {incoming.status}
          {incoming.error ? ` — ${incoming.error}` : ''}
        </p>
        <div style={{ maxHeight: 150, overflow: 'auto', background: '#f7f7f7', padding: 8, fontSize: 13 }}>
          {incoming.captions.map((c) => (
            <div key={c.segmentId}>
              {c.text} {c.translatedText ? `→ ${c.translatedText}` : ''} {c.isFinal ? '' : '…'}
            </div>
          ))}
        </div>
      </fieldset>
    </div>
  );
}
