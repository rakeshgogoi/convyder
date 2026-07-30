import { useEffect } from 'react';
import { useAudioDevices } from './audio/useAudioDevices';

export function App() {
  const { devices, permissionGranted, error, requestPermission } = useAudioDevices();

  useEffect(() => {
    requestPermission();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (devices.length > 0) {
      console.log('[device-check] devices:', JSON.stringify(devices, null, 2));
    }
  }, [devices]);

  return (
    <div style={{ fontFamily: 'sans-serif', padding: 24 }}>
      <h1>Convyder</h1>
      <p>permissionGranted={String(permissionGranted)} error={error ?? 'none'}</p>
      <ul>
        {devices.map((d) => (
          <li key={`${d.kind}-${d.deviceId}`}>
            [{d.kind}] {d.label || '(no label)'}
          </li>
        ))}
      </ul>
    </div>
  );
}
