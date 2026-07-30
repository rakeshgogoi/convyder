import type { ConvyderApi } from '../preload/preload';

declare global {
  interface Window {
    convyder: ConvyderApi;
  }
}

export {};
