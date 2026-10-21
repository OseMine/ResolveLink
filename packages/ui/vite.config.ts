import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig({
  plugins: [react()],
  root: '.',
  // Relative asset paths so the build also works when loaded from file://
  // (Electron fallback) instead of only over http://.
  base: './',
  build: {
    outDir: 'dist',
    emptyOutDir: true,
  },
  server: {
    port: 5173,
    strictPort: true,
    proxy: {
      '/api': 'http://localhost:3030',
    },
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './'),
      '@resolvelink/shared': path.resolve(__dirname, '..', 'shared', 'src'),
    },
  },
});
