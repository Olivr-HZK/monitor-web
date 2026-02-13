import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'path';

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  base: process.env.VITE_BASE || '/monitor-web/',
  server: {
    proxy: {
      // 开发时把 /api 转发到后端，避免「申请玩法解析」等接口 404
      '/api': {
        target: 'http://localhost:3001',
        changeOrigin: true,
      },
    },
  },
  build: {
    rollupOptions: {
      input: {
        main: resolve(__dirname, 'index.html'),
        casual: resolve(__dirname, 'casual.html'),
      },
    },
  },
});
