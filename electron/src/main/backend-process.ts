/**
 * Spawns/health-checks/kills the backend's uvicorn process.
 *
 * We don't bundle a frozen Python runtime (PyInstaller-freezing
 * faster-whisper/ctranslate2/argostranslate is real engineering risk for
 * uncertain payoff — see plan notes). Instead: the backend *source* ships
 * inside the packaged app (read-only, under process.resourcesPath — see
 * forge.config.ts's packageAfterCopy hook), and the Python venv itself is
 * built on first run into userData (writable, per-install) by the setup
 * flow in setup-process.ts. In dev mode both source and venv are just the
 * real backend/ directory, unchanged from before.
 */
import { spawn, execSync, type ChildProcessWithoutNullStreams } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { app } from 'electron';
import type { AppConfig, DirectionLanguageConfig } from '@convyder/shared/config-types';
import { findLanguageOption } from '@convyder/shared/languages';

const BACKEND_PORT = 8000;
const HEALTH_URL = `http://127.0.0.1:${BACKEND_PORT}/health`;

export const BACKEND_SOURCE_DIR = app.isPackaged
  ? path.join(process.resourcesPath, 'backend')
  : path.join(__dirname, '../../../backend');

export const BACKEND_VENV_DIR = app.isPackaged
  ? path.join(app.getPath('userData'), 'backend-venv')
  : path.join(BACKEND_SOURCE_DIR, '.venv');

export const PYTHON_BIN = process.platform === 'win32'
  ? path.join(BACKEND_VENV_DIR, 'Scripts', 'python.exe')
  : path.join(BACKEND_VENV_DIR, 'bin', 'python');

// Written by setup-process.ts only after `pip install` exits 0. Checking
// this (rather than just PYTHON_BIN) matters because `python -m venv`
// creates python.exe unconditionally, before pip ever runs — so a venv
// dir existing is not evidence dependencies actually installed. Without
// this marker, a failed pip install (e.g. an incompatible Python version,
// a network blip) left a venv that looked "set up" to isBackendSetUp(),
// so the *next* setup attempt short-circuited straight to "done" and
// skipped pip entirely, shipping a backend missing uvicorn and friends.
export function setupMarkerPath(): string {
  return path.join(BACKEND_VENV_DIR, '.setup-complete');
}

export function isBackendSetUp(): boolean {
  return fs.existsSync(PYTHON_BIN) && fs.existsSync(setupMarkerPath());
}

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

/** netstat's column layout (Proto, Local Address, Foreign Address, State,
 * PID) rather than lsof's -t flag — Windows has no lsof. Matches on the
 * port suffix of the local-address column so it works for both the IPv4
 * (0.0.0.0:8000) and IPv6 ([::]:8000) forms netstat can report. */
function findWindowsPidsOnPort(port: number): string[] {
  const output = execSync('netstat -ano -p TCP', { encoding: 'utf-8' });
  const pids = new Set<string>();
  for (const line of output.split('\n')) {
    const parts = line.trim().split(/\s+/);
    if (parts.length < 5) continue;
    const [proto, localAddress, , state, pid] = parts;
    if (proto !== 'TCP' || state !== 'LISTENING') continue;
    if (localAddress.split(':').pop() === String(port) && /^\d+$/.test(pid)) {
      pids.add(pid);
    }
  }
  return [...pids];
}

/** Handles the one real orphan scenario for a personal app: the previous
 * launch was force-quit and left uvicorn bound to the port. We can't tell
 * whether a listener on 8000 is our own stale process or something else,
 * so just clear it and spawn fresh rather than guessing. */
