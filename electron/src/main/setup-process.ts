/**
 * First-run setup for a fresh install (e.g. a friend's Mac): creates the
 * Python venv in userData and pip installs backend/requirements.txt into
 * it. The backend source itself ships bundled read-only (see
 * backend-process.ts) — this only needs to run once per install.
 */
import { spawn, execFile } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { BACKEND_SOURCE_DIR, BACKEND_VENV_DIR, isBackendSetUp, setupMarkerPath, setupLogPath } from './backend-process';

export type SetupProgress =
  | { phase: 'checking-python' }
  | { phase: 'creating-venv' }
  | { phase: 'installing-dependencies'; line?: string }
  | { phase: 'done' }
  | { phase: 'error'; detail: string };

let progressListeners: Array<(progress: SetupProgress) => void> = [];

function emitProgress(progress: SetupProgress): void {
  for (const listener of progressListeners) listener(progress);
}

export function onSetupProgress(listener: (progress: SetupProgress) => void): () => void {
  progressListeners.push(listener);
  return () => {
    progressListeners = progressListeners.filter((l) => l !== listener);
  };
}

/** Tries a few likely Python installs in order — faster-whisper/
 * ctranslate2 wheel availability lags brand-new Python releases, so
 * prefer slightly older stable versions when multiple are present.
 *
 * Windows candidates are deliberately simpler than macOS/Linux: the
 * `python3.11`-style versioned names are a Homebrew/Linux-distro
 * convention, not how python.org's Windows installer sets things up —
 * that installer's "Add python.exe to PATH" option (checked by default)
 * puts a single `python` on PATH instead. We can't pick a specific minor
 * version as precisely as a result; a pip install failure from an
 * incompatible version would surface as its own reportable error. */
function findSystemPython(): Promise<string | null> {
  const candidates = process.platform === 'win32'
    ? ['python', 'python3']
    : ['python3.11', 'python3.10', 'python3.12', 'python3.9', 'python3'];
  return new Promise((resolve) => {
    const tryNext = (i: number) => {
      if (i >= candidates.length) {
        resolve(null);
        return;
      }
      execFile(candidates[i], ['--version'], (error) => {
        if (!error) resolve(candidates[i]);
        else tryNext(i + 1);
      });
    };
    tryNext(0);
  });
}

function runCommand(
  command: string,
  args: string[],
  logStream: fs.WriteStream,
  onLine?: (line: string) => void,
): Promise<number> {
  return new Promise((resolve) => {
    logStream.write(`\n$ ${command} ${args.join(' ')}\n`);
    const child = spawn(command, args);
    const handleData = (data: Buffer) => {
      for (const line of data.toString().split('\n')) {
        if (!line.trim()) continue;
        logStream.write(`${line.trim()}\n`);
        onLine?.(line.trim());
      }
    };
    child.stdout.on('data', handleData);
    child.stderr.on('data', handleData);
    child.on('exit', (code) => {
      logStream.write(`(exit code ${code ?? 1})\n`);
      resolve(code ?? 1);
    });
    child.on('error', (err) => {
      logStream.write(`(failed to start: ${err.message})\n`);
      resolve(1);
    });
  });
}

export async function runSetup(): Promise<boolean> {
  if (isBackendSetUp()) {
    emitProgress({ phase: 'done' });
    return true;
  }

  const logFile = setupLogPath();
  fs.mkdirSync(path.dirname(logFile), { recursive: true });
  const logStream = fs.createWriteStream(logFile, { flags: 'a' });
  logStream.write(`\n=== Setup run started ${new Date().toISOString()} ===\n`);

  emitProgress({ phase: 'checking-python' });
  const python = await findSystemPython();
  if (!python) {
    logStream.end('No Python 3 installation found on PATH.\n');
    emitProgress({
      phase: 'error',
      detail: 'No Python 3 installation found. Install it from python.org (3.9-3.12 recommended), then try again.',
    });
    return false;
  }

  emitProgress({ phase: 'creating-venv' });
  fs.mkdirSync(path.dirname(BACKEND_VENV_DIR), { recursive: true });

  const venvExit = await runCommand(python, ['-m', 'venv', BACKEND_VENV_DIR], logStream);
  if (venvExit !== 0) {
    logStream.end();
    emitProgress({ phase: 'error', detail: `Failed to create the Python virtual environment (exit code ${venvExit}). See ${logFile}` });
    return false;
  }

  emitProgress({ phase: 'installing-dependencies' });
  const pipBin = process.platform === 'win32'
    ? path.join(BACKEND_VENV_DIR, 'Scripts', 'pip.exe')
    : path.join(BACKEND_VENV_DIR, 'bin', 'pip');
  const requirementsPath = path.join(BACKEND_SOURCE_DIR, 'requirements.txt');
  const pipExit = await runCommand(pipBin, ['install', '-r', requirementsPath], logStream, (line) => {
    emitProgress({ phase: 'installing-dependencies', line });
  });
  if (pipExit !== 0) {
    logStream.end();
    emitProgress({ phase: 'error', detail: `Failed to install dependencies (exit code ${pipExit}). See ${logFile}` });
    return false;
  }

  logStream.end('Setup completed successfully.\n');
  fs.writeFileSync(setupMarkerPath(), '');
  emitProgress({ phase: 'done' });
  return true;
}
