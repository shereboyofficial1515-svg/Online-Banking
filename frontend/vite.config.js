import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// In development the SPA runs on :5173 and proxies /api to the Express server so cookies stay same-origin.
export default defineConfig({
  plugins: [react()],
  server: { port: 5173, proxy: { '/api': { target: 'http://localhost:4000', changeOrigin: false } } },
  build: { sourcemap: false, chunkSizeWarningLimit: 700 },
  test: { environment: 'jsdom', setupFiles: ['./src/test/setup.js'], globals: true, css: false },
});
