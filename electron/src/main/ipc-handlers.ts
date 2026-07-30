import { execFile } from 'node:child_process';
import { ipcMain, type BrowserWindow } from 'electron';
import type { AppConfig } from '@convyder/shared/config-types';
import { readConfig, writeConfig } from './config-store';
import { getBackendStatus, isBackendSetUp, onBackendStatusChange, restartBackend } from './backend-process';
import { onSetupProgress, runSetup } from './setup-process';

function listSayVoices(): Promise<string[]> {
  return new Promise((resolve) => {
    execFile('say', ['-v', '?'], (error, stdout) => {
      if (error) {
        resolve([]);
        return;
      }
      const voices = stdout
        .split('\n')
        .map((line) => line.trim())
        .filter(Boolean)
        .map((line) => line.split(/\s{2,}/)[0]?.trim())
        .filter((name): name is string => Boolean(name));
      resolve(voices);
    });
  });
}

export function registerIpcHandlers(mainWindow: BrowserWindow): void {
  ipcMain.handle('config:get', () => readConfig());

  ipcMain.handle('config:set', (_event, partial: Partial<AppConfig>) => {
    const merged = { ...readConfig(), ...partial };
    writeConfig(merged);
    return merged;
  });

  ipcMain.handle('backend:get-status', () => getBackendStatus());

  ipcMain.handle('backend:restart', async () => {
    await restartBackend(readConfig());
    return getBackendStatus();
  });

  ipcMain.handle('say:list-voices', () => listSayVoices());

  ipcMain.handle('setup:check', () => isBackendSetUp());

  ipcMain.handle('setup:run', () => runSetup());

  onBackendStatusChange((status) => {
    if (!mainWindow.isDestroyed()) {
      mainWindow.webContents.send('backend:status', status);
    }
  });

  onSetupProgress((progress) => {
    if (!mainWindow.isDestroyed()) {
      mainWindow.webContents.send('setup:progress', progress);
    }
  });
}
