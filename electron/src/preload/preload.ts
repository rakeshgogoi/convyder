import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron';
import type { AppConfig } from '@convyder/shared/config-types';
import type { BackendStatus } from '../main/backend-process';

const convyderApi = {
  config: {
    get: (): Promise<AppConfig> => ipcRenderer.invoke('config:get'),
    set: (partial: Partial<AppConfig>): Promise<AppConfig> => ipcRenderer.invoke('config:set', partial),
  },
  backend: {
    getStatus: (): Promise<BackendStatus> => ipcRenderer.invoke('backend:get-status'),
    onStatusChange: (callback: (status: BackendStatus) => void): (() => void) => {
      const listener = (_event: IpcRendererEvent, status: BackendStatus) => callback(status);
      ipcRenderer.on('backend:status', listener);
      return () => ipcRenderer.removeListener('backend:status', listener);
    },
  },
  say: {
    listVoices: (): Promise<string[]> => ipcRenderer.invoke('say:list-voices'),
  },
};

contextBridge.exposeInMainWorld('convyder', convyderApi);

export type ConvyderApi = typeof convyderApi;
