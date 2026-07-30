import path from 'node:path';
import { defineConfig } from 'vite';

// https://vitejs.dev/config
export default defineConfig({
  resolve: {
    alias: {
      '@convyder/shared': path.resolve(__dirname, '../shared/src'),
    },
  },
});
