import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const apiTarget = process.env.QUICPROXY_API_TARGET || 'http://127.0.0.1:1235';

export default defineConfig({
  plugins: [react()],
  server: {
    host: '0.0.0.0',
    port: 5173,
    proxy: Object.fromEntries(
      ['/observe', '/outbounds', '/selector', '/mode', '/connections', '/trace', '/request', '/quit', '/traffic'].map((route) => [
        route,
        {
          target: apiTarget,
          changeOrigin: true,
        },
      ]),
    ),
  },
});
