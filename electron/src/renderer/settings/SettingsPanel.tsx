import { useEffect, useState } from 'react';
import { LANGUAGE_OPTIONS } from '@convyder/shared/languages';
import type { AppConfig, DirectionLanguageConfig } from '@convyder/shared/config-types';
import { useAudioDevices } from '../audio/useAudioDevices';

interface SettingsPanelProps {
  onDone: () => void;
}

export function SettingsPanel({ onDone }: SettingsPanelProps) {
  const { devices, requestPermission } = useAudioDevices();
  const [config, setConfig] = useState<AppConfig | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    requestPermission();
    window.convyder.config.get().then(setConfig);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!config) {
    return (
      <div className="app-body">
        <p>Loading settings…</p>
      </div>
    );
  }

  const inputDevices = devices.filter((d) => d.kind === 'audioinput');
  const outputDevices = devices.filter((d) => d.kind === 'audiooutput');

  const updateOutgoing = (patch: Partial<DirectionLanguageConfig>) =>
    setConfig((prev) => (prev ? { ...prev, outgoing: { ...prev.outgoing, ...patch } } : prev));
  const updateIncoming = (patch: Partial<DirectionLanguageConfig>) =>
    setConfig((prev) => (prev ? { ...prev, incoming: { ...prev.incoming, ...patch } } : prev));

  const save = async () => {
    setSaving(true);
    await window.convyder.config.set({ ...config, setupComplete: true });
    await window.convyder.backend.restart();
    setSaving(false);
    onDone();
  };

  return (
    <div className="app-body">
      <div className="card">
        <div className="card-header">
          <h2 className="card-title">Settings</h2>
          <button className="btn btn-ghost" onClick={onDone} disabled={saving}>
            Cancel
          </button>
        </div>

        <div className="settings-section">
          <div className="settings-section-title">Outgoing — you speak, meeting hears translated</div>
          <div className="field-row">
            <div className="field">
              <label>You speak</label>
              <select
                value={config.outgoing.spokenLanguageCode}
                onChange={(e) => updateOutgoing({ spokenLanguageCode: e.target.value })}
              >
                {LANGUAGE_OPTIONS.map((l) => (
                  <option key={l.code} value={l.code}>
                    {l.label}
                  </option>
                ))}
              </select>
            </div>
            <div className="field">
              <label>Meeting hears</label>
              <select
                value={config.outgoing.targetLanguageCode}
                onChange={(e) => updateOutgoing({ targetLanguageCode: e.target.value })}
              >
                {LANGUAGE_OPTIONS.map((l) => (
                  <option key={l.code} value={l.code}>
                    {l.label}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <div className="field-row">
            <div className="field">
              <label>Your mic</label>
              <select
                value={config.realMicDeviceId ?? ''}
                onChange={(e) => setConfig({ ...config, realMicDeviceId: e.target.value || null })}
              >
                <option value="">-- select --</option>
                {inputDevices.map((d) => (
                  <option key={d.deviceId} value={d.deviceId}>
                    {d.label}
                  </option>
                ))}
              </select>
            </div>
            <div className="field">
              <label>Virtual mic out</label>
              <select
                value={config.virtualMicOutDeviceId ?? ''}
                onChange={(e) => setConfig({ ...config, virtualMicOutDeviceId: e.target.value || null })}
              >
                <option value="">-- select --</option>
                {outputDevices.map((d) => (
                  <option key={d.deviceId} value={d.deviceId}>
                    {d.label}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <div className="field-hint">Set this as the meeting app&apos;s Microphone.</div>
        </div>

        <div className="settings-section">
          <div className="settings-section-title">Incoming — meeting speaks, you hear translated</div>
          <div className="field-row">
            <div className="field">
              <label>Meeting speaks</label>
              <select
                value={config.incoming.spokenLanguageCode}
                onChange={(e) => updateIncoming({ spokenLanguageCode: e.target.value })}
              >
                {LANGUAGE_OPTIONS.map((l) => (
                  <option key={l.code} value={l.code}>
                    {l.label}
                  </option>
                ))}
              </select>
            </div>
            <div className="field">
              <label>You hear</label>
              <select
                value={config.incoming.targetLanguageCode}
                onChange={(e) => updateIncoming({ targetLanguageCode: e.target.value })}
              >
                {LANGUAGE_OPTIONS.map((l) => (
                  <option key={l.code} value={l.code}>
                    {l.label}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <div className="field-row">
            <div className="field">
              <label>Meeting audio in</label>
              <select
                value={config.meetingAudioInDeviceId ?? ''}
                onChange={(e) => setConfig({ ...config, meetingAudioInDeviceId: e.target.value || null })}
              >
                <option value="">-- select --</option>
                {inputDevices.map((d) => (
                  <option key={d.deviceId} value={d.deviceId}>
                    {d.label}
                  </option>
                ))}
              </select>
            </div>
            <div className="field">
              <label>Your headphones</label>
              <select
                value={config.headphoneDeviceId ?? ''}
                onChange={(e) => setConfig({ ...config, headphoneDeviceId: e.target.value || null })}
              >
                <option value="">-- select --</option>
                {outputDevices.map((d) => (
                  <option key={d.deviceId} value={d.deviceId}>
                    {d.label}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <div className="field-hint">
            Set the meeting app&apos;s Speaker to this device. Left ear = original, right ear = translated.
          </div>
        </div>

        <div className="settings-section">
          <div className="settings-section-title">Sarvam AI (optional)</div>
          <div className="settings-section-desc">
            Better quality than the free default for Indian languages (Hindi, Bengali, Tamil, Telugu, Kannada).
            Needs an API key from sarvam.ai — stored locally on this Mac, sent only to Sarvam&apos;s API.
          </div>
          <div className="field">
            <label>API key</label>
            <input
              type="password"
              value={config.sarvamApiKey ?? ''}
              onChange={(e) => setConfig({ ...config, sarvamApiKey: e.target.value || null })}
              placeholder="Leave blank to use free Whisper for all languages"
            />
          </div>
        </div>

        <div className="settings-actions">
          <button className="btn btn-primary" onClick={save} disabled={saving}>
            {saving ? 'Applying — restarting backend…' : 'Save & Apply'}
          </button>
        </div>
      </div>
    </div>
  );
}
