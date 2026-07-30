type Status = 'idle' | 'starting' | 'running' | 'error';

const LABELS: Record<Status, string> = {
  idle: 'Idle',
  starting: 'Starting…',
  running: 'Running',
  error: 'Error',
};

export function StatusBadge({ status }: { status: Status }) {
  return (
    <span className={`status-badge ${status}`}>
      <span className="dot" />
      {LABELS[status]}
    </span>
  );
}
