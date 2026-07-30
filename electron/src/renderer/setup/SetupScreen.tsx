import { useEffect, useState } from 'react';
import type { SetupProgress } from '../../main/setup-process';

interface SetupScreenProps {
  onComplete: () => void;
}

function phaseLabel(progress: SetupProgress | null): string {
  if (!progress) return 'Convyder needs to set up its Python backend once on this Mac.';
  switch (progress.phase) {
    case 'checking-python':
      return 'Checking for Python…';
    case 'creating-venv':
      return 'Creating Python environment…';
    case 'installing-dependencies':
      return 'Installing dependencies — this can take a few minutes…';
    case 'done':
      return 'Setup complete!';
    case 'error':
      return `Setup failed: ${progress.detail}`;
  }
}

export function SetupScreen({ onComplete }: SetupScreenProps) {
  const [progress, setProgress] = useState<SetupProgress | null>(null);
  const [log, setLog] = useState<string[]>([]);
  const [running, setRunning] = useState(false);

  useEffect(() => {
    return window.convyder.setup.onProgress((p) => {
      setProgress(p);
      if (p.phase === 'installing-dependencies' && p.line) {
        setLog((prev) => [...prev.slice(-8), p.line as string]);
      }
    });
  }, []);

  const start = async () => {
    setRunning(true);
    setLog([]);
    const success = await window.convyder.setup.run();
    if (success) {
      await window.convyder.backend.restart();
      onComplete();
    } else {
      setRunning(false);
    }
  };

  const isError = progress?.phase === 'error';

  return (
    <div className="app-body" style={{ maxWidth: 560, margin: '60px auto' }}>
      <div className="card">
        <h2 className="card-title">First-time setup</h2>
        <p className="card-subtitle">
          Installs speech recognition and translation dependencies. One-time only, needs Python
          3.9-3.12 already on this Mac.
        </p>

        <p style={{ fontSize: 13, marginTop: 4, color: isError ? 'var(--color-danger)' : undefined }}>
          {phaseLabel(progress)}
        </p>

        {progress?.phase === 'installing-dependencies' && log.length > 0 && (
          <pre
            style={{
              fontSize: 11,
              background: 'var(--color-bg)',
              padding: 8,
              borderRadius: 6,
              maxHeight: 120,
              overflow: 'auto',
              margin: 0,
            }}
          >
            {log.join('\n')}
          </pre>
        )}

        <button className="btn btn-primary btn-block" onClick={start} disabled={running && !isError}>
          {isError ? 'Retry' : running ? 'Setting up…' : 'Start Setup'}
        </button>
      </div>
    </div>
  );
}
