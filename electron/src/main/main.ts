import { app, BrowserWindow } from 'electron';
import path from 'node:path';
import started from 'electron-squirrel-startup';
import { isBackendSetUp, startBackend, stopBackend } from './backend-process';
import { registerIpcHandlers } from './ipc-handlers';
import { readConfig } from './config-store';

// Handle creating/removing shortcuts on Windows when installing/uninstalling.
if (started) {
  app.quit();
}

// Convyder never stores anything through Chromium's own cookie/localStorage
// encryption (all persisted state — config, API key — goes through our own
// plain config.json, not Electron's session storage), so skip the real
// macOS Keychain for it. Without this, every launch of an ad-hoc-signed
// build prompts for "<AppName> Safe Storage" keychain access, since the
// ACL is tied to the app's code signature and we have no stable Developer
// ID identity for it to persist against.
app.commandLine.appendSwitch('use-mock-keychain');

const createWindow = () => {
  const mainWindow = new BrowserWindow({
    width: 900,
    height: 700,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
    },
  });

  registerIpcHandlers(mainWindow);

  // Forwards renderer devtools console output to the main process's own
  // stdout/log — useful for debugging the packaged app where devtools
  // isn't open by default (see plan's packaged-app verification checks).
  mainWindow.webContents.on('console-message', (event) => {
    console.log(`[renderer] ${event.message}`);
  });

  if (MAIN_WINDOW_VITE_DEV_SERVER_URL) {
    mainWindow.loadURL(MAIN_WINDOW_VITE_DEV_SERVER_URL);
  } else {
    mainWindow.loadFile(
      path.join(__dirname, `../renderer/${MAIN_WINDOW_VITE_NAME}/index.html`),
    );
  }

  if (MAIN_WINDOW_VITE_DEV_SERVER_URL) {
    mainWindow.webContents.openDevTools();
  }
};

app.on('ready', async () => {
  createWindow();
  // On a fresh install (e.g. a friend's Mac) there's no venv yet — skip
  // starting the backend until the renderer's SetupScreen runs setup and
  // explicitly calls backend:restart. Avoids a confusing "backend error"
  // status appearing before the user has even seen the setup flow.
  if (isBackendSetUp()) {
    await startBackend(readConfig());
  }
});

// Quit when all windows are closed, except on macOS. There, it's common
// for applications and their menu bar to stay active until the user quits
// explicitly with Cmd + Q.
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});

let quitting = false;
app.on('before-quit', (event) => {
  if (quitting) return;
  quitting = true;
  event.preventDefault();
  stopBackend().finally(() => app.exit(0));
});
