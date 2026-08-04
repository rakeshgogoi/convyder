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

const MIN_SUPPORTED_MINOR = 9;
const MAX_SUPPORTED_MINOR = 12;

type PythonSearchResult =
  | { kind: 'found'; command: string }
  // `kind: 'not-found'` with a version means we did find a `python`/
  // `python3` on PATH, just not a supported one -- worth telling the
  // user exactly what version they have instead of a generic "not
  // found", since otherwise this surfaces as an opaque pip/numpy build
  // failure deep into setup (see MIN/MAX_SUPPORTED_MINOR usage below).
  | { kind: 'not-found'; unsupportedVersion?: string };

function getVersion(command: string): Promise<string | null> {
  return new Promise((resolve) => {
    execFile(command, ['--version'], (error, stdout, stderr) => {
      if (error) {
        resolve(null);
        return;
      }
      // Python < 3.4 prints to stderr; newer versions print to stdout.
      resolve((stdout || stderr).trim());
    });
  });
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
 * version as precisely as a result, so we check the version we get back
 * and reject anything outside the supported range explicitly instead of
 * discovering it only when pip tries (and fails) to build numpy. */
async function findSystemPython(): Promise<PythonSearchResult> {
  const candidates = process.platform === 'win32'
    ? ['python', 'python3']
    : ['python3.11', 'python3.10', 'python3.12', 'python3.9', 'python3'];

  let unsupportedVersion: string | undefined;

  for (const candidate of candidates) {
    const versionOutput = await getVersion(candidate);
    if (!versionOutput) continue;

    const match = versionOutput.match(/Python (\d+)\.(\d+)/);
    if (!match) continue;

    const [, majorStr, minorStr] = match;
    const major = Number(majorStr);
    const minor = Number(minorStr);
    if (major === 3 && minor >= MIN_SUPPORTED_MINOR && minor <= MAX_SUPPORTED_MINOR) {
      return { kind: 'found', command: candidate };
    }
    if (!unsupportedVersion) unsupportedVersion = versionOutput.replace(/^Python\s*/, '');
  }

  return { kind: 'not-found', unsupportedVersion };
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
  const pythonResult = await findSystemPython();
  if (pythonResult.kind === 'not-found') {
    const detail = pythonResult.unsupportedVersion
      ? `Found Python ${pythonResult.unsupportedVersion}, but this needs Python 3.${MIN_SUPPORTED_MINOR}-3.${MAX_SUPPORTED_MINOR}. Install a supported version from python.org, then try again.`
      : `No Python 3 installation found. Install it from python.org (3.${MIN_SUPPORTED_MINOR}-3.${MAX_SUPPORTED_MINOR} recommended), then try again.`;
    logStream.end(`${detail}\n`);
    emitProgress({ phase: 'error', detail });
    return false;
  }
  const python = pythonResult.command;

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
