import path from 'node:path';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// https://vitejs.dev/config
export default defineConfig({
  base: './', // required for the packaged app's file:// asset loading — see plan notes
  plugins: [react()],
  resolve: {
    alias: {
      '@convyder/shared': path.resolve(__dirname, '../shared/src'),
    },
  },
});
