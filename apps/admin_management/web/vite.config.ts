import path from 'node:path';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const apiProxyTarget =
  (process.env.ADMIN_MANAGEMENT_API_PROXY_TARGET as string | undefined) ??
  (process.env.VITE_API_PROXY_TARGET as string | undefined) ??
  `http://${process.env.ADMIN_MANAGEMENT_API_PROXY_HOST || process.env.VITE_API_HOST || '127.0.0.1'}:${process.env.ADMIN_MANAGEMENT_PORT || process.env.VITE_API_PORT || '9310'}`;
const webPort = Number(process.env.ADMIN_MANAGEMENT_WEB_PORT || process.env.VITE_DEV_PORT || 5174);
const webHost = (process.env.ADMIN_MANAGEMENT_WEB_HOST ||
  process.env.ADMIN_MANAGEMENT_BIND_HOST ||
  process.env.ADMIN_MANAGEMENT_HOST ||
  '0.0.0.0') as string;

export default defineConfig({
  envDir: path.resolve(__dirname, '..', '..'),
  root: path.resolve(__dirname),
  plugins: [react()],
  server: {
    host: webHost,
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
