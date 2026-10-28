import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  root: fileURLToPath(new URL('.', import.meta.url)),
  plugins: [react()],
  server: {
    // Bind all interfaces so the dev UI is reachable from other devices on the LAN
    // (e.g. a phone) for mobile testing.
    host: true,
    port: 5173,
    proxy: {
      '/api': 'http://localhost:8901',
    },
  },
  build: {
    outDir: '../server/public',
    emptyOutDir: true,
  },
});
