import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { secretRouteHeadersPlugin } from './src/vite-plugin-secret-headers';
import { serviceWorkerPlugin } from './src/vite-plugin-sw';

export default defineConfig({
  plugins: [react(), secretRouteHeadersPlugin(), serviceWorkerPlugin()],
  server: {
    port: 5173,
  },
  preview: {
    port: 5173,
  },
});
