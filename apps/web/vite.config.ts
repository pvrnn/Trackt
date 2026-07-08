import { tanstackStart } from '@tanstack/react-start/plugin/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  server: {
    port: 3000,
    // In development the API runs separately on :3001 (see apps/api).
    proxy: {
      '/api': 'http://localhost:3001',
      '/healthz': 'http://localhost:3001',
      '/readyz': 'http://localhost:3001',
      '/docs': 'http://localhost:3001',
    },
  },
  plugins: [tanstackStart(), react()],
});
