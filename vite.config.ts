import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'path';

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  const isDev = mode === 'development';
  /** 开发时 /api 代理目标：默认本机 3001；连线上 API 时在 .env.development 设 VITE_DEV_API_PROXY=https://api.xxx */
  const devApiProxy = (env.VITE_DEV_API_PROXY || 'http://127.0.0.1:3001').trim();
  const devApiSecure = devApiProxy.startsWith('https');

  return {
    plugins: [react()],
    /**
     * 开发模式强制清空直连后端的基地址，避免浏览器跨域请求线上 API。
     * 即使 shell / 其它 .env 里带了 VITE_API_BASE_URL，也以代理为准。
     */
    ...(isDev
      ? {
          define: {
            'import.meta.env.VITE_API_BASE_URL': JSON.stringify(''),
            'import.meta.env.VITE_API_BASE': JSON.stringify(''),
          },
        }
      : {}),
    base: process.env.VITE_BASE || '/monitor-web/',
    server: {
      proxy: {
        '/api': {
          target: devApiProxy,
          changeOrigin: true,
          secure: devApiSecure,
          // 把线上 Set-Cookie 的 Domain 改成本机，否则浏览器不会带上 token
          cookieDomainRewrite: 'localhost',
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
  };
});
