import path from 'node:path';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const apiProxyTarget =
  (process.env.VITE_API_PROXY_TARGET as string | undefined) ??
  (process.env.ADMIN_MANAGEMENT_API_HOST || process.env.VITE_API_HOST
    ? `http://${process.env.ADMIN_MANAGEMENT_API_HOST || process.env.VITE_API_HOST}:${process.env.ADMIN_MANAGEMENT_PORT || process.env.VITE_API_PORT || '9310'}`
    : 'http://192.168.10.128:9310');
const webPort = Number(process.env.ADMIN_MANAGEMENT_WEB_PORT || process.env.VITE_DEV_PORT || 5174);

export default defineConfig({
  root: path.resolve(__dirname),
  plugins: [react()],
  server: {
    host: true,
    port: webPort,
    strictPort: true,
    proxy: {
      '/api': {
        target: apiProxyTarget,
        changeOrigin: true,
      },
      '/health': {
        target: apiProxyTarget,
        changeOrigin: true,
      },
    },
  },
  build: {
    outDir: path.resolve(__dirname, 'dist'),
    emptyOutDir: true,
  },
});