function killExistingOnPort(port: number): void {
  try {
    const pids = process.platform === 'win32'
      ? findWindowsPidsOnPort(port)
      : execSync(`lsof -i :${port} -sTCP:LISTEN -t`, { encoding: 'utf-8' })
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
    // lsof exits non-zero (or netstat finds nothing matching) when
    // nothing is listening on the port — expected
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

/** English plus any language we've mapped a Sarvam code for (see
 * shared/src/languages.ts) — Mayura (Sarvam's translation model)
 * translates between English and Indian languages (and between Indian
 * languages themselves per their docs' examples), not general non-Indian
 * pairs like Spanish/French, so both sides of a direction need to clear
 * this before routing MT to Sarvam. */
function isSarvamMtSupported(code: string): boolean {
  return code === 'en' || Boolean(findLanguageOption(code)?.sarvamLanguageCode);
}

/** Turns a direction's language *codes* into the env vars the backend
 * actually reads — provider choice (Sarvam vs Whisper/Argos), voice, etc.
 * This is the one place that needs to know about LANGUAGE_OPTIONS/Sarvam
 * so config-types.ts and the UI can stay in terms of plain language codes. */
function buildDirectionEnv(
  prefix: 'INCOMING' | 'OUTGOING',
  direction: DirectionLanguageConfig,
  sarvamApiKey: string | null,
): Record<string, string> {
  const spoken = findLanguageOption(direction.spokenLanguageCode);
  const target = findLanguageOption(direction.targetLanguageCode);
  const useSarvamStt = Boolean(spoken?.sarvamLanguageCode && sarvamApiKey);
  const useSarvamMt = Boolean(
    sarvamApiKey &&
      (spoken?.sarvamLanguageCode || target?.sarvamLanguageCode) &&
      isSarvamMtSupported(direction.spokenLanguageCode) &&
      isSarvamMtSupported(direction.targetLanguageCode),
  );

  // Male isn't always available (see LanguageOption's sayVoiceMale comment
  // in languages.ts) — silently fall back to female rather than passing
  // `say` a voice name that isn't installed.
  const wantsMale = direction.voiceGender === 'male';
  const sayVoice = (wantsMale && target?.sayVoiceMale) || target?.sayVoiceFemale || 'Samantha';

  return {
    [`${prefix}_STT_LANGUAGE`]: direction.spokenLanguageCode,
    [`${prefix}_STT_PROVIDER`]: useSarvamStt ? 'sarvam' : 'whisper',
    [`${prefix}_MT_SOURCE_LANG`]: direction.spokenLanguageCode,
    [`${prefix}_MT_TARGET_LANG`]: direction.targetLanguageCode,
    [`${prefix}_MT_PROVIDER`]: useSarvamMt ? 'sarvam' : 'argos',
    [`${prefix}_TTS_VOICE`]: sayVoice,
    // WindowsTTSProvider picks the installed voice by language+gender at
    // runtime instead (SAPI voice names aren't consistent enough across
    // Windows installs to hardcode like macOS's `say` set — see
    // windows_tts_provider.py), so it needs the gender directly.
    [`${prefix}_TTS_GENDER`]: direction.voiceGender,
  };
}

export async function startBackend(config: AppConfig): Promise<void> {
  emitStatus({ status: 'starting' });

  if (!isBackendSetUp()) {
    const detail = `Backend venv not found at ${PYTHON_BIN}. Run first-time setup.`;
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
      cwd: BACKEND_SOURCE_DIR,
      env: {
        ...process.env,
        ...directionEnv,
        // faster-whisper's ctranslate2 and argostranslate's stanza->torch
        // each statically link their own copy of OpenMP — macOS x86_64
        // wheels abort the process ("OMP: Error #15... already
        // initialized") the moment a single process loads both. Confirmed
        // reproducing on an x64 build; arm64 wheels don't hit this. This
        // is the standard, widely-used workaround for that exact conflict.
        KMP_DUPLICATE_LIB_OK: 'TRUE',
      },
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

  const startedProcess = backendProcess;
  const healthy = await waitForHealth();
  if (healthy) {
    emitStatus({ status: 'ready' });
  } else {
    // Don't give up permanently here — a slow cold start (first-ever
    // venv, downloading the Whisper model — can take minutes on a slow
    // connection) can easily exceed this initial timeout while the
    // backend is still fine and about to come up. Observed live: the
    // process kept starting successfully seconds after this timeout,
    // but the UI was stuck showing a permanent false "error" with no
    // way to recover short of a manual restart.
    emitStatus({
      status: 'error',
      detail: 'Still starting (first run can take a few minutes to download models)…',
    });
    continuePollingInBackground(startedProcess, logFile);
  }
}

function continuePollingInBackground(
  expectedProcess: ChildProcessWithoutNullStreams | null,
  logFile: string,
): void {
  (async () => {
    for (let i = 0; i < 120; i++) {
      await new Promise((resolve) => setTimeout(resolve, 2000));
      // A newer startBackend/stopBackend call has since taken over —
      // let its own status reporting own the outcome instead of ours.
      if (backendProcess !== expectedProcess) return;
      if (await checkHealth()) {
        emitStatus({ status: 'ready' });
        return;
      }
    }
    if (backendProcess === expectedProcess) {
      emitStatus({ status: 'error', detail: `Backend did not become healthy after an extended wait. See ${logFile}` });
    }
  })();
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
