/**
 * Spawns/health-checks/kills the backend's uvicorn process.
 *
 * v1 explicitly does not bundle Python (see plan) — this is a personal,
 * single-machine app, so we spawn the backend/.venv this project already
 * has rather than shipping a frozen Python runtime inside the packaged app.
 * That means PROJECT_ROOT below is a real dependency: the app only works
 * if this project folder stays on this Mac at this path.
 */
import { spawn, execSync, type ChildProcessWithoutNullStreams } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { app } from 'electron';
import type { AppConfig, DirectionLanguageConfig } from '@convyder/shared/config-types';
import { findLanguageOption } from '@convyder/shared/languages';

const BACKEND_PORT = 8000;
const HEALTH_URL = `http://127.0.0.1:${BACKEND_PORT}/health`;

const PROJECT_ROOT = app.isPackaged
  ? '/Users/rakeshgogoi/Documents/My Projects/convyder'
  : path.join(__dirname, '../../..');

const BACKEND_DIR = path.join(PROJECT_ROOT, 'backend');
const PYTHON_BIN = path.join(BACKEND_DIR, '.venv/bin/python');

export type BackendStatus =
  | { status: 'starting' }
  | { status: 'ready' }
  | { status: 'error'; detail: string }
  | { status: 'stopped' };

let backendProcess: ChildProcessWithoutNullStreams | null = null;
let currentStatus: BackendStatus = { status: 'stopped' };
let statusListeners: Array<(status: BackendStatus) => void> = [];

function emitStatus(status: BackendStatus): void {
  currentStatus = status;
  for (const listener of statusListeners) listener(status);
}

export function getBackendStatus(): BackendStatus {
  return currentStatus;
}

export function onBackendStatusChange(listener: (status: BackendStatus) => void): () => void {
  statusListeners.push(listener);
  return () => {
    statusListeners = statusListeners.filter((l) => l !== listener);
  };
}

async function checkHealth(timeoutMs = 1500): Promise<boolean> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    const res = await fetch(HEALTH_URL, { signal: controller.signal });
    clearTimeout(timeout);
    return res.ok;
  } catch {
    return false;
  }
}

/** Handles the one real orphan scenario for a personal app: the previous
 * launch was force-quit and left uvicorn bound to the port. We can't tell
 * whether a listener on 8000 is our own stale process or something else,
 * so just clear it and spawn fresh rather than guessing. */
function killExistingOnPort(port: number): void {
  try {
    const pids = execSync(`lsof -i :${port} -sTCP:LISTEN -t`, { encoding: 'utf-8' })
      .split('\n')
      .map((s) => s.trim())
      .filter(Boolean);
    for (const pid of pids) {
      try {
        process.kill(Number(pid), 'SIGTERM');
      } catch {
        // already gone
      }
    }
  } catch {
    // lsof exits non-zero when nothing is listening on the port — expected
  }
}

async function waitForHealth(maxAttempts = 40, intervalMs = 500): Promise<boolean> {
  for (let i = 0; i < maxAttempts; i++) {
    if (await checkHealth()) return true;
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
  return false;
}

function backendLogPath(): string {
  return path.join(app.getPath('userData'), 'logs', 'backend.log');
}

/** Turns a direction's language *codes* into the env vars the backend
 * actually reads — provider choice (Sarvam vs Whisper), voice, etc. This
 * is the one place that needs to know about LANGUAGE_OPTIONS/Sarvam so
 * config-types.ts and the UI can stay in terms of plain language codes. */
function buildDirectionEnv(
  prefix: 'INCOMING' | 'OUTGOING',
  direction: DirectionLanguageConfig,
  sarvamApiKey: string | null,
): Record<string, string> {
  const spoken = findLanguageOption(direction.spokenLanguageCode);
  const target = findLanguageOption(direction.targetLanguageCode);
  const useSarvam = Boolean(spoken?.sarvamLanguageCode && sarvamApiKey);

  return {
    [`${prefix}_STT_LANGUAGE`]: direction.spokenLanguageCode,
    [`${prefix}_STT_PROVIDER`]: useSarvam ? 'sarvam' : 'whisper',
    [`${prefix}_MT_SOURCE_LANG`]: direction.spokenLanguageCode,
    [`${prefix}_MT_TARGET_LANG`]: direction.targetLanguageCode,
    [`${prefix}_TTS_VOICE`]: target?.sayVoice ?? 'Samantha',
  };
}

export async function startBackend(config: AppConfig): Promise<void> {
  emitStatus({ status: 'starting' });

  if (!fs.existsSync(PYTHON_BIN)) {
    const detail = `Backend venv not found at ${PYTHON_BIN}. Set it up per backend/CLAUDE.md first.`;
    emitStatus({ status: 'error', detail });
    return;
  }

  killExistingOnPort(BACKEND_PORT);
  await new Promise((resolve) => setTimeout(resolve, 500)); // let the OS release the port

  const logFile = backendLogPath();
  fs.mkdirSync(path.dirname(logFile), { recursive: true });
  const logStream = fs.createWriteStream(logFile, { flags: 'a' });

  const directionEnv: Record<string, string> = {
    ...buildDirectionEnv('INCOMING', config.incoming, config.sarvamApiKey),
    ...buildDirectionEnv('OUTGOING', config.outgoing, config.sarvamApiKey),
  };
  if (config.sarvamApiKey) {
    directionEnv.SARVAM_API_KEY = config.sarvamApiKey;
  }

  backendProcess = spawn(
    PYTHON_BIN,
    ['-m', 'uvicorn', 'app.main:app', '--port', String(BACKEND_PORT)],
    {
      cwd: BACKEND_DIR,
      env: { ...process.env, ...directionEnv },
    },
  );

  backendProcess.stdout.pipe(logStream);
  backendProcess.stderr.pipe(logStream);

  backendProcess.on('exit', (code) => {
    backendProcess = null;
    if (code !== 0 && code !== null) {
      emitStatus({ status: 'error', detail: `Backend exited with code ${code}. See ${logFile}` });
    } else {
      emitStatus({ status: 'stopped' });
    }
  });

  const healthy = await waitForHealth();
  if (healthy) {
    emitStatus({ status: 'ready' });
  } else {
    emitStatus({ status: 'error', detail: `Backend did not become healthy in time. See ${logFile}` });
  }
}

export async function stopBackend(): Promise<void> {
  if (!backendProcess) return;
  const proc = backendProcess;
  proc.kill('SIGTERM');
  await Promise.race([
    new Promise<void>((resolve) => proc.once('exit', () => resolve())),
    new Promise<void>((resolve) => setTimeout(resolve, 2000)),
  ]);
  if (backendProcess === proc) {
    try {
      proc.kill('SIGKILL');
    } catch {
      // already gone
    }
  }
  backendProcess = null;
}

/** Used when language/provider settings change — the backend only reads
 * these from env vars at process startup, so applying new ones means a
 * full restart (a few seconds to reload Whisper/Argos). */
export async function restartBackend(config: AppConfig): Promise<void> {
  await stopBackend();
  await startBackend(config);
}
