import { useCallback, useEffect, useState } from 'react';

export interface AudioDeviceInfo {
  deviceId: string;
  label: string;
  kind: 'audioinput' | 'audiooutput';
}

/** Device labels are blank until some getUserMedia grant happens in this
 * session (Chromium privacy behavior) — call requestPermission() before
 * relying on real labels being present. */
export function useAudioDevices() {
  const [devices, setDevices] = useState<AudioDeviceInfo[]>([]);
  const [permissionGranted, setPermissionGranted] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const all = await navigator.mediaDevices.enumerateDevices();
    setDevices(
      all
        .filter((d) => d.kind === 'audioinput' || d.kind === 'audiooutput')
        .map((d) => ({ deviceId: d.deviceId, label: d.label, kind: d.kind as 'audioinput' | 'audiooutput' })),
    );
  }, []);

  const requestPermission = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      stream.getTracks().forEach((t) => t.stop());
      setPermissionGranted(true);
      setError(null);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, [refresh]);

  useEffect(() => {
    refresh();
    navigator.mediaDevices.addEventListener('devicechange', refresh);
    return () => navigator.mediaDevices.removeEventListener('devicechange', refresh);
  }, [refresh]);

  return { devices, permissionGranted, error, requestPermission };
}
