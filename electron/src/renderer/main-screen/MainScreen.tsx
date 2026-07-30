import { useEffect, useState } from 'react';
import { findLanguageOption } from '@convyder/shared/languages';
import type { AppConfig } from '@convyder/shared/config-types';
import type { BackendStatus } from '../../main/backend-process';
import { useIncomingPipeline } from '../pipelines/useIncomingPipeline';
import { useOutgoingPipeline } from '../pipelines/useOutgoingPipeline';
import { StatusBadge } from './StatusBadge';

function languageLabel(code: string): string {
  return findLanguageOption(code)?.label ?? code;
}

function BackendStatusBadge({ status }: { status: BackendStatus }) {
  if (status.status === 'ready') return <span className="status-badge running"><span className="dot" />Backend ready</span>;
  if (status.status === 'starting') return <span className="status-badge starting"><span className="dot" />Backend starting…</span>;
  if (status.status === 'error') return <span className="status-badge error" title={status.detail}><span className="dot" />Backend error</span>;
  return <span className="status-badge idle"><span className="dot" />Backend stopped</span>;
}

interface MainScreenProps {
  onOpenSettings: () => void;
}

export function MainScreen({ onOpenSettings }: MainScreenProps) {
  const [config, setConfig] = useState<AppConfig | null>(null);
  const [backendStatus, setBackendStatus] = useState<BackendStatus>({ status: 'starting' });

  const outgoing = useOutgoingPipeline();
  const incoming = useIncomingPipeline();

  useEffect(() => {
    window.convyder.config.get().then(setConfig);
    window.convyder.backend.getStatus().then(setBackendStatus);
    const unsubscribe = window.convyder.backend.onStatusChange(setBackendStatus);
    return unsubscribe;
  }, []);

  const outgoingReady = Boolean(config?.realMicDeviceId && config?.virtualMicOutDeviceId);
  const incomingReady = Boolean(config?.meetingAudioInDeviceId && config?.headphoneDeviceId);

  return (
    <div className="app-shell">
      <header className="app-header">
        <div className="app-header-left">
          <h1 className="app-title">Convyder</h1>
        </div>
        <div className="app-header-right">
          <BackendStatusBadge status={backendStatus} />
          <button className="icon-btn" title="Settings" onClick={onOpenSettings} aria-label="Settings">
            ⚙
          </button>
        </div>
      </header>

      <main className="app-body">
        {!config?.setupComplete && (
          <div className="card" style={{ marginBottom: 20 }}>
            <p style={{ margin: 0, fontSize: 13 }}>
              Set up your devices and languages before starting.{' '}
              <button className="btn btn-primary" onClick={onOpenSettings}>
                Open Settings
              </button>
            </p>
          </div>
        )}

        <div className="direction-grid">
          <section className="card">
            <div className="card-header">
              <div>
                <h2 className="card-title">Outgoing</h2>
                <p className="card-subtitle">You speak, meeting hears translated</p>
              </div>
              <StatusBadge status={outgoing.status} />
            </div>

            {config && (
              <p className="card-summary">
                <strong>{languageLabel(config.outgoing.spokenLanguageCode)}</strong>
                <span>→</span>
                <strong>{languageLabel(config.outgoing.targetLanguageCode)}</strong>
              </p>
            )}

            <button
              className="btn btn-primary btn-block"
              disabled={!outgoingReady || outgoing.status === 'starting'}
              onClick={() =>
                outgoing.status === 'running'
                  ? outgoing.stop()
                  : outgoing.start(config!.realMicDeviceId!, config!.virtualMicOutDeviceId!)
              }
            >
              {outgoing.status === 'running' ? 'Stop' : 'Start'} outgoing
            </button>

            {outgoing.error && <p style={{ color: 'var(--color-danger)', fontSize: 12 }}>{outgoing.error}</p>}

            <div className="captions-feed">
              {outgoing.captions.map((c) => (
                <div key={c.segmentId} className="caption-line">
                  <span className="original">{c.text}</span>
                  <span className="arrow">→</span>
                  {c.translatedText}
                </div>
              ))}
            </div>
          </section>

          <section className="card">
            <div className="card-header">
              <div>
                <h2 className="card-title">Incoming</h2>
                <p className="card-subtitle">Meeting speaks, you hear translated</p>
              </div>
              <StatusBadge status={incoming.status} />
            </div>

            {config && (
              <p className="card-summary">
                <strong>{languageLabel(config.incoming.spokenLanguageCode)}</strong>
                <span>→</span>
                <strong>{languageLabel(config.incoming.targetLanguageCode)}</strong>
              </p>
            )}

            <button
              className="btn btn-primary btn-block"
              disabled={!incomingReady || incoming.status === 'starting'}
              onClick={() =>
                incoming.status === 'running'
                  ? incoming.stop()
                  : incoming.start(config!.meetingAudioInDeviceId!, config!.headphoneDeviceId!)
              }
            >
              {incoming.status === 'running' ? 'Stop' : 'Start'} incoming
            </button>

            {incoming.error && <p style={{ color: 'var(--color-danger)', fontSize: 12 }}>{incoming.error}</p>}

            <div className="captions-feed">
              {incoming.captions.map((c) => (
                <div key={c.segmentId} className={`caption-line${c.isFinal ? '' : ' pending'}`}>
                  <span className="original">{c.text}</span>
                  {c.translatedText && (
                    <>
                      <span className="arrow">→</span>
                      {c.translatedText}
                    </>
                  )}
                </div>
              ))}
            </div>
          </section>
        </div>
      </main>
    </div>
  );
}
